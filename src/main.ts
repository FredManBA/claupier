// La ventana principal: muestra el diseño elegido con los datos del backend.

import { createBridge, inTauri } from "./core/bridge";
import { SoundEngine } from "./core/sound";
import type { Settings, Snapshot } from "./core/types";
import { DesignView, effectiveMotion } from "./core/view";
import type { DesignContext } from "./designs/design";
import { createDesign } from "./designs/index";

const canvas = document.querySelector<HTMLCanvasElement>("#mesa")!;
const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
const sound = new SoundEngine();

// En el navegador (modo demo), la mesa va centrada sobre un fondo.
if (!inTauri) document.body.classList.add("preview");

async function start() {
  const bridge = await createBridge();
  let view: DesignView | null = null;
  let settings!: Settings;
  let snap!: Snapshot;

  const context = (): DesignContext => ({
    settings,
    motion: effectiveMotion(settings.motion, motionQuery.matches),
    cue: (name) => sound.play(name),
  });

  const fit = async () => {
    if (!view) return;
    view.fit();
    const { width, height } = view.physicalSize;
    await bridge.fitWindow(width, height);
  };

  const applyLook = () => {
    canvas.style.opacity = String(settings.opacity);
    sound.configure(settings.sound, snap.quiet);
  };

  // Primero escuchar y después pedir el estado: así no se pierde un cambio
  // que llegue entre las dos cosas.
  await bridge.onSnapshot((next) => {
    snap = next;
    if (!view) return;
    sound.configure(settings.sound, snap.quiet);
    view.feed(snap, context(), false);
  });
  await bridge.onSettings(async (next) => {
    const prev = settings;
    settings = next;
    if (!view) return;
    applyLook();
    if (next.design !== prev.design) {
      view.setDesign(createDesign(next.design));
      await fit();
      view.feed(snap, context(), true);
      return;
    }
    if (next.scale !== prev.scale) {
      view.setScale(next.scale);
      await fit();
    }
    // El periodo, la moneda o la banca cambian lo que se dibuja: se redibuja sin animar.
    view.feed(snap, context(), true);
  });
  settings = await bridge.getSettings();
  snap = await bridge.getSnapshot();

  view = new DesignView(canvas, createDesign(settings.design), settings.scale);
  applyLook();
  await fit();
  view.feed(snap, context(), true);

  bridge.onScaleChanged(() => void fit());
  motionQuery.addEventListener("change", () => view?.feed(snap, context(), true));

  // Arrastrar mueve la mesa. Solo si de verdad se movió pasa a posición libre:
  // un clic o un doble clic no la desancla.
  let dragging = false;
  canvas.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    dragging = true;
    void bridge.startDragging();
  });
  const endDrag = () => (dragging = false);
  canvas.addEventListener("mouseup", endDrag);
  canvas.addEventListener("mousemove", (e) => {
    if (e.buttons === 0) endDrag();
  });
  canvas.addEventListener("mouseleave", (e) => {
    if (e.buttons === 0) endDrag();
  });
  bridge.onMoved(() => {
    if (!dragging || settings.anchor === "free") return;
    settings = { ...settings, anchor: "free" };
    void bridge.updateSettings({ anchor: "free" });
  });

  canvas.addEventListener("dblclick", () => void bridge.refresh());
  canvas.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    void bridge.openSettings();
  });
}

void start();
