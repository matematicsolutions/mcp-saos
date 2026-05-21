# AGENTS.md - mcp-saos

Plik standardu [agents.md](https://agents.md) (Linux Foundation / Agentic AI Foundation) - kanoniczne instrukcje dla agentow AI pracujacych z tym repozytorium. Czytany natywnie przez Cursor, Codex (OpenAI), Jules (Google), Devin / Windsurf, Aider, Amp, Factory, GitHub Copilot.

## Cel projektu

Serwer **MCP (Model Context Protocol)** dla **orzecznictwa polskich sadow powszechnych, Sadu Najwyzszego, Trybunalu Konstytucyjnego i KIO** - przez API publicznej bazy SAOS (System Analizy Orzeczen Sadowych, `https://saos.org.pl`).

Jeden z 5 konektorow polskiego prawa MateMatic: [`mcp-saos`](https://github.com/matematicsolutions/mcp-saos) (ten), [`mcp-nsa`](https://github.com/matematicsolutions/mcp-nsa), [`mcp-isap`](https://github.com/matematicsolutions/mcp-isap), [`mcp-krs`](https://github.com/matematicsolutions/mcp-krs), [`mcp-eu-sparql`](https://github.com/matematicsolutions/mcp-eu-sparql).

Konektor jest wpinany przez `mcp-servers.json` w dowolnym kliencie zgodnym z protokolem (Claude Code, Patron, Cursor, Codex, Continue itp.).

## Kontekst MateMatic (TWARDE OGRANICZENIA)

Repo prowadzi [MateMatic Solutions](https://matematicsolutions.com). Konektor jest **infrastruktura zaufania** - obsluguje go dowolny produkt LegalTech wymagajacy cytowan z polskiego orzecznictwa.

- **Kazde wywolanie narzedzia MUSI zwracac `structuredContent.citations`** z: tytulem orzeczenia, URL kanonicznym (SAOS), sadem, data, sygnatura. To kontrakt produktu.
- **Bez cache'owania danych klienta** - konektor jest stateless, nie loguje zapytan.
- **Bez modyfikacji tresci** - zwracamy to co SAOS API zwraca, bez "ulepszania" / podsumowywania. Modyfikacja = utrata wartosci dowodowej.

## Narzedzia MCP (tools contract)

| Tool | Parametry kluczowe | Zwraca |
|---|---|---|
| `search` | `query`, `court_type?`, `date_from?`, `date_to?` | lista orzeczen z metadanymi + citations |
| `get_judgment` | `judgment_id` | pelny tekst orzeczenia + metadata + citations |
| `search_by_case` | `case_number` (sygnatura) | wszystkie orzeczenia danej sygnatury |

Pelny opis schema: `src/index.ts` + dokumentacja MCP w `README.md`.

## Build i test

```bash
npm install        # Node 20+
npm run build      # tsc -> dist/
npm start          # node dist/index.js (stdio transport)
npm run dev        # ts-node src/index.ts (development)
```

Test reczny przez Inspector MCP:

```bash
npx @modelcontextprotocol/inspector node dist/index.js
```

## Zasady kodu

- **TypeScript strict**. Bez `any` w nowym kodzie.
- **`@modelcontextprotocol/sdk` ^1.12.0** - SDK MCP, nie zmieniaj wersji bez sprawdzenia kompatybilnosci z Patron i innymi klientami.
- **Bez polskich znakow w commit messages**.
- **Bump CHANGELOG.md przy KAZDEJ zmianie kontraktu** narzedzia (SEMVER MAJOR).
- **Bez node_modules / dist w commitach** (sa w `.gitignore`).

## Czego NIE robic (twarde reguly)

- **NIE dodawaj tools ktore wysylaja dane uzytkownika do zewnetrznych API** poza SAOS. Konektor ma byc **single-source** (SAOS), kazdy dodatkowy source = osobne repo MCP.
- **NIE modyfikuj zwracanego tekstu orzeczenia** - to dane primary, integralne.
- **NIE cachuj zapytan z PII** - konektor jest stateless. Cache na poziomie klienta (Patron) z polityka retencji.
- **NIE breaking-changes bez bumpu MAJOR** w `package.json` i CHANGELOG.

## Zrodla prawdy (kolejnosc czytania)

1. [README.md](./README.md) - instalacja i przyklady wywolan
2. [CHANGELOG.md](./CHANGELOG.md) - historia wersji
3. `src/index.ts` - implementacja tools + schema
4. [API SAOS dokumentacja](https://saos.org.pl/help/index.php/dokumentacja-api) - upstream contract

## Kompatybilnosc agentow

Standard [AGENTS.md](https://agents.md). Dla Claude Code dodatkowo plik [CLAUDE.md](./CLAUDE.md).

Konektor jest agent-agnostic (MCP) - wpina sie w Claude Code, Patron, Cursor, Codex, Continue, Cline i kazdy klient zgodny z protokolem.

## Licencja

**MIT** - patrz [LICENSE](./LICENSE). Mozesz wpinac w dowolny produkt komercyjny / open source bez restrykcji.

Cytowanie: *MateMatic Solutions (2026), mcp-saos - MCP server dla polskiego orzecznictwa SAOS, https://github.com/matematicsolutions/mcp-saos, MIT.*
