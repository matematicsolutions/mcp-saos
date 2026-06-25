# mcp-saos

## Instalacja (jedna komenda)

Opublikowany na npm + MCP Registry (`io.github.matematicsolutions/mcp-saos`). Uruchomienie bez klonowania:

```bash
npx -y @matematicsolutions/mcp-saos
```

Konfiguracja klienta MCP (stdio):

```json
{ "mcpServers": { "mcp-saos": { "command": "npx", "args": ["-y", "@matematicsolutions/mcp-saos"] } } }
```

(Budowanie ze źródeł — niżej.)

[![MCP](https://img.shields.io/badge/MCP-Server-blue)](https://modelcontextprotocol.io) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE) [![Node](https://img.shields.io/badge/Node-18%2B-brightgreen)](https://nodejs.org)

Serwer MCP (Model Context Protocol) dla polskiego orzecznictwa - konektor do
SAOS (System Analizy Orzeczen Sadowych, Fundacja ePanstwo).

Czesc projektu **MateMatic "polski legal AI"**. Dziala jako osobny proces
komunikujacy sie przez stdio; szablon czatu (fork mike) wola go przez protokol MCP.

## Czym jest SAOS

Otwarta baza orzeczen sadow polskich. Publiczne REST API, bez klucza.

**Wazne ograniczenie:** SAOS to archiwum historyczne - ingestja danych
zatrzymala sie ok. 2016-2018. Nie nadaje sie do biezacego orzecznictwa.
Do spraw aktualnych: sn.pl, orzeczenia.ms.gov.pl, trybunal.gov.pl.

Baza pokrywa: sady powszechne (COMMON), Sad Najwyzszy (SUPREME),
Trybunal Konstytucyjny (CONSTITUTIONAL_TRIBUNAL), KIO (NATIONAL_APPEAL_CHAMBER).
Sady administracyjne (WSA/NSA) - brak danych w SAOS.

## Narzedzia MCP

| Narzedzie | Opis |
|---|---|
| `search` | Wyszukiwanie pelnotekstowe i filtrowane (sad, sedzia, podstawa prawna, daty) |
| `get_judgment` | Pelne orzeczenie po ID z SAOS |
| `search_by_case` | Skrot: szukaj po sygnaturze akt (np. "I ACa 772/13") |

## Wymagania

- Node.js >= 18
- npm >= 9
- Dostep do internetu (live API saos.org.pl)

## Instalacja i budowanie

```bash
git clone https://github.com/matematicsolutions/mcp-saos
cd mcp-saos
npm install
npm run build
```

Po `npm run build` plik startowy to `dist/index.js`.

## Uruchomienie standalone (test)

```bash
node dist/index.js
# serwer nasłuchuje na stdin/stdout, logi diagnostyczne na stderr
```

## Podpiecie do szablonu czatu (fork mike) - mcp-servers.json

Dodaj wpis do konfiguracji MCP swojego klienta (np. `mcp-servers.json`):

```json
{
  "name": "saos",
  "transport": "stdio",
  "command": "node",
  "args": ["C:/Users/<TWOJ-UZYTKOWNIK>/mcp-saos/dist/index.js"],
  "enabled": true
}
```

Podaj bezwzgledna sciezke do `dist/index.js`. Na Windows uzyj slashow `/`
lub podwojnych ukosnikow `\\`.

## Smoke test

```bash
npm run build
node test/smoke.mjs
```

Smoke test sprawdza: `tools/list` (3 narzedzia) i `tools/call search`
na zywym API SAOS z fraz "ochrona danych", sad SUPREME.

## Architektura

```
stdin  -->  MCP JSON-RPC (stdio transport)  -->  src/index.ts
                                                      |
                                            SAOS REST API
                                     https://www.saos.org.pl/api
                                            /search/judgments
                                            /judgments/{id}
stdout <--  formatted text responses  <--
```

Brak zewnetrznych zaleznoscijsonow - HTTP przez wbudowany `node:https`.
Jedyna zaleznosc produkcyjna: `@modelcontextprotocol/sdk`.

## Ograniczenia i znane pulapki

- `pageSize` ma twardy dolny limit 10 (SAOS zwraca HTTP 400 dla mniej) -
  serwer automatycznie wymusza minimum 10.
- `courtType=ADMINISTRATIVE` zwraca puste wyniki - SAOS nie indeksuje WSA/NSA.
- Daty w bazie moga zawierac artefakty OCR (np. "3013-12-04") - sygnatura
  akt jest pewniejsza niz pole `judgmentDate`.
- Baza jest historyczna (~do 2016-2018) - serwer zawsze informuje o tym
  w kazdej odpowiedzi narzedzia.

## Licencja

MIT - szczegoly w pliku LICENSE.
Dane orzeczen: Fundacja ePanstwo, otwarta licencja (API publiczne bez ograniczen uzycia).

## Part of the MateMatic legal stack

This server is one of five MCP connectors covering Polish jurisdiction +
EU law, used by [Patron](https://github.com/matematicsolutions/patron)
(AGPL-3.0) and any other MCP-aware legal AI agent.

- **mcp-saos** (this repo) — common courts, Supreme Court, Constitutional Tribunal, KIO
- [mcp-nsa](https://github.com/matematicsolutions/mcp-nsa) — NSA + 16 WSA administrative courts
- [mcp-isap](https://github.com/matematicsolutions/mcp-isap) — Polish legislation (Dz.U. + M.P.)
- [mcp-krs](https://github.com/matematicsolutions/mcp-krs) — Polish company registry (KRS)
- [mcp-eu-sparql](https://github.com/matematicsolutions/mcp-eu-sparql) — EU law + CJEU (EUR-Lex)


All five MCP servers share the same `structuredContent.citations`
contract: each tool returns an array of `{title, url, snippet?, ...metadata}`
that legal agents can render directly in their citation panel.

See [matematicsolutions/.github](https://github.com/matematicsolutions)
for the full org profile.
