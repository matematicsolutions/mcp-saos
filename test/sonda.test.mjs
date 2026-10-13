// Sonda zgodnosci ze SAOS: trojstan + `actionable`, na lokalnej atrapie (zero sieci).
// Wzorzec soba-labs/krs-mcp #2. Sonda, ktora umie powiedziec tylko "OK", wykrywa sukces, nie awarie.
// Run: npm run test:unit (wymaga npm run build)

import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

import { sonduj, KOD_WYJSCIA, PRZYPADKI } from "./sonda.mjs";

// Ksztalt zmierzony na zywo 2026-10-13 (SAOS id 543228, rekord publiczny).
const ORZECZENIE = {
  data: {
    id: 543228, courtType: "COMMON", judgmentDate: "2025-03-05", judgmentType: "SENTENCE",
    courtCases: [{ caseNumber: "I C 3346/24" }], division: { court: { name: "Sąd Okręgowy w Krakowie" } },
    textContent: "Tekst orzeczenia.",
  },
};
const LISTA = { items: [ORZECZENIE.data], info: { totalResults: 1 } };

async function zAtrapa(obsluga, fn) {
  const s = http.createServer((req, res) => {
    const [status, ct, body] = obsluga(req);
    res.writeHead(status, { "content-type": ct });
    res.end(body);
  });
  await new Promise((r) => s.listen(0, "127.0.0.1", r));
  try {
    return await fn({ ...process.env, SAOS_BASE_URL: `http://127.0.0.1:${s.address().port}/api` });
  } finally {
    s.close();
  }
}
const zdrowe = (req) =>
  req.url.startsWith("/api/search")
    ? [200, "application/json", JSON.stringify(LISTA)]
    : [200, "application/json", JSON.stringify(ORZECZENIE)];

test("zdrowe zrodlo -> OK, pelny mianownik", async () => {
  const w = await zAtrapa(zdrowe, (env) => sonduj({ env }));
  assert.equal(w.status, "OK");
  assert.equal(w.kontrole.length, PRZYPADKI.length);
  assert.ok(w.kontrole.length >= 2 && w.kontrole.every((k) => k.ok));
  assert.equal(KOD_WYJSCIA[w.status], 0);
});

test("503 -> UWAGI, nie budzi czlowieka", async () => {
  const w = await zAtrapa(() => [503, "text/html", "<html>busy</html>"], (env) => sonduj({ env }));
  assert.equal(w.status, "UWAGI");
  assert.equal(w.actionable, false);
});

test("przerwa techniczna (HTML/200) -> UWAGI (chwilowe, nie zmiana kontraktu)", async () => {
  const strona = "<!DOCTYPE html><html><head><title>Przerwa techniczna</title></head><body>Trwa przerwa techniczna.</body></html>";
  const w = await zAtrapa(() => [200, "text/html", strona], (env) => sonduj({ env }));
  assert.equal(w.status, "UWAGI");
});

test("403 -> BLOKADA, budzi czlowieka", async () => {
  const w = await zAtrapa(() => [403, "text/html", "<html>Forbidden</html>"], (env) => sonduj({ env }));
  assert.equal(w.status, "BLOKADA");
  assert.equal(w.actionable, true);
  assert.equal(KOD_WYJSCIA[w.status], 20);
});

test("znany rekord z inna sygnatura -> BLOKADA (zmiana kontraktu)", async () => {
  const zmienione = { data: { ...ORZECZENIE.data, courtCases: [{ caseNumber: "I C 9999/24" }] } };
  const w = await zAtrapa(
    (req) => req.url.startsWith("/api/search")
      ? [200, "application/json", JSON.stringify({ items: [zmienione.data] })]
      : [200, "application/json", JSON.stringify(zmienione)],
    (env) => sonduj({ env }),
  );
  assert.equal(w.status, "BLOKADA");
});

test("pusta lista przypadkow = BLOKADA, nie sukces", async () => {
  const w = await sonduj({ przypadki: [] });
  assert.equal(w.status, "BLOKADA");
});
