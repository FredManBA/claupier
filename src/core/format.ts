import type { LimitWindow, Period, Settings, Snapshot, Totals } from "./types";

// En todos los formatos, cada tramo se elige con el valor ya redondeado:
// así 999.996 no sale como «$1000.00» ni 99.97 como «$100.0».

export function formatUsd(v: number): string {
  if (v >= 9_950_000) return `$${Math.round(v / 1e6)}M`;
  if (v >= 999_500) return `$${(v / 1e6).toFixed(1)}M`;
  if (v >= 99_950) return `$${Math.round(v / 1000)}K`;
  if (v >= 9999.5) return `$${(v / 1000).toFixed(1)}K`;
  if (v >= 999.995) return `$${Math.round(v)}`;
  return `$${v.toFixed(2)}`;
}

export function formatCrc(v: number): string {
  if (v >= 9_950_000) return `₡${Math.round(v / 1e6)}M`;
  if (v >= 999_500) return `₡${(v / 1e6).toFixed(1)}M`;
  if (v >= 9999.5) return `₡${Math.round(v / 1000)}K`;
  return `₡${Math.round(v)}`;
}

/** Dinero en la moneda elegida. Las fichas siempre valen dólares. */
export function formatMoney(usd: number, s: Pick<Settings, "currency" | "crcPerUsd">): string {
  return s.currency === "CRC" ? formatCrc(usd * s.crcPerUsd) : formatUsd(usd);
}

/** Dinero en 6 caracteres o menos, para espacios chicos (los rodillos). */
export function formatMoneyShort(usd: number, s: Pick<Settings, "currency" | "crcPerUsd">): string {
  if (s.currency === "CRC") return formatCrc(usd * s.crcPerUsd);
  if (usd < 9.995) return `$${usd.toFixed(2)}`;
  if (usd < 99.95) return `$${usd.toFixed(1)}`;
  if (usd < 9999.5) return `$${Math.round(usd)}`;
  if (usd < 99_500) return `$${Math.round(usd / 1000)}K`;
  return `$${(usd / 1e6).toFixed(1)}M`;
}

export function formatTokens(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e8 ? 0 : 1)}M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)}K`;
  return `${Math.round(n)}`;
}

export function formatReset(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "";
  const ms = new Date(iso).getTime() - now;
  if (!Number.isFinite(ms)) return "";
  if (ms <= 0) return "YA";
  const min = Math.floor(ms / 60_000);
  const d = Math.floor(min / 1440);
  const h = Math.floor((min % 1440) / 60);
  const m = min % 60;
  if (d > 0) return `${d}D${h}H`;
  if (h > 0) return `${h}H${String(m).padStart(2, "0")}`;
  return `${m}M`;
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

export const STATUS_TEXT: Record<string, [string, string]> = {
  loading: ["...", ""],
  ok: ["", ""],
  expired: ["ABRE", "CLAUDE"],
  no_credentials: ["SIN", "SESION"],
  rate_limited: ["ESPERA", ""],
  error: ["SIN RED", ""],
};
