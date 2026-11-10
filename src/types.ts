export interface LimitWindow {
  /** Porcentaje usado, de 0 a 100. */
  used: number;
  resetsAt?: string | null;
}

export interface Snapshot {
  plan: {
    status: "loading" | "ok" | "expired" | "no_credentials" | "rate_limited" | "error";
    fiveHour?: LimitWindow | null;
    sevenDay?: LimitWindow | null;
    plan?: string | null;
    updatedAt?: string | null;
  };
  today: {
    date: string;
    costUsd: number;
    inputTokens: number;
    outputTokens: number;
    cacheWriteTokens: number;
    cacheReadTokens: number;
    totalTokens: number;
    messages: number;
  };
  ghost: boolean;
}
