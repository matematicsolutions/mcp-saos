# mcp-saos

## Installation (one command)

Published on npm + the MCP Registry (`io.github.matematicsolutions/mcp-saos`). Run without cloning:

```bash
npx -y @matematicsolutions/mcp-saos
```

MCP client configuration (stdio):

```json
{ "mcpServers": { "mcp-saos": { "command": "npx", "args": ["-y", "@matematicsolutions/mcp-saos"] } } }
```

(Building from source - below.)

[![MCP](https://img.shields.io/badge/MCP-Server-blue)](https://modelcontextprotocol.io) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE) [![Node](https://img.shields.io/badge/Node-18%2B-brightgreen)](https://nodejs.org)

An MCP (Model Context Protocol) server for Polish case law - a connector to
SAOS (System Analizy Orzeczen Sadowych - the courts' public case-law database, run by Fundacja ePanstwo).

Part of the MateMatic "Polish legal AI" project. It runs as a separate process
communicating over stdio; the chat template (a fork of mike) calls it through the MCP protocol.

## What SAOS is

An open database of Polish court judgments. Public REST API, no key required.

**Coverage caveat:** coverage is broad and includes current judgments
(2024-2026 are well populated), but it is uneven by court type, and some
Supreme Court resolutions exist only as citations in other judgments.
Verify anything critical against sn.pl, orzeczenia.ms.gov.pl, trybunal.gov.pl.

The database covers: common courts (COMMON), the Sad Najwyzszy (Supreme Court, SUPREME),
the Trybunal Konstytucyjny (Constitutional Tribunal, CONSTITUTIONAL_TRIBUNAL), the KIO (National Appeal Chamber, NATIONAL_APPEAL_CHAMBER).
Administrative courts (WSA/NSA) - no data in SAOS.

## MCP tools

| Tool | Description |
|---|---|
| `search` | Full-text and filtered search (court, judge, legal basis, dates) |
| `get_judgment` | Full judgment by ID from SAOS |
| `search_by_case` | Shortcut: search by case number (e.g. "I ACa 772/13") |
| `saos_cite_check` | Citator: is the judgment still good law? Finds later citing judgments and scans them for overruling language near the signature |

### saos_cite_check - the citator

Give it a case number (a placeholder here; use a real one):

```json
{ "caseNumber": "III CZP NN/RR" }
```

It searches SAOS full-text for later judgments citing that signature, scans
their reasoning for departure phrases ("odstepuje od pogladu wyrazonego",
"nie podziela pogladu", "traci moc uchwala", "uchwala skladu siedmiu sedziow"
and others) within ~500 characters of the signature, and returns one of four
verdicts: `przelamanie_wykryte`, `uchwala_skladu_powiekszonego`,
`nadal_cytowany`, `brak_cytowan_w_saos`. Each hit includes a +-200 character
fragment for human verification.

Every phrase on the list was verified against live SAOS data - the evidence
table, the algorithm and the honest-limits section are in
[docs/CITE-CHECK.md](./docs/CITE-CHECK.md). The short version: no hits does
NOT mean the judgment is still good law, and every response says so.

## Requirements

- Node.js >= 18
- npm >= 9
- Internet access (live API saos.org.pl)

## Installation and build

```bash
git clone https://github.com/matematicsolutions/mcp-saos
cd mcp-saos
npm install
npm run build
```

After `npm run build`, the entry point is `dist/index.js`.

## Standalone run (test)

```bash
node dist/index.js
# the server listens on stdin/stdout, diagnostic logs go to stderr
```

## Wiring into the chat template (fork of mike) - mcp-servers.json

Add an entry to your client's MCP configuration (e.g. `mcp-servers.json`):

```json
{
  "name": "saos",
  "transport": "stdio",
  "command": "node",
  "args": ["C:/Users/<YOUR-USER>/mcp-saos/dist/index.js"],
  "enabled": true
}
```

Provide the absolute path to `dist/index.js`. On Windows use forward slashes `/`
or double backslashes `\\`.

## Tests

```bash
npm run build
npm test            # offline: drift test + unit tests (parser, window scan, phrase patterns)
node test/smoke.mjs # live: 5 checks against the real SAOS API, including the citator
```

The smoke test checks `tools/list` (4 tools), `search`, `search_by_case`,
a Constitutional Tribunal lookup and `saos_cite_check` on a Supreme Court
resolution with known later treatment.

## Architecture

```
stdin  -->  MCP JSON-RPC (stdio transport)  -->  src/index.ts
                                                      |
                                            SAOS REST API
                                     https://www.saos.org.pl/api
                                            /search/judgments
                                            /judgments/{id}
stdout <--  formatted text responses  <--
```

No external dependencies for HTTP/JSON - requests go through the built-in `node:https`.
The only production dependency: `@modelcontextprotocol/sdk`.

## Limitations and known pitfalls

- `pageSize` has a hard lower limit of 10 (SAOS returns HTTP 400 for less) -
  the server automatically enforces a minimum of 10.
- `courtType=ADMINISTRATIVE` returns empty results - SAOS does not index WSA/NSA.
- Dates in the database may contain OCR artifacts (e.g. "3013-12-04") - the case
  number is more reliable than the `judgmentDate` field.
- Coverage is uneven by court type - the server states the relevant caveats
  in every tool response.
- `saos_cite_check` is a heuristic. It reads the top citing judgments only,
  its phrase list cannot cover every way a court departs from a line of case
  law, and no hits does not confirm the judgment is current.

## License

MIT - see the LICENSE file for details.
Judgment data: Fundacja ePanstwo, open license (public API with no usage restrictions).

## Part of the MateMatic legal stack

This server is one of five MCP connectors covering Polish jurisdiction +
EU law, used by [Patron](https://github.com/matematicsolutions/patron)
(AGPL-3.0) and any other MCP-aware legal AI agent.

- **mcp-saos** (this repo) - common courts, Supreme Court, Constitutional Tribunal, KIO
- [mcp-nsa](https://github.com/matematicsolutions/mcp-nsa) - NSA + 16 WSA administrative courts
- [mcp-isap](https://github.com/matematicsolutions/mcp-isap) - Polish legislation (Dz.U. + M.P.)
- [mcp-krs](https://github.com/matematicsolutions/mcp-krs) - Polish company registry (KRS)
- [mcp-eu-sparql](https://github.com/matematicsolutions/mcp-eu-sparql) - EU law + CJEU (EUR-Lex)


All five MCP servers share the same `structuredContent.citations`
contract: each tool returns an array of `{title, url, snippet?, ...metadata}`
that legal agents can render directly in their citation panel.

See [matematicsolutions/.github](https://github.com/matematicsolutions)
for the full org profile.
