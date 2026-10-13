// Ciche awarie SAOS dostaja nazwany kod, a nie "blad komunikacji, ponow" (2026-10-13).
//
// Wzorce z oceny PawelHaracz/polish-caselaw-mcp (warsztat ocen, 2026-10-10):
// - #1 strona "Przerwa techniczna" przychodzi jako HTTP 200 + text/html
//   (u zrodla: src/saos/client.ts:86-97, __tests__/saos-maintenance.test.ts:28-45);
//   u nas szla do JSON.parse i wychodzila jako ogolny upstream_error z wycinkiem HTML;
// - #2 kody bledu zrodla rozdzielone (timeout / network / notfound / ratelimited / http /
//   maintenance), wyrownane do kanonu 6b: rate_limited, upstream_unavailable, not_found...
// Zmierzone na zywo 2026-10-13: brak orzeczenia to 404 + JSON, a serwer mowil
// "upstream_error - retry raz" - zla wina i zle "ponawiaj".
//
// Lokalny serwer HTTP podaje fikstury przez prawdziwa sciezke fetchJson - zero sieci.
// Run: npm run test:unit

import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

import { fetchJson, SaosError, KODY, bladJakoWynik } from "../dist/saos-http.js";

// Ksztalt strony przerwy SAOS zaobserwowany u zrodla 2026-08-15 (PawelHaracz, test regresji).
const STRONA_PRZERWY = `<!DOCTYPE html>
<html><head><title>Przerwa techniczna</title></head>
<body>Trwa przerwa techniczna. Zapraszamy później.</body></html>`;

// Prawdziwa odpowiedz SAOS na nieistniejace ID (zmierzone 2026-10-13, id 999999999).
const BRAK_ORZECZENIA = JSON.stringify({
  error: {
    httpStatus: "404",
    reason: "ELEMENT DOES NOT EXIST",
    propertyName: null,
    message: "Judgment with id '999999999' does not exist",
  },
});

async function serwer(handler) {
  const s = http.createServer(handler);
  await new Promise((r) => s.listen(0, "127.0.0.1", r));
  const { port } = s.address();
  return { url: `http://127.0.0.1:${port}/api/search/judgments`, zamknij: () => s.close() };
}

function stala(status, contentType, body, headers = {}) {
  return (_req, res) => {
    res.writeHead(status, { "content-type": contentType, ...headers });
    res.end(body);
  };
}

async function blad(status, contentType, body, headers) {
  const { url, zamknij } = await serwer(stala(status, contentType, body, headers));
  try {
    await fetchJson(url);
    assert.fail("fetchJson mial rzucic");
  } catch (e) {
    return e;
  } finally {
    zamknij();
  }
}

test("przerwa techniczna HTML/200 -> upstream_maintenance, nie blad parsera", async () => {
  const e = await blad(200, "text/html;charset=UTF-8", STRONA_PRZERWY);
  assert.ok(e instanceof SaosError, `oczekiwano SaosError, jest ${e?.constructor?.name}: ${e?.message}`);
  assert.equal(e.code, "upstream_maintenance");
  assert.equal(e.retryable, false); // przerwa trwa godzinami - nie ponawiac w petli
  assert.equal(e.fault, "upstream");
  assert.doesNotMatch(e.message, /Unexpected token|Invalid JSON/);
});

test("inny HTML/200 (strona bledu proxy) -> upstream_shape, nie maintenance", async () => {
  const e = await blad(200, "text/html", "<html><body>502 Bad Gateway</body></html>");
  assert.ok(e instanceof SaosError);
  assert.equal(e.code, "upstream_shape");
});

test("zepsuty JSON z poprawnym naglowkiem -> upstream_shape", async () => {
  const e = await blad(200, "application/json", '{"items": [');
  assert.ok(e instanceof SaosError);
  assert.equal(e.code, "upstream_shape");
});

test("404 z JSON-em SAOS -> not_found (wina pytania, bez ponawiania)", async () => {
  const e = await blad(404, "application/json;charset=UTF-8", BRAK_ORZECZENIA);
  assert.ok(e instanceof SaosError);
  assert.equal(e.code, "not_found");
  assert.equal(e.fault, "caller");
  assert.equal(e.retryable, false);
});

test("429 -> rate_limited z Retry-After (sufit 30 s)", async () => {
  const e = await blad(429, "text/plain", "slow down", { "Retry-After": "120" });
  assert.ok(e instanceof SaosError);
  assert.equal(e.code, "rate_limited");
  assert.equal(e.retryable, true);
  assert.equal(e.retryAfterS, 30);
  assert.equal(e.status, 429);
});

test("403 -> forbidden, NIE ponawialne (wzorzec soba-labs/krs-mcp #4)", async () => {
  const e = await blad(403, "text/html", "<html>Forbidden</html>");
  assert.ok(e instanceof SaosError);
  assert.equal(e.code, "forbidden");
  assert.equal(e.retryable, false);
});

test("503 -> upstream_unavailable ze statusem", async () => {
  const e = await blad(503, "text/html", "<html>Service Unavailable</html>");
  assert.ok(e instanceof SaosError);
  assert.equal(e.code, "upstream_unavailable");
  assert.equal(e.status, 503);
  assert.equal(e.retryable, true);
});

test("timeout -> upstream_unavailable z wina sieci", async () => {
  const { url, zamknij } = await serwer(() => {}); // nigdy nie odpowiada
  try {
    await assert.rejects(fetchJson(url, 200), (e) => {
      assert.ok(e instanceof SaosError, `jest ${e?.constructor?.name}`);
      assert.equal(e.code, "upstream_unavailable");
      assert.equal(e.fault, "network");
      return true;
    });
  } finally {
    zamknij();
  }
});

test("kontrola pozytywna: prawdziwy JSON z charset przechodzi", async () => {
  const { url, zamknij } = await serwer(
    stala(200, "application/json;charset=UTF-8", JSON.stringify({ items: [{ id: 1 }] }))
  );
  try {
    const d = await fetchJson(url);
    assert.deepEqual(d, { items: [{ id: 1 }] });
  } finally {
    zamknij();
  }
});

test("bladJakoWynik: agent dostaje kod, wine i ponawialnosc w structuredContent", () => {
  const w = bladJakoWynik(new SaosError("upstream_maintenance", "SAOS: przerwa techniczna", { status: 200 }));
  assert.equal(w.isError, true);
  assert.match(w.content[0].text, /^\[upstream_maintenance\] /);
  assert.equal(w.structuredContent.error_code, "upstream_maintenance");
  assert.equal(w.structuredContent.fault, "upstream");
  assert.equal(w.structuredContent.retryable, false);
});

test("bladJakoWynik: wyjatek spoza SAOS to wina tego serwera, nie 'blad komunikacji'", () => {
  const w = bladJakoWynik(new TypeError("Cannot read properties of undefined"));
  assert.equal(w.structuredContent.error_code, "internal_error");
  assert.equal(w.structuredContent.fault, "server");
});

test("katalog: kazdy kod ma wine, ponawialnosc i 'co zrobic'", () => {
  for (const [kod, w] of Object.entries(KODY)) {
    assert.ok(["caller", "upstream", "network", "server"].includes(w.fault), kod);
    assert.equal(typeof w.retryable, "boolean", kod);
    assert.ok(w.coZrobic.trim(), kod);
  }
});
