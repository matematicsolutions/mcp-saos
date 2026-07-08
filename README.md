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

**Important limitation:** SAOS is a historical archive - data ingestion
stopped around 2016-2018. It is not suitable for current case law.
For recent matters, use: sn.pl, orzeczenia.ms.gov.pl, trybunal.gov.pl.

The database covers: common courts (COMMON), the Sad Najwyzszy (Supreme Court, SUPREME),
the Trybunal Konstytucyjny (Constitutional Tribunal, CONSTITUTIONAL_TRIBUNAL), the KIO (National Appeal Chamber, NATIONAL_APPEAL_CHAMBER).
Administrative courts (WSA/NSA) - no data in SAOS.

## MCP tools

| Tool | Description |
|---|---|
| `search` | Full-text and filtered search (court, judge, legal basis, dates) |
| `get_judgment` | Full judgment by ID from SAOS |
| `search_by_case` | Shortcut: search by case number (e.g. "I ACa 772/13") |

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

## Smoke test

```bash
npm run build
node test/smoke.mjs
```

The smoke test checks: `tools/list` (3 tools) and `tools/call search`
against the live SAOS API with the phrase "ochrona danych", court SUPREME.

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
- The database is historical (~up to 2016-2018) - the server always states this
  in every tool response.

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
