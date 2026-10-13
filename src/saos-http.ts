/**
 * HTTP do API SAOS + jeden katalog bledow zrodla (kanon MCP 6b/6c).
 *
 * Osobny modul, zeby testy (test/saos-http.test.mjs) mogly go importowac bez startu
 * serwera MCP na stdio.
 */

import https from "node:https";
import http from "node:http";
import { URL } from "node:url";

const USER_AGENT = "MateMatic-MCP-SAOS/1.0 (+https://matematic.co)";

/** Czyja wina: caller (pytanie), upstream (SAOS), network (siec), server (ten serwer). */
export type Fault = "caller" | "upstream" | "network" | "server";

export type SaosErrorCode =
  | "not_found"
  | "rate_limited"
  | "forbidden"
  | "upstream_unavailable"
  | "upstream_maintenance"
  | "upstream_shape"
  | "upstream_error"
  | "internal_error";

/** Jedna tabela: kod -> wina, czy ponawiac, co zrobic. Drift test pilnuje jej w obie strony. */
export const KODY: Record<SaosErrorCode, { fault: Fault; retryable: boolean; coZrobic: string }> = {
  not_found: {
    fault: "caller",
    retryable: false,
    coZrobic: "Sprawdz ID przez `search` / `search_by_case`; sady administracyjne (WSA/NSA) sa w mcp-nsa.",
  },
  rate_limited: {
    fault: "upstream",
    retryable: true,
    coZrobic: "Odczekaj retry_after_s i ponow raz; nie ponawiaj w petli.",
  },
  forbidden: {
    fault: "upstream",
    retryable: false,
    coZrobic: "SAOS odmowil dostepu. Nie ponawiaj i nie obchodz zabezpieczen; zglos czlowiekowi.",
  },
  upstream_unavailable: {
    fault: "upstream",
    retryable: true,
    coZrobic: "SAOS chwilowo nie odpowiada; ponow raz pozniej, potem powiedz uzytkownikowi o awarii.",
  },
  upstream_maintenance: {
    fault: "upstream",
    retryable: false,
    coZrobic:
      "SAOS ma przerwe techniczna (zwykle godziny). Powiedz o tym uzytkownikowi zamiast ponawiac; " +
      "to NIE jest brak orzeczen.",
  },
  upstream_shape: {
    fault: "upstream",
    retryable: false,
    coZrobic:
      "SAOS oddal cos innego niz JSON (strona bledu, captcha, zmiana kontraktu). To NIE jest brak " +
      "wynikow; powiedz uzytkownikowi o awarii zrodla.",
  },
  upstream_error: {
    fault: "upstream",
    retryable: false,
    coZrobic: "Nieoczekiwana odpowiedz SAOS; powiedz uzytkownikowi o awarii zamiast zgadywac wynik.",
  },
  internal_error: {
    fault: "server",
    retryable: false,
    coZrobic: "Blad tego serwera MCP, nie SAOS. Nie ponawiaj; zglos blad konektora.",
  },
};

/**
 * Wyjatek z narzedzia -> wynik MCP z kodem, wina i ponawialnoscia.
 * Wyjatek spoza SAOS (TypeError w formatterze itp.) to `internal_error` z wina `server` -
 * do 2026-10-13 kazdy taki blad szedl jako "Blad komunikacji z API SAOS, sprobuj ponownie".
 */
export function bladJakoWynik(err: unknown) {
  const e =
    err instanceof SaosError
      ? err
      : new SaosError(
          "internal_error",
          `Blad wewnetrzny konektora: ${err instanceof Error ? err.message : String(err)}`
        );
  const szczegoly = [`fault=${e.fault}`, `retryable=${e.retryable}`];
  if (e.retryAfterS !== undefined) szczegoly.push(`retry_after_s=${e.retryAfterS}`);
  if (e.status !== undefined) szczegoly.push(`status=${e.status}`);
  const structured: Record<string, unknown> = {
    error_code: e.code,
    fault: e.fault,
    retryable: e.retryable,
  };
  if (e.retryAfterS !== undefined) structured.retry_after_s = e.retryAfterS;
  if (e.status !== undefined) structured.status = e.status;
  return {
    content: [
      {
        type: "text" as const,
        text: `[${e.code}] ${e.message} (${szczegoly.join(", ")}). Co zrobic: ${KODY[e.code].coZrobic}`,
      },
    ],
    structuredContent: structured,
    isError: true,
  };
}

