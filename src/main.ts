// La ventana principal: muestra el diseño elegido con los datos del backend.

import { createBridge } from "./core/bridge";
import { SoundEngine } from "./core/sound";
import type { Motion, Settings, Snapshot } from "./core/types";
import { DesignView } from "./core/view";
import type { DesignContext } from "./designs/design";
import { createDesign } from "./designs/index";

const canvas = document.querySelector<HTMLCanvasElement>("#mesa")!;
const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
const sound = new SoundEngine();

async function start() {
  const bridge = await createBridge();
  let settings: Settings = await bridge.getSettings();
  let snap: Snapshot = await bridge.getSnapshot();

  const view = new DesignView(canvas, createDesign(settings.design), settings.scale);

  const effectiveMotion = (): Motion =>
    settings.motion === "full" && motionQuery.matches ? "reduced" : settings.motion;

  const context = (): DesignContext => ({
    settings,
    motion: effectiveMotion(),
    cue: (name) => sound.play(name),
  });

  const fit = async () => {
    view.fit();
    const { width, height } = view.physicalSize;
    await bridge.fitWindow(width, height);
  };

  const applyLook = () => {
    canvas.style.opacity = String(settings.opacity);
    sound.configure(settings.sound, snap.quiet);
  };

  applyLook();
  await fit();
  view.feed(snap, context(), true);

  bridge.onSnapshot((next) => {
    snap = next;
    sound.configure(settings.sound, snap.quiet);
    view.feed(snap, context(), false);
  });

  bridge.onSettings(async (next) => {
    const prev = settings;
    settings = next;
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

  bridge.onScaleChanged(() => void fit());
  motionQuery.addEventListener("change", () => view.feed(snap, context(), true));

  // Arrastrar mueve la mesa; si estaba anclada a una esquina, pasa a posición libre.
  canvas.addEventListener("mousedown", async (e) => {
    if (e.button !== 0) return;
    if (settings.anchor !== "free") await bridge.updateSettings({ anchor: "free" });
    await bridge.startDragging();
  });
  canvas.addEventListener("dblclick", () => void bridge.refresh());
  canvas.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    void bridge.openSettings();
  });
}

void start();
