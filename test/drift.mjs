#!/usr/bin/env node
// Drift test - INSTRUCTIONS spojne z TOOLS array i typem ErrorCode.
//
// Cherry-pick wzorca z dograh v1.31.0 (BSD-2) + mcp-eu-compliance v0.2.0.
// Fail jesli:
//   1. Tool name w INSTRUCTIONS (\`name\` w backticks) nie ma w TOOLS
//   2. ErrorCode w typie TS nie jest udokumentowany w INSTRUCTIONS
//   3. errorResult(..., "<code>") uzywa kodu ktorego nie ma w typie ErrorCode
//
// Run: npm run drift

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(__dirname, "..", "src", "index.ts"), "utf-8");

const failures = [];

// -----------------------------------------------------------------------------
// 1. Tool names w INSTRUCTIONS musza istniec w TOOLS array
// -----------------------------------------------------------------------------

const instructionsMatch = SRC.match(/const INSTRUCTIONS = `([\s\S]*?)`;/);
if (!instructionsMatch) {
    failures.push("Nie znaleziono const INSTRUCTIONS w src/index.ts");
} else {
    const instructions = instructionsMatch[1];

    // Wycinam TOOLS array i z niej wyciagam nazwy
    const toolsBlock = SRC.match(/const TOOLS\s*=\s*\[([\s\S]*?)\]\s*as const;|const TOOLS\s*=\s*\[([\s\S]*?)\];/);
    const toolsSource = toolsBlock ? (toolsBlock[1] || toolsBlock[2] || "") : SRC;
    const toolsMatches = [...toolsSource.matchAll(/name:\s*"([a-z][a-z0-9_]+)"/g)];
    const registered = new Set(toolsMatches.map((m) => m[1]));

    // Tool names w INSTRUCTIONS - w backticks `tool_name` (snake_case, >3 chars)
    const referenced = new Set();
    for (const m of instructions.matchAll(/`([a-z][a-z0-9_]{3,})`/g)) {
        // Pomijamy znane konstrukcje JS/MCP zeby nie zlapac false positives
        const skip = new Set([
            "isError",
            "true",
            "false",
            "null",
            "undefined",
            "structuredContent",
        ]);
        if (!skip.has(m[1])) {
            referenced.add(m[1]);
        }
    }

    // Filter: tylko te ktore wygladaja jak snake_case z _ albo ktore wystepuja w TOOLS
    // (zeby nie tracic czasu na inne identyfikatory)
    for (const ref of referenced) {
        const looksLikeTool = ref.includes("_") || registered.has(ref);
        if (!looksLikeTool) continue;
        if (!registered.has(ref)) {
            failures.push(
                `INSTRUCTIONS referencuje tool '${ref}' ktorego nie ma w TOOLS. ` +
                    `Registered: ${[...registered].sort().join(", ")}`,
            );
        }
    }
}

// -----------------------------------------------------------------------------
// 2. ErrorCode w typie TS musi byc udokumentowany w INSTRUCTIONS
// -----------------------------------------------------------------------------

const typeMatch = SRC.match(/type ErrorCode\s*=\s*([^;]+);/);
if (!typeMatch) {
    failures.push("Nie znaleziono type ErrorCode w src/index.ts");
} else {
    const codesInType = new Set();
    for (const m of typeMatch[1].matchAll(/"(\w+)"/g)) {
        codesInType.add(m[1]);
    }

    const instructionsText = instructionsMatch ? instructionsMatch[1] : "";
    for (const code of codesInType) {
        const docPattern = new RegExp("\\b" + code + "\\b");
        if (!docPattern.test(instructionsText)) {
            failures.push(
                `ErrorCode '${code}' w typie TS nie jest udokumentowany w ` +
                    `INSTRUCTIONS sekcji "Iteracja po bledach". Dodaj wpis.`,
            );
        }
    }

    // 3. errorResult(..., "code") uzywa istniejacego ErrorCode
    for (const m of SRC.matchAll(/errorResult\([^,)]+,\s*"(\w+)"\)/g)) {
        if (!codesInType.has(m[1])) {
            failures.push(
                `errorResult uzywa kodu '${m[1]}' ktorego NIE ma w typie ErrorCode. ` +
                    `Dodaj do typu lub uzyj istniejacego.`,
            );
        }
    }
}

// -----------------------------------------------------------------------------
// 4. Kody zrodla z src/saos-http.ts - w obie strony (kanon MCP 6b, 2026-10-13)
//    Do 2026-10-13 `upstream_error` byl jedynym kodem awarii zrodla: przerwa
//    techniczna, 404 i bug w naszym formatterze wygladaly dla agenta tak samo.
// -----------------------------------------------------------------------------

const HTTP_SRC = readFileSync(join(__dirname, "..", "src", "saos-http.ts"), "utf-8");
const kodyTyp = HTTP_SRC.match(/export type SaosErrorCode\s*=\s*([^;]+);/);
const kodyZrodla = new Set(kodyTyp ? [...kodyTyp[1].matchAll(/"(\w+)"/g)].map((m) => m[1]) : []);
const kodyTabeli = new Set(
    [...(HTTP_SRC.match(/export const KODY[^{]*\{([\s\S]*?)\n\};/)?.[1] ?? "").matchAll(/^  (\w+): \{/gm)].map(
        (m) => m[1],
    ),
);
const rzucane = new Set([...HTTP_SRC.matchAll(/new SaosError\(\s*"(\w+)"/g)].map((m) => m[1]));
const typIndex = new Set(typeMatch ? [...typeMatch[1].matchAll(/"(\w+)"/g)].map((m) => m[1]) : []);
const wynikiIndex = new Set([...SRC.matchAll(/errorResult\([\s\S]*?,\s*"(\w+)"\s*\)/g)].map((m) => m[1]));

if (kodyZrodla.size === 0 || kodyTabeli.size === 0 || rzucane.size === 0) {
    failures.push("Pusta lista kodow z src/saos-http.ts = BLOKADA (regex nic nie znalazl).");
}
for (const k of kodyZrodla) {
    if (!typIndex.has(k)) failures.push(`Kod zrodla '${k}' nie jest w type ErrorCode w index.ts.`);
    if (!kodyTabeli.has(k)) failures.push(`Kod zrodla '${k}' nie ma wpisu w tabeli KODY.`);
}
for (const k of kodyTabeli) {
    if (!kodyZrodla.has(k)) failures.push(`Wpis KODY '${k}' nie jest w typie SaosErrorCode.`);
}
for (const k of rzucane) {
    if (!kodyZrodla.has(k)) failures.push(`new SaosError("${k}") - kodu nie ma w SaosErrorCode.`);
}
for (const k of typIndex) {
    if (!rzucane.has(k) && !wynikiIndex.has(k)) {
        failures.push(`ErrorCode '${k}' jest w typie, ale nic go nie rzuca (martwa obietnica w INSTRUCTIONS).`);
    }
}

// -----------------------------------------------------------------------------
// Report
// -----------------------------------------------------------------------------

if (failures.length === 0) {
    console.log("OK drift - INSTRUCTIONS i ErrorCode spojne z TOOLS i kodem.");
    process.exit(0);
}

console.error("FAIL drift - znaleziono " + failures.length + " problemow:");
for (const f of failures) {
    console.error("  - " + f);
}
process.exit(1);
