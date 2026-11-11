// Las dos animaciones a pedido:
// - «replay»: el diseño se vacía y se vuelve a llenar con los datos reales;
// - «show» (modo caótico): una docena de pasos con datos falsos, en los que el
//   gasto pasa por todas las fichas y monedas y las bancas bajan hasta el rojo,
//   para lucir cada animación, efecto y color. Al final vuelve a los reales.

import type { Settings, Snapshot, Totals } from "./types";

export type PlayKind = "replay" | "show";

/** Tiempo entre un paso y el siguiente del modo caótico. */
export const SHOW_STEP_MS = 950;
/** Pausa con el diseño vacío antes de empezar a llenarlo. */
export const EMPTY_MS = 400;

// Gasto (USD) y lo que queda de cada banca (%) en cada paso del modo caótico.
const COSTS = [2, 7, 18, 33, 64, 140, 290, 520, 980, 1650, 2875, 4999];
const FIVE_LEFT = [100, 92, 80, 66, 52, 40, 28, 20, 12, 6, 2, 0];
const WEEK_LEFT = [100, 95, 88, 80, 70, 60, 48, 36, 24, 14, 8, 3];

function setTotals(t: Totals, cost: number) {
  t.costUsd = cost;
  t.totalTokens = Math.round(cost * 120_000);
  t.inputTokens = t.outputTokens = t.cacheWriteTokens = t.cacheReadTokens = 0;
}

/** El punto de partida: sin gasto y con las bancas vacías (o sin uso, si muestran lo usado). */
export function emptySnapshot(snap: Snapshot, shows: Settings["bankShows"]): Snapshot {
  const s = structuredClone(snap);
  for (const t of [s.today, s.window5h, s.week]) setTotals(t, 0);
  const used = shows === "used" ? 0 : 100;
  if (s.plan.fiveHour) s.plan.fiveHour.used = used;
  if (s.plan.sevenDay) s.plan.sevenDay.used = used;
  return s;
}

/** Los pasos del modo caótico, a partir de los datos reales (se conservan los reinicios). */
export function chaosSteps(snap: Snapshot): Snapshot[] {
  const hour = 3_600_000;
  return COSTS.map((cost, i) => {
    const s = structuredClone(snap);
    for (const t of [s.today, s.window5h, s.week]) setTotals(t, cost);
    s.plan.status = "ok";
    s.plan.fiveHour = { used: 100 - FIVE_LEFT[i], resetsAt: s.plan.fiveHour?.resetsAt ?? new Date(Date.now() + 2.3 * hour).toISOString() };
    s.plan.sevenDay = { used: 100 - WEEK_LEFT[i], resetsAt: s.plan.sevenDay?.resetsAt ?? new Date(Date.now() + 76 * hour).toISOString() };
    return s;
  });
}
