// E2E przez protokol MCP: zbudowany serwer (dist/) + lokalna atrapa SAOS (SAOS_BASE_URL).
//
// Sprawdza to, co naprawde dostaje agent - nie funkcje w izolacji:
// - przerwa techniczna (HTML/200) na `search` -> isError + error_code upstream_maintenance;
// - `saos_cite_check`, gdy pelne teksty nie daja sie pobrac -> status degraded,
//   partial_result z mianownikiem, a odpowiedz ZACZYNA SIE od "Wynik niepelny"
//   (wzorzec leniwyposel/sejm-mcp #4; do 2026-10-13 porazka pobrania = cichy `null`,
//   a wynik mowil tylko "skan pelnych tekstow: 0").
// Run: npm run test:unit (wymaga npm run build)

import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import { raportSkanu, zdanieWynikNiepelny } from "../dist/cite-check.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const STRONA_PRZERWY =
  "<!DOCTYPE html><html><head><title>Przerwa techniczna</title></head>" +
  "<body>Trwa przerwa techniczna. Zapraszamy później.</body></html>";

const CYTUJACE = {
  items: [1, 2, 3].map((id) => ({
    id,
    courtType: "COMMON",
    courtCases: [{ caseNumber: `I C ${id}/25` }],
    judgmentDate: "2025-06-0" + id,
    judgmentType: "SENTENCE",
    textContent: "Sad podziela stanowisko wyrazone w uchwale III CZP 6/21.",
  })),
  info: { totalResults: 3 },
};

async function atrapa({ szukanie, orzeczenie }) {
  const s = http.createServer((req, res) => {
    const [status, ct, body] = req.url.startsWith("/api/search") ? szukanie(req) : orzeczenie(req);
    res.writeHead(status, { "content-type": ct });
    res.end(body);
  });
  await new Promise((r) => s.listen(0, "127.0.0.1", r));
  return { base: `http://127.0.0.1:${s.address().port}/api`, zamknij: () => s.close() };
}

async function klient(base) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(ROOT, "dist", "index.js")],
    env: { ...process.env, SAOS_BASE_URL: base },
    stderr: "ignore",
  });
  const c = new Client({ name: "e2e-atrapa", version: "1.0" });
  await c.connect(transport);
  return c;
}

test("przerwa techniczna na search -> agent dostaje upstream_maintenance", async () => {
  const { base, zamknij } = await atrapa({
    szukanie: () => [200, "text/html;charset=UTF-8", STRONA_PRZERWY],
    orzeczenie: () => [200, "text/html", STRONA_PRZERWY],
  });
  const c = await klient(base);
  try {
    const r = await c.callTool({ name: "search", arguments: { all: "ochrona danych" } });
    assert.equal(r.isError, true);
    assert.equal(r.structuredContent.error_code, "upstream_maintenance");
    assert.equal(r.structuredContent.retryable, false);
    assert.doesNotMatch(r.content[0].text, /Unexpected token|Invalid JSON|Blad komunikacji/);
  } finally {
    await c.close();
    zamknij();
  }
});

test("cite_check z nieudanym pobraniem pelnych tekstow -> degraded + Wynik niepelny", async () => {
  const { base, zamknij } = await atrapa({
    szukanie: () => [200, "application/json", JSON.stringify(CYTUJACE)],
    orzeczenie: () => [200, "text/html", STRONA_PRZERWY],
  });
  const c = await klient(base);
  try {
    const r = await c.callTool({ name: "saos_cite_check", arguments: { caseNumber: "III CZP 6/21" } });
    assert.notEqual(r.isError, true);
    const sc = r.structuredContent;
    assert.equal(sc.status, "degraded");
    assert.equal(sc.partial_result.coverage.total, 3);
    assert.equal(sc.partial_result.coverage.usable, 0);
    assert.match(sc.partial_result.dlaczego, /przerw/i);
    assert.match(r.content[0].text, /^Wynik niepelny: /);
  } finally {
    await c.close();
    zamknij();
  }
});

