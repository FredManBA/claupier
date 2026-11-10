import { textWidth } from "./font";
import type { LimitWindow, Period, Settings, Snapshot, Totals } from "./types";

// En todos los formatos, cada tramo se elige con el valor ya redondeado:
// así 999.996 no sale como «$1000.00» ni 99.97 como «$100.0».

export type MoneySettings = Pick<Settings, "currency" | "localSymbol" | "localPerUsd">;

/**
 * El monto en la moneda elegida. Las fichas siempre valen dólares; con otra
 * moneda solo cambia lo que se escribe. Las monedas de cambio alto (colones,
 * yenes, pesos colombianos…) no muestran centavos.
 */
function inCurrency(usd: number, s: MoneySettings) {
  const safe = Number.isFinite(usd) ? Math.max(0, usd) : 0;
  if (s.currency === "local") {
    const rate = Number.isFinite(s.localPerUsd) && s.localPerUsd > 0 ? s.localPerUsd : 1;
    return { symbol: s.localSymbol.trim() || "¤", value: safe * rate, cents: rate < 20 };
  }
  return { symbol: "$", value: safe, cents: true };
}

/** Dinero con todo el detalle que quepa en una placa. */
export function formatMoney(usd: number, s: MoneySettings): string {
  const { symbol, value: v, cents } = inCurrency(usd, s);
  if (v >= 9_950_000) return `${symbol}${Math.round(v / 1e6)}M`;
  if (v >= 999_500) return `${symbol}${(v / 1e6).toFixed(1)}M`;
  if (v >= 99_950) return `${symbol}${Math.round(v / 1000)}K`;
  if (v >= 9999.5) return `${symbol}${(v / 1000).toFixed(1)}K`;
  if (cents && v < 999.995) return `${symbol}${v.toFixed(2)}`;
  return `${symbol}${Math.round(v)}`;
}

/** Dinero en pocos caracteres, para espacios chicos (los rodillos y la píldora). */
export function formatMoneyShort(usd: number, s: MoneySettings): string {
  const { symbol, value: v, cents } = inCurrency(usd, s);
  if (cents && v < 9.995) return `${symbol}${v.toFixed(2)}`;
  if (cents && v < 99.95) return `${symbol}${v.toFixed(1)}`;
  if (v < 9999.5) return `${symbol}${Math.round(v)}`;
  if (v < 99_500) return `${symbol}${Math.round(v / 1000)}K`;
  if (v < 9_950_000) return `${symbol}${(v / 1e6).toFixed(1)}M`;
  return `${symbol}${Math.round(v / 1e6)}M`;
}

export function formatTokens(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e8 ? 0 : 1)}M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)}K`;
  return `${Math.round(n)}`;
}

/** Los tokens con la unidad más clara que quepa en `room` píxeles: «TOKENS», «TOK» o nada. */
export function tokensLabel(n: number, room: number): string {
  const value = formatTokens(n);
  for (const text of [`${value} TOKENS`, `${value} TOK`]) if (textWidth(text) <= room) return text;
  return value;
}

/**
 * Cuánto falta para el reinicio, con el reloj delante («@» en la fuente pixel),
 * en la forma más clara que quepa en `room` píxeles: «@2h 17m», «@2h17m»,
 * sin reloj, y por último solo la unidad mayor («2h»).
 */
export function resetLabel(iso: string | null | undefined, room: number): string {
  return resetLabels([{ iso, room }])[0];
}

/** Varios reinicios a la vez, todos con la misma forma para que se lean igual. */
export function resetLabels(items: { iso: string | null | undefined; room: number }[]): string[] {
  const forms = items.map(({ iso }) => {
    const f = resetForms(iso);
    return f.length ? f : null;
  });
  const last = 5;
  for (let i = 0; i < last; i++) {
    if (forms.every((f, j) => !f || textWidth(f[i]) <= items[j].room)) return forms.map((f) => (f ? f[i] : ""));
  }
  return forms.map((f) => (f ? f[last] : ""));
}

/** Las formas de la cuenta atrás, de la más clara a la más corta. */
export function resetForms(iso: string | null | undefined): string[] {
  const full = formatReset(iso);
  if (!full) return [];
  const tight = full.replace(" ", "");
  const first = full.split(" ")[0];
  return [`@${full}`, `@${tight}`, full, tight, `@${first}`, first];
}

export function formatReset(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "";
  const ms = new Date(iso).getTime() - now;
  if (!Number.isFinite(ms)) return "";
  if (ms <= 0) return "YA";
  // Hacia arriba: con 30 s restantes se lee «1m», no «0m».
  const min = Math.ceil(ms / 60_000);
  const d = Math.floor(min / 1440);
  const h = Math.floor((min % 1440) / 60);
  const m = min % 60;
  // Unidades en minúscula y separadas: «2h 17m» y «3d 4h» se leen sin dudar.
  if (d > 0) return h > 0 ? `${d}d ${h}h` : `${d}d`;
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  return `${m}m`;
}

export const PERIOD_LABEL: Record<Period, string> = { today: "HOY", window5h: "5H", week: "SEM" };

/** Los totales del periodo elegido en los ajustes. */
export function periodTotals(snap: Snapshot, period: Period): Totals {
  return period === "window5h" ? snap.window5h : period === "week" ? snap.week : snap.today;
}

/**
 * Lo que muestra la banca: lo que queda o lo usado, en %, según el ajuste.
 * Devuelve `null` si aún no se conoce el plan.
 */
export function bankValue(win: LimitWindow | null | undefined, shows: Settings["bankShows"]): number | null {
  if (!win) return null;
  const used = Math.max(0, Math.min(100, win.used));
  return Math.round(shows === "used" ? used : 100 - used);
}

/** Qué tan apurada está la banca: 0 bien, 1 atención, 2 crítica. */
export function bankUrgency(win: LimitWindow | null | undefined): 0 | 1 | 2 {
  if (!win) return 0;
  const left = 100 - win.used;
  return left <= 10 ? 2 : left <= 25 ? 1 : 0;
}

/** Una sola palabra para los huecos chicos (un rodillo, una columna). */
export const STATUS_SHORT: Record<string, string> = {
  loading: "...",
  ok: "",
  expired: "CADUCÓ",
  no_credentials: "SESIÓN",
  rate_limited: "ESPERA",
  error: "SIN RED",
};

/** El estado completo en una línea: «SIN SESIÓN», «ABRE CLAUDE»… */
export function statusLine(status: string | undefined): string {
  return (STATUS_TEXT[status ?? "loading"] ?? STATUS_TEXT.loading).filter(Boolean).join(" ") || "...";
}

/** El estado en dos líneas, para la mesa. */
export const STATUS_TEXT: Record<string, [string, string]> = {
  loading: ["...", ""],
  ok: ["", ""],
  expired: ["ABRE", "CLAUDE"],
  no_credentials: ["SIN", "SESIÓN"],
  rate_limited: ["ESPERA", ""],
  error: ["SIN RED", ""],
};
