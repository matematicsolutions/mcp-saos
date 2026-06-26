# Changelog

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) +
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.2] — 2026-06-26

### Fixed

- serverInfo `version` zsynchronizowany z `package.json` (raportowal 1.1.0 mimo paczki 1.1.1). Kosmetyczne, kontrakt narzedzi bez zmian.

## [1.1.0] — 2026-05-25

Retrofit do kanonu MCP MateMatic (pattern z dograh-hq/dograh v1.31.0, BSD-2). **Backward-compatible** — istniejacy klienci dzialaja bez zmian.

### Added

- `instructions` w konstruktorze Server — procedural orchestration (kolejnosc wywolan, twarde ograniczenia: pokrycie nierowne / OCR daty / brak admin courts, iteracja po bledach, styl odpowiedzi). LLM widzi PRZED pierwszym tool call.
- `ToolAnnotations` per tool — `readOnlyHint=true`, `idempotentHint=true`, `destructiveHint=false`. Klient MCP moze auto-approve wywolania bez monitu.
- Strukturalne `ErrorCode` w odpowiedziach: `missing_arg`, `not_found`, `upstream_error`, `invalid_court_type`. Format `[code] tekst` w content + `structuredContent.error_code`.
- Walidacja `courtType` przed wywolaniem upstream API — jasny komunikat dla ADMINISTRATIVE (sady admin w mcp-nsa, nie tu).
- Drift test (`npm run drift`) — asercja spojnosci INSTRUCTIONS + ErrorCode + TOOLS + kodu errorResult().

## [1.0.0] — 2026-05-20

Initial public release.

Polish judgments: common courts, Supreme Court, Constitutional Tribunal, KIO (via SAOS API). 3 tools: search / get_judgment / search_by_case. structuredContent.citations contract.

### Highlights

- Node 18+ stdio MCP server, single `dist/index.js` entry.
- LIVE smoke-tested on real data.
- `structuredContent.citations` consumed by [Patron](https://github.com/matematicsolutions/patron)
  and any other MCP-aware legal agent.
- MIT license, 500 ms request throttle, zero secrets required.

[1.0.0]: https://github.com/matematicsolutions/mcp-saos/releases/tag/v1.0.0
