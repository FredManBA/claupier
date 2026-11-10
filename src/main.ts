import { H, Scene, W } from "./scene";
import type { Snapshot } from "./types";

const BASE_SCALE = 3;
const inTauri = "__TAURI_INTERNALS__" in window;

const canvas = document.querySelector<HTMLCanvasElement>("#mesa")!;
const ctx = canvas.getContext("2d")!;
const low = document.createElement("canvas");
low.width = W;
low.height = H;
const lowCtx = low.getContext("2d")!;

const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
const scene = new Scene(() => motionQuery.matches);

// ── Escala con píxeles enteros ────────────────────────────────────────────
let k = BASE_SCALE;

async function fitToScreen() {
  const dpr = window.devicePixelRatio || 1;
  k = Math.max(1, Math.round(BASE_SCALE * dpr));
  canvas.width = W * k;
  canvas.height = H * k;
  canvas.style.width = `${(W * k) / dpr}px`;
  canvas.style.height = `${(H * k) / dpr}px`;
  ctx.imageSmoothingEnabled = false;
  if (inTauri) {
    const { getCurrentWindow, PhysicalSize } = await import("@tauri-apps/api/window");
    await getCurrentWindow().setSize(new PhysicalSize(W * k, H * k));
  }
  requestFrame();
}

// ── Bucle de dibujo: solo trabaja cuando algo se mueve ─────────────────────
let frameQueued = false;
let wakeTimer: number | undefined;

function requestFrame() {
  if (frameQueued) return;
  frameQueued = true;
  requestAnimationFrame(frame);
}

function frame(now: number) {
  frameQueued = false;
  const busy = scene.update(now);
  scene.draw(lowCtx, now);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(low, 0, 0, W * k, H * k);

  if (busy) {
    requestFrame();
  } else {
    // Dormir hasta el próximo giro o, como mucho, 30 s (para la cuenta atrás).
    window.clearTimeout(wakeTimer);
    wakeTimer = window.setTimeout(requestFrame, Math.min(30_000, scene.msUntilIdleEvent(performance.now()) + 16));
  }
}

function apply(snap: Snapshot) {
  scene.setSnapshot(snap, performance.now());
  requestFrame();
}

// ── Datos: Tauri o modo demo en el navegador ───────────────────────────────
async function startTauri() {
  const { invoke } = await import("@tauri-apps/api/core");
  const { listen } = await import("@tauri-apps/api/event");
  const { getCurrentWindow } = await import("@tauri-apps/api/window");

  await listen<Snapshot>("snapshot", (e) => apply(e.payload));
  apply(await invoke<Snapshot>("get_snapshot"));

  const win = getCurrentWindow();
  canvas.addEventListener("mousedown", (e) => {
    if (e.button === 0) void win.startDragging();
  });
  canvas.addEventListener("dblclick", () => void invoke("refresh_now"));
  await win.onScaleChanged(() => void fitToScreen());
}

function startDemo() {
  const hour = 3_600_000;
  const snap: Snapshot = {
    plan: {
      status: "ok",
      fiveHour: { used: 22, resetsAt: new Date(Date.now() + 2.3 * hour).toISOString() },
      sevenDay: { used: 41, resetsAt: new Date(Date.now() + 76 * hour).toISOString() },
      plan: "max",
    },
    today: {
      date: "",
      costUsd: 38.4,
      inputTokens: 0,
      outputTokens: 0,
      cacheWriteTokens: 0,
      cacheReadTokens: 0,
      totalTokens: 4_820_000,
      messages: 0,
    },
    ghost: new URLSearchParams(location.search).has("ghost"),
  };
  const params = new URLSearchParams(location.search);
  if (params.has("cost")) snap.today.costUsd = Number(params.get("cost"));
  if (params.has("used")) snap.plan.fiveHour!.used = Number(params.get("used"));
  if (params.has("status")) {
    snap.plan.status = params.get("status") as Snapshot["plan"]["status"];
    snap.plan.fiveHour = null;
    snap.plan.sevenDay = null;
  }
  apply(structuredClone(snap));
  if (params.has("still")) return;

  // Simula trabajo: cada pocos segundos se gasta algo más y baja la banca.
  window.setInterval(() => {
    snap.today.costUsd += 2 + Math.random() * 30;
    snap.today.totalTokens += 150_000 + Math.random() * 900_000;
    snap.plan.fiveHour!.used = Math.min(100, snap.plan.fiveHour!.used + 4 + Math.random() * 6);
    snap.plan.sevenDay!.used = Math.min(100, snap.plan.sevenDay!.used + 1);
    if (snap.plan.fiveHour!.used >= 100) snap.plan.fiveHour!.used = 5;
    apply(structuredClone(snap));
  }, 3000);
}

motionQuery.addEventListener("change", requestFrame);
void fitToScreen();
if (inTauri) void startTauri();
else startDemo();
