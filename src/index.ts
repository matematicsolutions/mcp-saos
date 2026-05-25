#!/usr/bin/env node
/**
 * MCP server for Polish court judgments - SAOS (System Analizy Orzeczen Sadowych).
 *
 * Public REST API by Fundacja ePanstwo. No API key required.
 * Broad coverage including current judgments (2024-2026 well populated).
 * Coverage is uneven by court type; administrative courts (WSA/NSA) are absent.
 * Note: OCR artifacts can produce malformed dates - verify in the source.
 *
 * Tools exposed:
 *   search          - full-text / filtered search over /api/search/judgments
 *   get_judgment    - single judgment by id via /api/judgments/{id}
 *   search_by_case  - shortcut: search by case number (sygnatura akt)
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import https from "node:https";
import http from "node:http";
import { URL } from "node:url";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SAOS_BASE = "https://www.saos.org.pl/api";
const USER_AGENT = "MateMatic-MCP-SAOS/1.0 (+https://matematic.co)";

// Minimum pageSize enforced by the SAOS API. Smaller values return HTTP 400.
const PAGE_SIZE_MIN = 10;
const PAGE_SIZE_DEFAULT = 10;

// ---------------------------------------------------------------------------
// HTTP helper - fetch JSON from a URL (no external deps)
// ---------------------------------------------------------------------------

function fetchJson(urlStr: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(urlStr);
    const transport = parsedUrl.protocol === "https:" ? https : http;

    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (parsedUrl.protocol === "https:" ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/json",
      },
      timeout: 40000,
    };

    const req = transport.get(options, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf-8");
        if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
          reject(
            new Error(
              `HTTP ${res.statusCode}: ${body.slice(0, 300)}`
            )
          );
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch {
          reject(new Error(`Invalid JSON response from SAOS: ${body.slice(0, 200)}`));
        }
      });
    });

    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Request to SAOS API timed out after 40s"));
    });

    req.on("error", (err: Error) => reject(err));
  });
}

// ---------------------------------------------------------------------------
// HTML stripping helper
// ---------------------------------------------------------------------------

function stripHtml(html: string): string {
  // Remove HTML tags and decode basic entities
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

// ---------------------------------------------------------------------------
// SAOS API functions
// ---------------------------------------------------------------------------

interface SearchParams {
  all?: string;
  caseNumber?: string;
  courtType?: string;
  judgeName?: string;
  referencedRegulation?: string;
  legalBase?: string;
  judgmentDateFrom?: string;
  judgmentDateTo?: string;
  pageSize?: number;
  pageNumber?: number;
}

async function saosSearch(params: SearchParams): Promise<unknown> {
  // Enforce minimum pageSize
  const size = Math.max(
    PAGE_SIZE_MIN,
    typeof params.pageSize === "number" ? params.pageSize : PAGE_SIZE_DEFAULT
  );

  const query: Record<string, string> = {
    pageSize: String(size),
    pageNumber: String(params.pageNumber ?? 0),
    sortingField: "JUDGMENT_DATE",
    sortingDirection: "DESC",
  };

  if (params.all) query.all = params.all;
  if (params.caseNumber) query.caseNumber = params.caseNumber;
  if (params.courtType) query.courtType = params.courtType;
  if (params.judgeName) query.judgeName = params.judgeName;
  if (params.referencedRegulation)
    query.referencedRegulation = params.referencedRegulation;
  if (params.legalBase) query.legalBase = params.legalBase;
  if (params.judgmentDateFrom) query.judgmentDateFrom = params.judgmentDateFrom;
  // Default the upper date bound to today. SAOS data contains OCR-mangled
  // dates (e.g. year 3013) which, under DESC date sorting, would otherwise
  // occupy the top result slots and push genuine recent judgments off-page.
  query.judgmentDateTo =
    params.judgmentDateTo ?? new Date().toISOString().slice(0, 10);

  const qs = new URLSearchParams(query).toString();
  return fetchJson(`${SAOS_BASE}/search/judgments?${qs}`);
}

async function saosGetJudgment(id: string | number): Promise<unknown> {
  const data = (await fetchJson(`${SAOS_BASE}/judgments/${id}`)) as Record<string, unknown>;
  return data["data"] ?? data;
}

// ---------------------------------------------------------------------------
// Response formatters
// ---------------------------------------------------------------------------

interface JudgmentItem {
  id?: number;
  courtType?: string;
  courtCases?: Array<{ caseNumber?: string }>;
  judgmentType?: string;
  judgmentDate?: string;
  division?: {
    court?: { name?: string };
    name?: string;
  };
  textContent?: string;
  judges?: Array<{ name?: string }>;
  keywords?: string[];
}

interface SearchResponse {
  items?: JudgmentItem[];
  info?: { totalResults?: number };
  links?: Array<{ rel?: string; href?: string }>;
}

function formatSearchResults(raw: unknown): string {
  const data = raw as SearchResponse;
  const items = data.items ?? [];
  const total = data.info?.totalResults ?? 0;

  if (items.length === 0) {
    return (
      "Brak wynikow w bazie SAOS dla podanych kryteriow.\n\n" +
      "Uwaga: pokrycie SAOS jest nierowne wg typu sadu. Sady administracyjne " +
      "(WSA/NSA) nie sa indeksowane - dla orzeczen administracyjnych uzyj " +
      "orzeczenia.nsa.gov.pl. Sprobuj tez innych slow kluczowych lub szerszego zakresu dat."
    );
  }

  const lines: string[] = [
    `Znalezione: ${total} orzeczen (pokazano ${items.length}).`,
    "Uwaga: daty bywaja znieksztalcone przez OCR (np. rok 3013) - przy " +
      "sortowaniu wg daty weryfikuj sygnature i date w zrodle. Sady " +
      "administracyjne (WSA/NSA) nie sa w SAOS.",
    "",
  ];

  for (const it of items) {
    const sig = it.courtCases?.[0]?.caseNumber ?? "brak_sygnatury";
    const courtName =
      it.division?.court?.name ?? it.division?.name ?? it.courtType ?? "nieznany";
    const date = it.judgmentDate ?? "?";
    const type = it.judgmentType ?? "";
    const link = `https://www.saos.org.pl/judgments/${it.id}`;

    // Strip HTML and truncate snippet
    const rawText = it.textContent ?? "";
    const snippet = stripHtml(rawText).slice(0, 200);

    lines.push(`[${it.id}] ${sig}`);
    lines.push(`  Data: ${date} | Typ: ${type} | Sad: ${courtName}`);
    lines.push(`  Link: ${link}`);
    if (snippet) {
      lines.push(`  Fragment: ${snippet}...`);
    }
    lines.push("");
  }

  // Next page hint
  const hasNext = (data.links ?? []).some((l) => l.rel === "next");
  if (hasNext && items.length < total) {
    lines.push("Wiecej wynikow - zwieksz pageNumber o 1.");
  }

  return lines.join("\n");
}

interface JudgmentData {
  id?: number;
  courtType?: string;
  courtCases?: Array<{ caseNumber?: string }>;
  judgmentType?: string;
  judgmentDate?: string;
  division?: { court?: { name?: string }; name?: string };
  judges?: Array<{ name?: string }>;
  keywords?: string[];
  summary?: string;
  textContent?: string;
  source?: { judgmentUrl?: string };
  legalBases?: Array<{ textExcerpt?: string; lawJournalEntry?: { title?: string } }>;
  referencedRegulations?: Array<{ text?: string }>;
}

function formatJudgment(raw: unknown): string {
  const d = raw as JudgmentData;
  const sig = d.courtCases?.[0]?.caseNumber ?? "brak_sygnatury";
  const courtName =
    d.division?.court?.name ?? d.division?.name ?? d.courtType ?? "nieznany";
  const judgesList = (d.judges ?? [])
    .map((j) => j.name ?? "")
    .filter(Boolean)
    .join(", ");
  const kws = (d.keywords ?? []).join(", ");
  const sourceUrl = d.source?.judgmentUrl ?? "-";
  const saosUrl = `https://www.saos.org.pl/judgments/${d.id}`;

  const legalBases = (d.legalBases ?? [])
    .slice(0, 5)
    .map((lb) => lb.textExcerpt ?? lb.lawJournalEntry?.title ?? "")
    .filter(Boolean)
    .join("; ");

  const refs = (d.referencedRegulations ?? [])
    .slice(0, 5)
    .map((r) => r.text ?? "")
    .filter(Boolean)
    .join("; ");

  const summary = stripHtml(d.summary ?? "").slice(0, 800);
  const textRaw = stripHtml(d.textContent ?? "");
  // Return up to 2000 chars of the judgment text
  const textPreview = textRaw.slice(0, 2000);

  const lines: string[] = [
    "=== ORZECZENIE SAOS ===",
    "",
    `Sygnatura  : ${sig}`,
    `ID SAOS    : ${d.id}`,
    `Typ sadu   : ${d.courtType ?? "?"}`,
    `Sad        : ${courtName}`,
    `Data       : ${d.judgmentDate ?? "?"}`,
    `Typ        : ${d.judgmentType ?? "?"}`,
    `Sklad      : ${judgesList || "-"}`,
    `Slowa klucz: ${kws || "-"}`,
  ];

  if (legalBases) lines.push(`Podst. prawna: ${legalBases}`);
  if (refs) lines.push(`Przyw. akty  : ${refs}`);

  lines.push("", `SAOS URL   : ${saosUrl}`);
  lines.push(`Oryginal   : ${sourceUrl}`);

  if (summary) {
    lines.push("", "--- Streszczenie ---", summary);
  }

  if (textPreview) {
    lines.push(
      "",
      `--- Tresc (pierwsze 2000 znakow z ${textRaw.length} lacznie) ---`,
      textPreview
    );
    if (textRaw.length > 2000) {
      lines.push(`[...] Skrocono. Pelna tresc: ${saosUrl}`);
    }
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Structured citations builders
// ---------------------------------------------------------------------------
//
// Klient MCP (Patron) czyta result.structuredContent.citations zeby
// wystawic w panelu UI liste powiazanych orzeczen obok streamowanej odpowiedzi.
// Kontrakt: kazdy obiekt ma title (etykieta) i/lub url (zrodlo). Pozostale
// pola sa swobodne i ladowane do metadata po stronie klienta.

interface SaosCitation {
  title: string;
  url: string;
  snippet?: string;
  case_number?: string;
  court?: string;
  judgment_date?: string;
  judgment_type?: string;
  saos_id?: number;
  court_type?: string;
}

function buildSearchCitations(raw: unknown): SaosCitation[] {
  const data = raw as SearchResponse;
  const items = data.items ?? [];
  const out: SaosCitation[] = [];
  for (const it of items) {
    if (it.id === undefined) continue;
    const sig = it.courtCases?.[0]?.caseNumber ?? "";
    const courtName =
      it.division?.court?.name ?? it.division?.name ?? it.courtType ?? "";
    const date = it.judgmentDate ?? "";
    const snippet = stripHtml(it.textContent ?? "").slice(0, 200);
    const title = [sig, courtName].filter(Boolean).join(" - ") || `SAOS #${it.id}`;

    out.push({
      title,
      url: `https://www.saos.org.pl/judgments/${it.id}`,
      ...(snippet && { snippet }),
      ...(sig && { case_number: sig }),
      ...(courtName && { court: courtName }),
      ...(date && { judgment_date: date }),
      ...(it.judgmentType && { judgment_type: it.judgmentType }),
      saos_id: it.id,
      ...(it.courtType && { court_type: it.courtType }),
    });
  }
  return out;
}

function buildJudgmentCitation(raw: unknown): SaosCitation | null {
  const d = raw as JudgmentData;
  if (d.id === undefined) return null;
  const sig = d.courtCases?.[0]?.caseNumber ?? "";
  const courtName =
    d.division?.court?.name ?? d.division?.name ?? d.courtType ?? "";
  const snippet = stripHtml(d.textContent ?? "").slice(0, 200);
  const title = [sig, courtName].filter(Boolean).join(" - ") || `SAOS #${d.id}`;
  return {
    title,
    url: `https://www.saos.org.pl/judgments/${d.id}`,
    ...(snippet && { snippet }),
    ...(sig && { case_number: sig }),
    ...(courtName && { court: courtName }),
    ...(d.judgmentDate && { judgment_date: d.judgmentDate }),
    ...(d.judgmentType && { judgment_type: d.judgmentType }),
    saos_id: d.id,
    ...(d.courtType && { court_type: d.courtType }),
  };
}

// ---------------------------------------------------------------------------
// Instructions (procedural orchestration) - wstrzykiwane przez Server do
// system promptu klienta MCP. LLM widzi PRZED pierwszym tool call.
// Drift test (test/drift.mjs) failuje jesli tool wymieniony nie jest w
// TOOLS, albo ErrorCode w typie TS nie udokumentowany w INSTRUCTIONS.
// Pattern z dograh-hq/dograh v1.31.0 (BSD-2), zaadaptowany na MateMatic.
// ---------------------------------------------------------------------------

const INSTRUCTIONS = `Ten serwer MCP udostepnia orzeczenia polskich sadow z bazy SAOS (saos.org.pl) - sady powszechne, Sad Najwyzszy, Trybunal Konstytucyjny, KIO. Bez cache'owania, bez modyfikacji tresci - dane primary z API publicznego (Fundacja ePanstwo, bez klucza).

## Kolejnosc wywolan

### Szukanie orzecznictwa
1. \`search_by_case\` - jesli uzytkownik podal sygnature akt (np. "I ACa 772/13", "IV CSK 123/15") - to skrot, najszybciej.
2. \`search\` - szerokie szukanie po tresci, podstawie prawnej, sedzim, dacie, typie sadu. Zwraca paginowane wyniki (default 10/strona, max 100).
3. \`get_judgment\` - pelne orzeczenie po ID numerycznym z wynikow search. Zwraca metadata + pierwsze 2000 znakow tresci.

## Twarde ograniczenia

- **Pokrycie nierowne** - sady powszechne dobrze, SN/TK/KIO obecne. **Sady administracyjne (WSA/NSA) NIE sa w SAOS** - dla nich uzyj mcp-nsa (orzeczenia.nsa.gov.pl).
- **Daty znieksztalcone przez OCR** - mozesz zobaczyc "rok 3013" lub inne nielogiczne. Domyslny upper bound to dzisiaj, zeby OCR-mangled daty nie zalaly DESC sort. Weryfikuj sygnature i date w zrodle (saos.org.pl/judgments/{id}).
- **Bez modyfikacji tresci** - zwracamy verbatim z SAOS. NIE prosc o parafraze "lepszym jezykiem" - to wartosc dowodowa.
- **Stateless, bez cache PII** - kazde wywolanie idzie do upstream API. NIE polegaj na ciaglosci sesji - klient (Patron) sam zarzadza cache i retencja.
- **\`structuredContent.citations\`** zawsze wypelnione: title, url (saos.org.pl/judgments/{id}), case_number, court, judgment_date, snippet. Cytuj te citations w odpowiedzi koncowej.

## Iteracja po bledach

Tool zwraca \`isError: true\` + tekst z prefixem \`[code]\`. Typowe kody:
- \`missing_arg\` - brakujacy wymagany parametr (np. id w get_judgment, caseNumber w search_by_case). Przeczytaj inputSchema.
- \`not_found\` - orzeczenie/sygnatura nie ma w SAOS. Sprobuj szerszej daty / innej sygnatury, lub czy to nie WSA/NSA (osobny konektor).
- \`upstream_error\` - blad komunikacji z API SAOS (HTTP 5xx, timeout 40s). Retry raz przed surface do uzytkownika.
- \`invalid_court_type\` - klient podal \`ADMINISTRATIVE\` lub inny niedozwolony typ. Dozwolone: COMMON, SUPREME, CONSTITUTIONAL_TRIBUNAL, NATIONAL_APPEAL_CHAMBER.

## Styl odpowiedzi

- Cytuj sygnature w pelnej formie z sadem: "I ACa 772/13 (SA Warszawa, 2013-09-15)".
- Przy linii orzeczniczej (\`search\` z legalBase) sortuj wyniki chronologicznie i komentuj zmiany linii.
- NIE wymyslaj sygnatur ani sklad ow sedziowskich - kazda informacja z \`structuredContent.citations\`.
- Disclaimer SAOS (pokrycie nierowne, OCR daty, brak admin courts) zostaw w odpowiedzi przy szerokim szukaniu.`;

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

const READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true,
  idempotentHint: true,
  destructiveHint: false,
  openWorldHint: true, // upstream API moze zwracac inne wyniki w czasie
} as const;

const TOOLS = [
  {
    name: "search",
    annotations: READ_ONLY_ANNOTATIONS,
    description:
      "Przeszukuje baze orzeczen sadow polskich w SAOS (System Analizy Orzeczen Sadowych). " +
      "Pokrycie obejmuje takze orzeczenia biezace (lata 2024-2026 sa dobrze reprezentowane), " +
      "ale jest nierowne wg typu sadu. Sady administracyjne (WSA/NSA) NIE sa indeksowane. " +
      "Daty bywaja znieksztalcone przez OCR - weryfikuj sygnature i date w zrodle. " +
      "Przydatny do: analizy linii orzeczniczej, precedensow, " +
      "wyszukiwania po tresci / sygnatuze / sedzim / podstawie prawnej. " +
      "Bledy: `invalid_court_type` (zly enum), `upstream_error` (HTTP/timeout API).",
    inputSchema: {
      type: "object",
      properties: {
        all: {
          type: "string",
          description: "Wyszukiwanie pelnotekstowe - slowo lub fraza w tresci orzeczenia.",
        },
        caseNumber: {
          type: "string",
          description: "Sygnatura akt, np. 'I ACa 772/13' lub 'IV CSK 123/15'.",
        },
        courtType: {
          type: "string",
          enum: ["COMMON", "SUPREME", "CONSTITUTIONAL_TRIBUNAL", "NATIONAL_APPEAL_CHAMBER"],
          description:
            "Typ sadu: COMMON=sady powszechne, SUPREME=Sad Najwyzszy, " +
            "CONSTITUTIONAL_TRIBUNAL=Trybunal Konstytucyjny, " +
            "NATIONAL_APPEAL_CHAMBER=Krajowa Izba Odwolawcza (KIO). " +
            "NIE uzywaj ADMINISTRATIVE - sady admin nie sa w SAOS.",
        },
        judgeName: {
          type: "string",
          description: "Nazwisko sedziego, np. 'Kowalski'.",
        },
        referencedRegulation: {
          type: "string",
          description: "Przywolany akt prawny, np. 'ustawa o ochronie danych osobowych'.",
        },
        legalBase: {
          type: "string",
          description: "Podstawa prawna, np. 'art. 415 kc' lub 'art. 6 RODO'.",
        },
        dateFrom: {
          type: "string",
          description: "Data orzeczenia od (format YYYY-MM-DD), np. '2015-01-01'.",
        },
        dateTo: {
          type: "string",
          description: "Data orzeczenia do (format YYYY-MM-DD), np. '2016-12-31'.",
        },
        pageSize: {
          type: "number",
          description: "Liczba wynikow na strone (min 10, max 100). Domyslnie 10.",
          minimum: 10,
          maximum: 100,
        },
        pageNumber: {
          type: "number",
          description: "Numer strony (od 0). Do paginacji wynikow.",
          minimum: 0,
        },
      },
      required: [],
    },
  },
  {
    name: "get_judgment",
    annotations: READ_ONLY_ANNOTATIONS,
    description:
      "Pobiera pelne orzeczenie z SAOS po jego numerycznym ID. " +
      "Zwraca metadane (sygnatura, sad, data, sklad, podstawy prawne), " +
      "streszczenie (jesli dostepne) oraz pierwsze 2000 znakow tresci. " +
      "ID orzeczenia pochodzi z wynikow narzedzia 'search' lub 'search_by_case'. " +
      "Bledy: `missing_arg` (brak id), `not_found` (id poza baza), `upstream_error`.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: ["string", "number"],
          description: "Numeryczne ID orzeczenia w bazie SAOS, np. 352475 lub '31345'.",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "search_by_case",
    annotations: READ_ONLY_ANNOTATIONS,
    description:
      "Skrot: szuka orzeczenia po sygnaturze akt (np. 'I ACa 772/13', 'IV CSK 123/15', 'KIO/UZP 100/12'). " +
      "Odpowiednik search z parametrem caseNumber. " +
      "Jesli sygnatura nie znajdzie sie w SAOS, sprawa moze byc z sadu administracyjnego " +
      "(WSA/NSA - nieindeksowane) lub jeszcze nieopublikowana w bazie. " +
      "Bledy: `missing_arg` (brak caseNumber), `upstream_error`.",
    inputSchema: {
      type: "object",
      properties: {
        caseNumber: {
          type: "string",
          description: "Sygnatura akt, np. 'I ACa 772/13'.",
        },
      },
      required: ["caseNumber"],
    },
  },
] as const;

// ---------------------------------------------------------------------------
// MCP Server setup
// ---------------------------------------------------------------------------

// Strukturalne kody bledow - drift test asercja ze kazdy tu uzyty jest
// udokumentowany w INSTRUCTIONS i kazdy w errorResult() istnieje w typie.
type ErrorCode =
  | "missing_arg"
  | "not_found"
  | "upstream_error"
  | "invalid_court_type";

function errorResult(text: string, code: ErrorCode) {
  return {
    content: [{ type: "text" as const, text: `[${code}] ${text}` }],
    structuredContent: { error_code: code },
    isError: true,
  };
}

const VALID_COURT_TYPES = new Set([
  "COMMON",
  "SUPREME",
  "CONSTITUTIONAL_TRIBUNAL",
  "NATIONAL_APPEAL_CHAMBER",
]);

const server = new Server(
  { name: "mcp-saos", version: "1.1.0" },
  { capabilities: { tools: {} }, instructions: INSTRUCTIONS }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
    annotations: t.annotations,
  })),
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const a = (args ?? {}) as Record<string, unknown>;

  try {
    switch (name) {
      case "search": {
        if (a.courtType && !VALID_COURT_TYPES.has(String(a.courtType))) {
          return errorResult(
            `courtType '${a.courtType}' niedozwolony. Uzyj: ${[...VALID_COURT_TYPES].join(", ")}. NIE uzywaj ADMINISTRATIVE (sady admin nie sa w SAOS - uzyj mcp-nsa).`,
            "invalid_court_type"
          );
        }
        const raw = await saosSearch({
          all: a.all as string | undefined,
          caseNumber: a.caseNumber as string | undefined,
          courtType: a.courtType as string | undefined,
          judgeName: a.judgeName as string | undefined,
          referencedRegulation: a.referencedRegulation as string | undefined,
          legalBase: a.legalBase as string | undefined,
          judgmentDateFrom: a.dateFrom as string | undefined,
          judgmentDateTo: a.dateTo as string | undefined,
          pageSize: a.pageSize as number | undefined,
          pageNumber: a.pageNumber as number | undefined,
        });
        return {
          content: [{ type: "text", text: formatSearchResults(raw) }],
          structuredContent: { citations: buildSearchCitations(raw) },
        };
      }

      case "get_judgment": {
        if (!a.id) {
          return errorResult("parametr 'id' jest wymagany.", "missing_arg");
        }
        const raw = await saosGetJudgment(a.id as string | number);
        if (!raw || (typeof raw === "object" && Object.keys(raw).length === 0)) {
          return errorResult(
            `Orzeczenie ID ${a.id} nie znalezione w SAOS. Sprawdz ID przez 'search' / 'search_by_case' lub czy nie jest to sad administracyjny (WSA/NSA - uzyj mcp-nsa).`,
            "not_found"
          );
        }
        const citation = buildJudgmentCitation(raw);
        return {
          content: [{ type: "text", text: formatJudgment(raw) }],
          structuredContent: { citations: citation ? [citation] : [] },
        };
      }

      case "search_by_case": {
        if (!a.caseNumber) {
          return errorResult("parametr 'caseNumber' jest wymagany.", "missing_arg");
        }
        const raw = await saosSearch({
          caseNumber: a.caseNumber as string,
          pageSize: PAGE_SIZE_DEFAULT,
        });
        return {
          content: [{ type: "text", text: formatSearchResults(raw) }],
          structuredContent: { citations: buildSearchCitations(raw) },
        };
      }

      default:
        return errorResult(`Nieznane narzedzie: ${name}`, "missing_arg");
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return errorResult(
      `Blad komunikacji z API SAOS: ${msg}. Sprawdz polaczenie lub sprobuj ponownie.`,
      "upstream_error"
    );
  }
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Log to stderr only - stdout is reserved for MCP JSON-RPC protocol
  process.stderr.write("mcp-saos server started (stdio transport)\n");
}

main().catch((err) => {
  process.stderr.write(`Fatal error: ${err}\n`);
  process.exit(1);
});