const SUFIT_RETRY_AFTER_S = 30;
// Strona przerwy SAOS przychodzi jako 200 + text/html (wzorzec PawelHaracz `src/saos/client.ts:86-97`).
const PRZERWA = /przerwa techniczna|maintenance/i;

/**
 * Klasyfikacja odpowiedzi SAOS. Czysta funkcja: status + typ + cialo -> JSON albo SaosError.
 * Typ zawartosci sprawdzamy ZANIM sparsujemy - inaczej strona HTML/200 konczy jako blad parsera.
 */
export function klasyfikuj(
  url: string,
  status: number,
  contentType: string,
  body: string,
  retryAfter?: string
): unknown {
  if (status === 404) {
    throw new SaosError("not_found", `SAOS nie ma takiego zasobu (404): ${url}`, { status });
  }
  if (status === 401 || status === 403) {
    throw new SaosError("forbidden", `SAOS odmowil dostepu (${status}): ${url}`, { status });
  }
  if (status === 429) {
    const ra = /^\d+$/.test((retryAfter ?? "").trim())
      ? Math.min(Number(retryAfter), SUFIT_RETRY_AFTER_S)
      : undefined;
    throw new SaosError("rate_limited", `SAOS ogranicza liczbe zapytan (429): ${url}`, {
      status,
      retryAfterS: ra,
    });
  }
  if (status >= 500) {
    throw new SaosError("upstream_unavailable", `SAOS odpowiedzial ${status}: ${url}`, { status });
  }
  if (status < 200 || status >= 300) {
    throw new SaosError("upstream_error", `SAOS odpowiedzial ${status}: ${url}`, { status });
  }
  if (!contentType.toLowerCase().includes("json")) {
    if (PRZERWA.test(body)) {
      throw new SaosError(
        "upstream_maintenance",
        `SAOS ma przerwe techniczna - zamiast danych oddal strone HTML (${status}): ${url}`,
        { status }
      );
    }
    throw new SaosError(
      "upstream_shape",
      `SAOS oddal ${contentType || "nieznany typ"} zamiast JSON (${status}): ${url}`,
      { status }
    );
  }
  try {
    return JSON.parse(body);
  } catch {
    // Poprawny naglowek, zepsute cialo - awaria zrodla, nie naszego kodu.
    throw new SaosError("upstream_shape", `SAOS oddal uszkodzony JSON: ${url}`, { status });
  }
}

export class SaosError extends Error {
  readonly code: SaosErrorCode;
  readonly fault: Fault;
  readonly retryable: boolean;
  readonly status?: number;
  readonly retryAfterS?: number;

  constructor(
    code: SaosErrorCode,
    message: string,
    opts: { status?: number; retryAfterS?: number; fault?: Fault } = {}
  ) {
    super(message);
    this.name = "SaosError";
    this.code = code;
    this.fault = opts.fault ?? KODY[code].fault;
    this.retryable = KODY[code].retryable;
    this.status = opts.status;
    this.retryAfterS = opts.retryAfterS;
  }
}

/** GET JSON z SAOS; kazda awaria wychodzi jako SaosError z kodem z KODY. */
export function fetchJson(urlStr: string, timeoutMs = 40000): Promise<unknown> {
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
      timeout: timeoutMs,
    };

    const req = transport.get(options, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf-8");
        try {
          resolve(
            klasyfikuj(
              urlStr,
              res.statusCode ?? 0,
              String(res.headers["content-type"] ?? ""),
              body,
              res.headers["retry-after"] as string | undefined
            )
          );
        } catch (e) {
          reject(e);
        }
      });
    });

    let przekroczony = false;
    req.on("timeout", () => {
      przekroczony = true;
      req.destroy();
      reject(
        new SaosError(
          "upstream_unavailable",
          `SAOS nie odpowiedzial w ${timeoutMs / 1000} s: ${urlStr}`,
          { fault: "network" }
        )
      );
    });

    req.on("error", (err: Error) => {
      if (przekroczony) return; // destroy() po timeoucie - blad juz zgloszony
      reject(
        new SaosError("upstream_unavailable", `Blad sieci (${err.message}): ${urlStr}`, {
          fault: "network",
        })
      );
    });
  });
}