test("kontrola pozytywna: cite_check z udanym skanem -> status ok, bez dopisku", async () => {
  const pelne = (req) => {
    const id = Number(req.url.split("/").pop());
    return [200, "application/json", JSON.stringify({ data: { id, textContent: "Uchwala III CZP 6/21." } })];
  };
  const { base, zamknij } = await atrapa({
    szukanie: () => [200, "application/json", JSON.stringify(CYTUJACE)],
    orzeczenie: pelne,
  });
  const c = await klient(base);
  try {
    const r = await c.callTool({ name: "saos_cite_check", arguments: { caseNumber: "III CZP 6/21" } });
    assert.equal(r.structuredContent.status, "ok");
    assert.equal(r.structuredContent.partial_result, null);
    assert.doesNotMatch(r.content[0].text, /^Wynik niepelny/);
  } finally {
    await c.close();
    zamknij();
  }
});

// Wzorzec soba-labs/krs-mcp #1 (`src/tools/common.ts:38-51`): blok provenance w KAZDYM udanym
// wyniku - zrodlo, czas pobrania, czas wytworzenia (jawne null zamiast zgadywania) i co zrobil
// konektor. Pod warunki ponownego wykorzystania informacji sektora publicznego.
const WYWOLANIA = {
  search: { all: "ochrona danych" },
  get_judgment: { id: 1 },
  search_by_case: { caseNumber: "I C 1/25" },
  saos_cite_check: { caseNumber: "III CZP 6/21" },
};

test("provenance w kazdym udanym wyniku - pelny mianownik narzedzi", async () => {
  const pelne = (req) => {
    const id = Number(req.url.split("/").pop());
    return [200, "application/json", JSON.stringify({ data: { id, textContent: "Tekst III CZP 6/21." } })];
  };
  const { base, zamknij } = await atrapa({
    szukanie: () => [200, "application/json", JSON.stringify(CYTUJACE)],
    orzeczenie: pelne,
  });
  const c = await klient(base);
  try {
    const narzedzia = (await c.listTools()).tools.map((t) => t.name).sort();
    assert.ok(narzedzia.length > 0, "pusta lista narzedzi = BLOKADA");
    assert.deepEqual(narzedzia, Object.keys(WYWOLANIA).sort(), "kazde narzedzie musi miec wywolanie");
    for (const [name, args] of Object.entries(WYWOLANIA)) {
      const r = await c.callTool({ name, arguments: args });
      assert.notEqual(r.isError, true, `${name}: ${r.content?.[0]?.text}`);
      const p = r.structuredContent?.provenance;
      assert.ok(p, `${name}: brak provenance`);
      assert.ok(p.source && String(p.source).includes(base), `${name}: source = ${p.source}`);
      assert.ok(!Number.isNaN(Date.parse(p.retrieved_at)), `${name}: retrieved_at = ${p.retrieved_at}`);
      assert.equal(p.source_produced_at, null, `${name}: source_produced_at ma byc jawnym null`);
      assert.ok(p.processing && p.processing.length > 10, `${name}: processing`);
    }
  } finally {
    await c.close();
    zamknij();
  }
});

test("raportSkanu: mianownik, powody laczone, 'jak uzupelnic' zalezy od ponawialnosci", () => {
  assert.deepEqual(raportSkanu(5, [], 0), { status: "ok", partial_result: null });
  const r = raportSkanu(5, ["upstream_maintenance", "upstream_unavailable"], 1);
  assert.equal(r.status, "degraded");
  assert.deepEqual(r.partial_result.coverage, { unit: "pelne_teksty", total: 5, usable: 2 });
  assert.match(r.partial_result.czego_brakuje, /3 z 5/);
  assert.match(r.partial_result.dlaczego, /przerw/i);
  assert.match(r.partial_result.dlaczego, /bez tekstu/i);
  assert.match(zdanieWynikNiepelny(r), /^Wynik niepelny: /);
  assert.equal(zdanieWynikNiepelny(raportSkanu(5, [], 0)), null);
});

test("raportSkanu: zero prob (deepScan wylaczony) to nie jest skan niepelny", () => {
  assert.deepEqual(raportSkanu(0, [], 0), { status: "ok", partial_result: null });
});
