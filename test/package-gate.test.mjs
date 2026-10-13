// Kontrola pozytywna bramki paczki: musi zatrzymac paczke bez modulu, ktory importuje index.js.
// Run: npm run test:unit (wymaga npm run build)

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { wymagane, sprawdzPaczke } from "./package-gate.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf-8"));

test("wymagane: bin + przechodnie importy wzgledne z dist/", () => {
  const w = wymagane(ROOT, pkg);
  for (const p of ["package.json", "dist/index.js", "dist/saos-http.js", "dist/cite-check.js"]) {
    assert.ok(w.has(p), `brak ${p} w wymaganych: ${[...w].join(", ")}`);
  }
});

test("paczka bez dist/saos-http.js -> BLOKADA z nazwa pliku", () => {
  const w = wymagane(ROOT, pkg);
  const pliki = [...w].filter((p) => p !== "dist/saos-http.js");
  const r = sprawdzPaczke(pliki, w);
  assert.equal(r.status, "BLOKADA");
  assert.ok(r.powody.some((p) => p.includes("dist/saos-http.js")));
});

test("pusta lista plikow paczki = BLOKADA, nie sukces", () => {
  assert.equal(sprawdzPaczke([], wymagane(ROOT, pkg)).status, "BLOKADA");
});

test("kompletna paczka = OK", () => {
  const w = wymagane(ROOT, pkg);
  assert.deepEqual(sprawdzPaczke([...w, "README.md"], w), { status: "OK", powody: [] });
});
