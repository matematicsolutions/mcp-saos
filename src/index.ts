#!/usr/bin/env node
/**
 * MCP server for Polish court judgments - SAOS (System Analizy Orzeczen Sadowych).
 *
 * Public REST API by Fundacja ePanstwo. No API key required.
 * Historical archive (~up to 2016-2018). NOT a live current-judgments source.
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
  if (params.judgmentDateTo) query.judgmentDateTo = params.judgmentDateTo;

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
      "Uwaga: SAOS to archiwum historyczne (dane glownie do ok. 2016-2018). " +
      "Do biezacego orzecznictwa uzyj portali sadow: sn.pl, orzeczenia.ms.gov.pl, trybunal.gov.pl."
    );
  }

  const lines: string[] = [
    `Znalezione: ${total} orzeczen (pokazano ${items.length}).`,
    "Uwaga: SAOS to archiwum historyczne - dane glownie do ok. 2016-2018.",
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
    "=== ORZECZENIE SAOS (archiwum historyczne, glownie do ok. 2016-2018) ===",
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
// Tool definitions
// ---------------------------------------------------------------------------

const TOOLS = [
  {
    name: "search",
    description:
      "Przeszukuje baze orzeczen sadow polskich w SAOS (System Analizy Orzeczen Sadowych). " +
      "WAZNE: SAOS to archiwum historyczne - dane siegaja glownie do ok. 2016-2018 (SN) i ok. 2018 (KIO). " +
      "NIE nadaje sie do orzeczen biezacych. Nie indeksuje sadow administracyjnych (WSA/NSA). " +
      "Przydatny do: analizy linii orzeczniczej, precedensow, orzeczen historycznych, " +
      "wyszukiwania po tresci / sygnatuze / sedzim / podstawie prawnej.",
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
    description:
      "Pobiera pelne orzeczenie z SAOS po jego numerycznym ID. " +
      "Zwraca metadane (sygnatura, sad, data, sklad, podstawy prawne), " +
      "streszczenie (jesli dostepne) oraz pierwsze 2000 znakow tresci. " +
      "WAZNE: SAOS to archiwum historyczne - dane glownie do ok. 2016-2018. " +
      "ID orzeczenia pochodzi z wynikow narzedzia 'search' lub 'search_by_case'.",
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
    description:
      "Skrot: szuka orzeczenia po sygnaturze akt (np. 'I ACa 772/13', 'IV CSK 123/15', 'KIO/UZP 100/12'). " +
      "Odpowiednik search z parametrem caseNumber. " +
      "WAZNE: SAOS to archiwum historyczne - dane glownie do ok. 2016-2018. " +
      "Jesli sygnatura nie znajdzie sie w SAOS, sprawa moze byc nowsza lub z sadu administracyjnego.",
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

const server = new Server(
  { name: "mcp-saos", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  })),
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const a = (args ?? {}) as Record<string, unknown>;

  try {
    switch (name) {
      case "search": {
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
        return { content: [{ type: "text", text: formatSearchResults(raw) }] };
      }

      case "get_judgment": {
        if (!a.id) {
          return {
            content: [{ type: "text", text: "Blad: parametr 'id' jest wymagany." }],
            isError: true,
          };
        }
        const raw = await saosGetJudgment(a.id as string | number);
        return { content: [{ type: "text", text: formatJudgment(raw) }] };
      }

      case "search_by_case": {
        if (!a.caseNumber) {
          return {
            content: [{ type: "text", text: "Blad: parametr 'caseNumber' jest wymagany." }],
            isError: true,
          };
        }
        const raw = await saosSearch({
          caseNumber: a.caseNumber as string,
          pageSize: PAGE_SIZE_DEFAULT,
        });
        return { content: [{ type: "text", text: formatSearchResults(raw) }] };
      }

      default:
        return {
          content: [{ type: "text", text: `Nieznane narzedzie: ${name}` }],
          isError: true,
        };
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      content: [
        {
          type: "text",
          text: `Blad komunikacji z API SAOS: ${msg}\n\nSprawdz polaczenie z internetem lub sprobuj ponownie za chwile.`,
        },
      ],
      isError: true,
    };
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
