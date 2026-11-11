export interface LimitWindow {
  /** Porcentaje usado, de 0 a 100. */
  used: number;
  resetsAt?: string | null;
}

export type PlanStatus = "loading" | "ok" | "expired" | "no_credentials" | "rate_limited" | "error";

export interface Totals {
  since: string;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  totalTokens: number;
  messages: number;
}

export interface Snapshot {
  plan: {
    status: PlanStatus;
    fiveHour?: LimitWindow | null;
    sevenDay?: LimitWindow | null;
    plan?: string | null;
    updatedAt?: string | null;
  };
  today: Totals;
  window5h: Totals;
  week: Totals;
  ghost: boolean;
  /** Hay un juego en pantalla completa o Windows está en No molestar. */
  quiet: boolean;
}

export type DesignId = "mesa" | "pildora" | "tragamonedas" | "pachinko";
export type Anchor = "free" | "top-left" | "top-right" | "bottom-left" | "bottom-right";
export type Period = "today" | "window5h" | "week";
export type Motion = "full" | "reduced" | "off";
export type TextStyle = "pixel" | "smooth";
export type LanguageSetting = "auto" | "es" | "en";

/** Espejo de `src-tauri/src/settings.rs`. */
export interface Settings {
  design: DesignId;
  /** Escala de los píxeles: 1, 1,5, 2, 2,5, 3 o 4. */
  scale: number;
  textStyle: TextStyle;
  /** "auto" sigue el idioma de Windows. */
  language: LanguageSetting;
  opacity: number;
  anchor: Anchor;
  alwaysOnTop: boolean;
  autostart: boolean;
  startHidden: boolean;
  startGhost: boolean;
  hotkeyToggle: string;
  hotkeyGhost: string;
  alerts: {
    fiveHour: boolean;
    fiveHourBelow: number;
    week: boolean;
    weekBelow: number;
    spend: boolean;
    spendOverUsd: number;
    expired: boolean;
  };
  bankShows: "left" | "used";
  period: Period;
  planPollMinutes: number;
  /** "USD" o "local": otra moneda con su símbolo y su cambio. */
  currency: "USD" | "local";
  localSymbol: string;
  /** Cuánto vale un dólar en la otra moneda. */
  localPerUsd: number;
  motion: Motion;
  sound: { enabled: boolean; volume: number; muteInGame: boolean };
}

export const DEFAULT_SETTINGS: Settings = {
  design: "mesa",
  scale: 3,
  textStyle: "pixel",
  language: "auto",
  opacity: 1,
  anchor: "free",
  alwaysOnTop: true,
  autostart: false,
  startHidden: false,
  startGhost: false,
  hotkeyToggle: "Ctrl+Alt+F",
  hotkeyGhost: "Ctrl+Alt+G",
  alerts: {
    fiveHour: true,
    fiveHourBelow: 20,
    week: true,
    weekBelow: 15,
    spend: false,
    spendOverUsd: 100,
    expired: true,
  },
  bankShows: "left",
  period: "today",
  planPollMinutes: 3,
  currency: "USD",
  localSymbol: "₡",
  localPerUsd: 505,
  motion: "full",
  sound: { enabled: false, volume: 0.5, muteInGame: true },
};

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };
