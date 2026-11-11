// Puente con el backend de Tauri. En el navegador (sin Tauri) simula datos y
// guarda los ajustes en memoria, para poder ver y probar los diseños.

import type { PlayKind } from "./showcase";
import { DEFAULT_SETTINGS, type DeepPartial, type Settings, type Snapshot, type Totals } from "./types";

export const inTauri = "__TAURI_INTERNALS__" in window;

type Listener<T> = (value: T) => void;

export interface Bridge {
  getSnapshot(): Promise<Snapshot>;
  /** Se resuelve cuando ya está escuchando. */
  onSnapshot(cb: Listener<Snapshot>): Promise<void>;
  getSettings(): Promise<Settings>;
  onSettings(cb: Listener<Settings>): Promise<void>;
  updateSettings(patch: DeepPartial<Settings>): Promise<Settings>;
  fitWindow(width: number, height: number): Promise<void>;
  startDragging(): Promise<void>;
  openSettings(): Promise<void>;
  refresh(): Promise<void>;
  setHotkeysPaused(paused: boolean): Promise<void>;
  testAlert(): Promise<void>;
  hideWindow(): Promise<void>;
  onScaleChanged(cb: () => void): void;
  /** La ventana cambió de lugar (al arrastrarla o al anclarla). */
  onMoved(cb: () => void): void;
  /** Un atajo o la bandeja pidieron una animación. */
  onPlay(cb: Listener<PlayKind>): Promise<void>;
}

// ── Tauri ─────────────────────────────────────────────────────────────────

async function tauriBridge(): Promise<Bridge> {
  const { invoke } = await import("@tauri-apps/api/core");
  const { listen } = await import("@tauri-apps/api/event");
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const win = getCurrentWindow();
  return {
    getSnapshot: () => invoke<Snapshot>("get_snapshot"),
    onSnapshot: async (cb) => void (await listen<Snapshot>("snapshot", (e) => cb(e.payload))),
    getSettings: () => invoke<Settings>("get_settings"),
    onSettings: async (cb) => void (await listen<Settings>("settings", (e) => cb(e.payload))),
    updateSettings: (patch) => invoke<Settings>("update_settings", { patch }),
    fitWindow: (width, height) => invoke("fit_window", { width, height }),
    startDragging: () => win.startDragging(),
    openSettings: () => invoke("open_settings"),
    refresh: () => invoke("refresh_now"),
    setHotkeysPaused: (paused) => invoke("set_hotkeys_paused", { paused }),
    testAlert: () => invoke("test_alert"),
    hideWindow: () => win.hide(),
    onScaleChanged: (cb) => void win.onScaleChanged(cb),
    onMoved: (cb) => void win.onMoved(cb),
    onPlay: async (cb) => void (await listen<PlayKind>("play", (e) => cb(e.payload))),
  };
}

// ── Navegador: datos de ejemplo ────────────────────────────────────────────

function totals(costUsd: number, totalTokens: number): Totals {
  return {
    since: new Date().toISOString(),
    costUsd,
    inputTokens: 0,
    outputTokens: 0,
    cacheWriteTokens: 0,
    cacheReadTokens: 0,
    totalTokens,
    messages: 0,
  };
}

export function demoSnapshot(): Snapshot {
  const hour = 3_600_000;
  return {
    plan: {
      status: "ok",
      fiveHour: { used: 22, resetsAt: new Date(Date.now() + 2.3 * hour).toISOString() },
      sevenDay: { used: 41, resetsAt: new Date(Date.now() + 76 * hour).toISOString() },
      plan: "max",
    },
    today: totals(38.4, 4_820_000),
    window5h: totals(21.7, 2_310_000),
    week: totals(412.9, 51_200_000),
    ghost: false,
    quiet: false,
  };
}

