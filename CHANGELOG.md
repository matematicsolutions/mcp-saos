# Changelog

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) +
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.3.1] - 2026-10-13

Aktualizacja zaleznosci (bezpieczenstwo). Bez zmian w kodzie serwera i w kontrakcie narzedzi.

### Security

- `npm audit`: 8 doradztw (1 krytyczne, 4 wysokie, 2 srednie, 1 niskie) -> 0. Zadna paczka nie doszla ani nie zniknela (porownanie zbiorow z lockfile'a); `@modelcontextprotocol/sdk` -> 1.32.1 i jego zaleznosci transportow HTTP (hono, proxy-addr, qs, ip-address, fast-uri i inne).
- Ekspozycja przed poprawka (zderzone z kodem): serwer uzywa wylacznie `StdioServerTransport` - zaleznosci HTTP SDK nie sa ladowane; doradztwo SDK dotyczy KLIENTA OAuth. Realna ekspozycja bliska zera - aktualizacja, bo tania i bez zmiany wersji glownej SDK.
- Weryfikacja: build, wszystkie bramki offline, zywy smoke 7/7 na SAOS.

## [1.3.0] - 2026-10-13

Odpornosc na ciche awarie zrodla (wzorce z oceny PawelHaracz/polish-caselaw-mcp, soba-labs/krs-mcp
i leniwyposel/sejm-mcp, 2026-10-13). Wersja minor: kody bledow sa rozdzielone (konkretniejsze niz `upstream_error`), ale zaden znany konsument nie rozgalezia sie na nich - PATRON czyta tylko `isError`, prawo-pl-mcp opakowuje bledy konektora we wlasny `upstream_error` (sprawdzone 2026-10-13).
klient branchujacy na `upstream_error` przy awarii zrodla dostanie teraz `upstream_maintenance`,
`upstream_unavailable`, `rate_limited`, `forbidden`, `not_found` albo `upstream_shape`. Opisy narzedzi
(tools/list) bez zmian - `tools.lock.json` przechodzi.

### Fixed

- **Przerwa techniczna SAOS** (HTTP 200 + strona HTML): szla do `JSON.parse` i wychodzila jako `upstream_error` "sprobuj ponownie" z wycinkiem HTML. Teraz `upstream_maintenance` (`retryable: false` - trwa godziny, nie ponawiac w petli).
- **Brak orzeczenia** (SAOS 404 + JSON, zmierzone na zywo): wychodzil jako `upstream_error` "blad komunikacji, ponow". Teraz `not_found` z wina `caller`.
- **Blad wewnatrz konektora** (np. w formatterze) udawal "Blad komunikacji z API SAOS". Teraz `internal_error` z wina `server`.
- **`saos_cite_check`**: nieudane pobranie pelnego tekstu konczylo sie cichym `null`, a wynik mowil tylko "skan pelnych tekstow: N" - przy przerwie SAOS werdykt mogl wyjsc z zerowego skanu. Teraz mianownik (`N z M`), `status: degraded` + `partial_result` (dlaczego / czego brakuje / jak uzupelnic, `coverage`) i odpowiedz ZACZYNA SIE od "Wynik niepelny: ...".
- **Smoke**: gdy narzedzie zwracalo blad innym tekstem niz "Blad komunikacji", test konczyl sie "PASS (no-error response received)". Teraz decyduje `isError`.

### Added

- Sonda zgodnosci `node test/sonda.mjs` (wzorzec soba-labs/krs-mcp #2): znany rekord SAOS id 543228 (I C 3346/24): `get_judgment` + `search_by_case`, przez protokol MCP do zbudowanego serwera; trojstan 0 OK / 10 UWAGI / 20 BLOKADA (przerwa techniczna i `retryable: true` = UWAGI); pusta lista kontroli = BLOKADA. Workflow `sonda-zgodnosci.yml` codziennie (bez automatycznych issue). Testy na atrapie `test/sonda.test.mjs`; na zywo 13.10: OK 2/2.
- `src/saos-http.ts`: jeden katalog kodow (`KODY`: kod -> `fault` caller/upstream/network/server, `retryable`, "co zrobic"); `structuredContent` bledu niesie `error_code`, `fault`, `retryable`, `retry_after_s`, `status`. `Retry-After` z sufitem 30 s.
- `structuredContent.provenance` w kazdym udanym wyniku: `source`, `retrieved_at`, `source_produced_at: null` (jawnie - SAOS go nie podaje), `processing` (wzorzec soba-labs/krs-mcp, warunki ponownego wykorzystania ISP).
- `SAOS_BASE_URL` (env) - testy E2E na lokalnej atrapie SAOS przez protokol MCP (`test/e2e-atrapa.test.mjs`).
- Smoke z pelnym mianownikiem: `get_judgment` (i 404 -> `not_found`) dostal przypadek zywy; TEST 7 porownuje narzedzia wywolane z `tools/list`.
- Bramka paczki `npm run test:package` (`npm pack --dry-run --json`; wymagane pliki wyprowadzone z `bin` + importow w `dist/`, pusta lista = BLOKADA).
- `release.yml`: krok "Run gates before publishing" (`npm test`, descriptor lock, bramka paczki) - do tej pory wydanie szlo bez zadnego testu.
- Drift test w obie strony dla kodow z `src/saos-http.ts`.

## [1.2.0] - 2026-07-13

Citator "czy wyrok zyje". **Backward-compatible** - istniejace 3 narzedzia bez zmian.

### Added

- Tool `saos_cite_check(caseNumber, courtType?, maxScan?, deepScan?)` - adaptacja koncepcji `cite_check` z chrisryugj/korean-law-mcp (MIT), kod od zera pod SAOS. Pipeline: sygnatura -> pelnotekstowe wyszukiwanie pozniejszych orzeczen cytujacych -> skan uzasadnien pod frazy przelamania linii orzeczniczej W OKNIE +-500 znakow wokol sygnatury -> werdykt `przelamanie_wykryte` / `uchwala_skladu_powiekszonego` / `nadal_cytowany` / `brak_cytowan_w_saos`.
- 11 wzorcow fraz (8 strong, 3 caution, w tym guard negacji dla "poglad odosobniony") - KAZDA fraza zweryfikowana zywym zapytaniem do SAOS API 2026-07-13, dowody w `docs/CITE-CHECK.md`. Egzemplarze przypiete w testach jednostkowych.
- `structuredContent`: `verdict`, `target`, `hits[]` (sygnatura cytujacego, data, fraza, fragment +-200 znakow - grounding), `disclaimer`, `citations` (kontrakt bez zmian).
- Jawna deklaracja ograniczen w KAZDEJ odpowiedzi citatora: baza SAOS nie obejmuje wszystkich orzeczen; brak trafien != potwierdzenie aktualnosci.
- Testy jednostkowe offline (`npm run test:unit`, 41 testow: parser sygnatury, granice slowa, okno skanu, guard negacji, tabela egzemplarzy) + TEST 5 live w smoke tescie. CI odpala `npm test` po buildzie.

### Fixed

- README: usuniete nieaktualne twierdzenie "baza historyczna do 2016-2018" - SAOS ma dobrze pokryte lata 2024-2026 (niejednolicie wg typu sadu), co kod deklarowal od 1.1.x.

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