/** Avanza los datos de ejemplo como si se estuviera usando Claude. */
export function advanceDemo(snap: Snapshot) {
  const spend = 2 + Math.random() * 30;
  const tokens = 150_000 + Math.random() * 900_000;
  for (const t of [snap.today, snap.window5h, snap.week]) {
    t.costUsd += spend;
    t.totalTokens += tokens;
  }
  const five = snap.plan.fiveHour!;
  five.used = five.used + 4 + Math.random() * 6;
  if (five.used >= 100) five.used = 5;
  snap.plan.sevenDay!.used = Math.min(100, snap.plan.sevenDay!.used + 1);
}

function mergeDeep<T>(base: T, patch: DeepPartial<T>): T {
  const out = structuredClone(base) as Record<string, unknown>;
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    out[k] = v && typeof v === "object" && !Array.isArray(v) ? mergeDeep(out[k] as object, v as object) : v;
  }
  return out as T;
}

function demoBridge(): Bridge {
  const params = new URLSearchParams(location.search);
  let settings = structuredClone(DEFAULT_SETTINGS);
  const fromUrl: DeepPartial<Settings> = {};
  if (params.has("design")) fromUrl.design = params.get("design") as Settings["design"];
  if (params.has("scale")) fromUrl.scale = Number(params.get("scale"));
  if (params.has("period")) fromUrl.period = params.get("period") as Settings["period"];
  if (params.has("currency")) fromUrl.currency = params.get("currency") as Settings["currency"];
  if (params.has("symbol")) fromUrl.localSymbol = params.get("symbol")!;
  if (params.has("rate")) fromUrl.localPerUsd = Number(params.get("rate"));
  if (params.has("text")) fromUrl.textStyle = params.get("text") as Settings["textStyle"];
  if (params.has("lang")) fromUrl.language = params.get("lang") as Settings["language"];
  if (params.has("motion")) fromUrl.motion = params.get("motion") as Settings["motion"];
  if (params.has("bank")) fromUrl.bankShows = params.get("bank") as Settings["bankShows"];
  settings = mergeDeep(settings, fromUrl);

  const snap = demoSnapshot();
  snap.ghost = params.has("ghost");
  if (params.has("cost")) snap.today.costUsd = snap.window5h.costUsd = snap.week.costUsd = Number(params.get("cost"));
  if (params.has("used")) snap.plan.fiveHour!.used = Number(params.get("used"));
  if (params.has("status")) {
    snap.plan.status = params.get("status") as Snapshot["plan"]["status"];
    snap.plan.fiveHour = null;
    snap.plan.sevenDay = null;
  }

  const snapListeners: Listener<Snapshot>[] = [];
  const settingsListeners: Listener<Settings>[] = [];
  if (!params.has("still") && snap.plan.fiveHour) {
    window.setInterval(() => {
      advanceDemo(snap);
      snapListeners.forEach((cb) => cb(structuredClone(snap)));
    }, 3000);
  }
  const noop = async () => {};
  return {
    getSnapshot: async () => structuredClone(snap),
    onSnapshot: async (cb) => void snapListeners.push(cb),
    getSettings: async () => structuredClone(settings),
    onSettings: async (cb) => void settingsListeners.push(cb),
    updateSettings: async (patch) => {
      settings = mergeDeep(settings, patch);
      settingsListeners.forEach((cb) => cb(structuredClone(settings)));
      return structuredClone(settings);
    },
    fitWindow: noop,
    startDragging: noop,
    openSettings: async () => void window.open("/settings.html", "_blank"),
    refresh: noop,
    setHotkeysPaused: noop,
    testAlert: noop,
    hideWindow: noop,
    onScaleChanged: () => {},
    onMoved: () => {},
    // En el navegador, los mismos atajos de fábrica sobre la página.
    onPlay: async (cb) =>
      window.addEventListener("keydown", (e) => {
        if (!e.ctrlKey || !e.altKey) return;
        if (e.code === "KeyR") cb("replay");
        if (e.code === "KeyC") cb("show");
      }),
  };
}

export function createBridge(): Promise<Bridge> {
  return inTauri ? tauriBridge() : Promise.resolve(demoBridge());
}
