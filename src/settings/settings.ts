// Ventana de ajustes. Cada campo se describe en un esquema y se dibuja y
// conecta de forma genérica; Rust valida, guarda y aplica cada cambio.

import "./settings.css";
import { advanceDemo, createBridge, demoSnapshot, type Bridge } from "../core/bridge";
import { chipSprites } from "../core/chips";
import { pixelSupports, setTextStyle } from "../core/font";
import { hash } from "../core/paint";
import { SoundEngine } from "../core/sound";
import type { DeepPartial, Settings, Snapshot } from "../core/types";
import { DesignView, effectiveMotion } from "../core/view";
import { DESIGN_LIST } from "../designs/index";

type Path = string; // "sound.volume"

type Field =
  | { kind: "switch"; path: Path; label: string; help?: string }
  | {
      kind: "choice";
      path: Path;
      label: string;
      help?: string;
      options: [string | number, string][];
      /** Se llama al elegir una opción (por ejemplo, para escucharla). */
      onPick?: (value: string | number) => void;
    }
  | {
      kind: "range";
      path: Path;
      label: string;
      help?: string;
      min: number;
      max: number;
      step: number;
      /** Valor guardado → valor mostrado, y al revés. */
      show?: (v: number) => string;
      toUi?: (v: number) => number;
      fromUi?: (v: number) => number;
    }
  | {
      kind: "number";
      path: Path;
      label: string;
      help?: string;
      min: number;
      max: number;
      step: number;
      /** Unidad junto al campo; puede depender de los ajustes (el símbolo de la moneda). */
      unit: string | ((s: Settings) => string);
      showIf?: (s: Settings) => boolean;
      /** Interruptor del que depende: se ve debajo de él y se apaga con él. */
      under?: Path;
    }
  | {
      kind: "text";
      path: Path;
      label: string;
      help?: string;
      maxLength: number;
      placeholder?: string;
      showIf?: (s: Settings) => boolean;
      /** Aviso que depende del valor (o `null` si no hay nada que avisar). */
      warn?: (s: Settings) => string | null;
    }
  | { kind: "hotkey"; path: Path; label: string }
  | { kind: "anchor"; path: Path; label: string; help?: string }
  | { kind: "action"; label: string; button: string; help?: string; run: () => Promise<void> | void }
  | { kind: "designs" };

interface Section {
  id: string;
  title: string;
  lead: string;
  /** Icono de 9×7 en pixel art («#» = píxel). */
  icon: string[];
  fields: Field[];
}

const sound = new SoundEngine();
let bridge: Bridge;
let settings: Settings;

const SECTIONS: Section[] = [
  {
    id: "diseno",
    title: "Diseño",
    icon: ["..#####..", ".#.....#.", "#..###..#", "#.#...#.#", "#..###..#", ".#.....#.", "..#####.."],
    lead: "Elige cómo se ve Claupier. Las vistas previas usan datos de ejemplo.",
    fields: [{ kind: "designs" }],
  },
  {
    id: "ventana",
    title: "Ventana",
    icon: ["#########", "#########", "#.......#", "#.......#", "#.......#", "#.......#", "#########"],
    lead: "Tamaño, transparencia y lugar de la mesa en la pantalla.",
    fields: [
      {
        kind: "choice",
        path: "scale",
        label: "Tamaño",
        options: [[1, "1×"], [1.5, "1,5×"], [2, "2×"], [2.5, "2,5×"], [3, "3×"], [4, "4×"]],
        help: "1× es la más chica: ideal para dejarla en una esquina mientras juegas. Los tamaños con medio se ven un poco más suaves.",
      },
      {
        kind: "choice",
        path: "textStyle",
        label: "Texto",
        options: [["pixel", "Pixel"], ["smooth", "Normal"]],
        help: "Normal usa la letra de Windows, sin pixelar, para leer las cifras con más claridad. El logotipo sigue en pixel.",
      },
      {
        kind: "range",
        path: "opacity",
        label: "Opacidad",
        min: 30,
        max: 100,
        step: 5,
        toUi: (v) => Math.round(v * 100),
        fromUi: (v) => v / 100,
        show: (v) => `${v}%`,
      },
      {
        kind: "anchor",
        path: "anchor",
        label: "Posición",
        help: "Ánclala a una esquina o déjala libre para moverla arrastrando. Si la arrastras, queda libre.",
      },
      { kind: "switch", path: "alwaysOnTop", label: "Siempre encima" },
      {
        kind: "choice",
        path: "motion",
        label: "Animación",
        options: [["full", "Completa"], ["reduced", "Reducida"], ["off", "Apagada"]],
        help: "Reducida: las fichas aparecen sin caer y no giran solas.",
      },
    ],
  },
  {
    id: "inicio",
    title: "Inicio",
    icon: ["....#....", "..#.#.#..", ".#..#..#.", "#...#...#", "#.......#", ".#.....#.", "..#####.."],
    lead: "Qué hace Claupier al arrancar.",
    fields: [
      { kind: "switch", path: "autostart", label: "Arrancar con Windows" },
      { kind: "switch", path: "startHidden", label: "Empezar oculta", help: "Aparece cuando pulses el atajo." },
      { kind: "switch", path: "startGhost", label: "Empezar en modo fantasma", help: "Los clics atraviesan la mesa." },
    ],
  },
  {
    id: "atajos",
    title: "Atajos",
    icon: ["#########", "#.......#", "#.#.#.#.#", "#.......#", "#.#####.#", "#.......#", "#########"],
    lead: "Pulsa un botón y luego la combinación nueva. Esc cancela.",
    fields: [
      { kind: "hotkey", path: "hotkeyToggle", label: "Mostrar u ocultar" },
      { kind: "hotkey", path: "hotkeyGhost", label: "Modo fantasma" },
    ],
  },
  {
    id: "avisos",
    title: "Avisos",
    icon: ["....#....", "..#####..", ".#######.", ".#######.", ".#######.", "#########", "....#...."],
    lead: "Notificaciones de Windows. Cada una suena una sola vez por ventana o periodo.",
    fields: [
      { kind: "switch", path: "alerts.fiveHour", label: "Banca de 5 h baja" },
      { kind: "number", path: "alerts.fiveHourBelow", label: "Avisar bajo", min: 1, max: 90, step: 1, unit: "%", under: "alerts.fiveHour" },
      { kind: "switch", path: "alerts.week", label: "Banca semanal baja" },
      { kind: "number", path: "alerts.weekBelow", label: "Avisar bajo", min: 1, max: 90, step: 1, unit: "%", under: "alerts.week" },
      { kind: "switch", path: "alerts.spend", label: "Tope de gasto", help: "Del periodo elegido en Datos, en dólares." },
      {
        kind: "number",
        path: "alerts.spendOverUsd",
        label: "Avisar sobre",
        min: 1,
        max: 100000,
        step: 1,
        unit: "USD",
        under: "alerts.spend",
      },
      { kind: "switch", path: "alerts.expired", label: "Sesión caducada" },
      { kind: "action", label: "Probar", button: "Enviar aviso de prueba", run: () => bridge.testAlert() },
    ],
  },
  {
    id: "datos",
    title: "Datos",
    icon: [".......#.", ".......#.", "....#..#.", "....#..#.", ".#..#..#.", ".#..#..#.", "#########"],
    lead: "Qué cuenta la banca, qué periodo muestran las fichas y en qué moneda.",
    fields: [
      { kind: "choice", path: "bankShows", label: "La banca muestra", options: [["left", "Lo que queda"], ["used", "Lo usado"]] },
      {
        kind: "choice",
        path: "period",
        label: "Gasto de",
        options: [["today", "Hoy"], ["window5h", "Ventana 5 h"], ["week", "Semana"]],
      },
      {
        kind: "range",
        path: "planPollMinutes",
        label: "Consultar el plan",
        min: 2,
        max: 30,
        step: 1,
        show: (v) => `${v} min`,
        help: "Anthropic limita las consultas seguidas; menos de 2 minutos no está permitido.",
      },
      {
        kind: "choice",
        path: "currency",
        label: "Moneda",
        options: [["USD", "Dólares"], ["local", "Otra moneda"]],
        help: "El gasto se calcula en dólares. Con otra moneda, Claupier lo convierte con el cambio que escribas.",
      },
      {
        kind: "text",
        path: "localSymbol",
        label: "Símbolo",
        maxLength: 4,
        placeholder: "₡",
        help: "Por ejemplo ₡, €, £, ¥, MX$ o S/. Hasta 4 caracteres.",
        showIf: (s) => s.currency === "local",
        warn: (s) => {
          if (s.textStyle !== "pixel") return null;
          const missing = [...s.localSymbol].filter((ch) => ch.trim() && !pixelSupports(ch));
          return missing.length
            ? `La letra pixel no tiene «${missing.join("")}»: elige el texto Normal en Ventana o usa otro símbolo.`
            : null;
        },
      },
      {
        kind: "number",
        path: "localPerUsd",
        label: "1 dólar vale",
        min: 0.0001,
        max: 1_000_000,
        step: 0.01,
        unit: (s) => s.localSymbol || "¤",
        help: "Cuántas unidades de tu moneda compras con un dólar. Escríbelo a mano y actualízalo cuando cambie.",
        showIf: (s) => s.currency === "local",
      },
    ],
  },
  {
    id: "sonido",
    title: "Sonido",
    icon: ["...#.....", "..##..#..", "####...#.", "####.#.#.", "####...#.", "..##..#..", "...#....."],
    lead: "Sonidos suaves generados en el momento, sin agudos. Vienen apagados.",
    fields: [
      { kind: "switch", path: "sound.enabled", label: "Activar sonido" },
      {
        kind: "range",
        path: "sound.volume",
        label: "Volumen",
        min: 0,
        max: 100,
        step: 5,
        toUi: (v) => Math.round(v * 100),
        fromUi: (v) => v / 100,
        show: (v) => `${v}%`,
      },
      {
        kind: "switch",
        path: "sound.muteInGame",
        label: "Silenciar en juego",
        help: "Con una app en pantalla completa o con Windows en No molestar.",
      },
      { kind: "action", label: "Probar", button: "Escuchar el sonido", run: () => playChips() },
    ],
  },
];

/** Tres fichas cayendo sobre la pila, con el volumen elegido. */
function playChips() {
  sound.configure(settings.sound, false);
  [0, 170, 320].forEach((delay) => window.setTimeout(() => sound.preview("chip"), delay));
}

// ── Utilidades ─────────────────────────────────────────────────────────────

function get(path: Path): unknown {
  return path.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], settings);
}

function patchFor(path: Path, value: unknown): DeepPartial<Settings> {
  const keys = path.split(".");
  const patch: Record<string, unknown> = {};
  let node = patch;
  keys.forEach((k, i) => {
    if (i === keys.length - 1) node[k] = value;
    else node = node[k] = {} as Record<string, unknown>;
  });
  return patch as DeepPartial<Settings>;
}

const statusEl = document.querySelector<HTMLElement>("#status")!;
let statusTimer: number | undefined;

function setStatus(text: string, kind: "" | "saved" | "error" = "") {
  if (text) statusEl.textContent = text;
  statusEl.className = `status ${kind}${text ? " visible" : ""}`;
  window.clearTimeout(statusTimer);
  if (kind === "saved") statusTimer = window.setTimeout(() => setStatus(""), 1800);
}

async function save(path: Path, value: unknown) {
  try {
    settings = await bridge.updateSettings(patchFor(path, value));
    setStatus("Guardado", "saved");
  } catch (e) {
    setStatus(String(e), "error");
  }
  refreshAll();
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Record<string, unknown> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

// ── Campos ─────────────────────────────────────────────────────────────────

/** Funciones que vuelven a pintar cada campo con el valor actual. */
const refreshers: (() => void)[] = [];

function refreshAll() {
  setTextStyle(settings.textStyle);
  refreshers.forEach((r) => r());
}

/** `target` es el control que nombra la etiqueta, si va dentro de un envoltorio. */
function fieldRow(label: string, control: HTMLElement, help?: string, id?: string, target: HTMLElement = control) {
  const row = el("div", { className: "field" });
  const lab = el("label", { textContent: label });
  if (id) {
    lab.htmlFor = id;
    target.id = id;
  }
  row.append(lab, control);
  if (help) row.append(el("p", { className: "help", textContent: help }));
  return row;
}

let uid = 0;

function renderField(f: Field): HTMLElement {
  const id = `f${uid++}`;
  switch (f.kind) {
    case "switch": {
      const btn = el("button", { className: "switch", type: "button" });
      btn.setAttribute("role", "switch");
      btn.addEventListener("click", () => void save(f.path, !get(f.path)));
      refreshers.push(() => btn.setAttribute("aria-checked", String(Boolean(get(f.path)))));
      return fieldRow(f.label, btn, f.help, id);
    }
    case "choice": {
      const group = el("div", { className: "segmented" });
      group.setAttribute("role", "radiogroup");
      group.setAttribute("aria-label", f.label);
      const buttons = f.options.map(([value, text]) => {
        const b = el("button", { type: "button", textContent: text });
        b.setAttribute("role", "radio");
        b.addEventListener("click", () => {
          f.onPick?.(value);
          void save(f.path, value);
        });
        group.append(b);
        return [value, b] as const;
      });
      refreshers.push(() => buttons.forEach(([v, b]) => b.setAttribute("aria-checked", String(get(f.path) === v))));
      const row = fieldRow(f.label, group, f.help);
      return row;
    }
    case "range": {
      const toUi = f.toUi ?? ((v: number) => v);
      const fromUi = f.fromUi ?? ((v: number) => v);
      const show = f.show ?? String;
      const input = el("input", { type: "range", min: String(f.min), max: String(f.max), step: String(f.step) });
      const out = el("output");
      const wrap = el("span", { className: "range" }, input, out);
      input.addEventListener("input", () => (out.textContent = show(Number(input.value))));
      input.addEventListener("change", () => void save(f.path, fromUi(Number(input.value))));
      const fill = () => input.style.setProperty("--fill", `${((Number(input.value) - f.min) / (f.max - f.min)) * 100}%`);
      input.addEventListener("input", fill);
      refreshers.push(() => {
        const v = toUi(Number(get(f.path)));
        input.value = String(v);
        out.textContent = show(v);
        fill();
      });
      return fieldRow(f.label, wrap, f.help, id, input);
    }
    case "number": {
      const input = el("input", { type: "number", min: String(f.min), max: String(f.max), step: String(f.step) });
      const unit = el("span", { className: "unit" });
      const wrap = el("span", { className: "number" }, input, unit);
      input.addEventListener("change", () => {
        const v = Number(input.value);
        // Un campo vacío o inválido vuelve al valor guardado en vez de guardar un 0.
        if (input.value.trim() === "" || !Number.isFinite(v)) {
          input.value = String(get(f.path));
          return;
        }
        const stepped = Number.isInteger(f.step) ? Math.round(v) : v;
        void save(f.path, Math.min(f.max, Math.max(f.min, stepped)));
      });
      const row = fieldRow(f.label, wrap, f.help, id, input);
      if (f.under) row.classList.add("sub");
      refreshers.push(() => {
        if (document.activeElement !== input) input.value = String(get(f.path));
        unit.textContent = typeof f.unit === "function" ? f.unit(settings) : f.unit;
        row.hidden = f.showIf ? !f.showIf(settings) : false;
        const off = f.under ? !get(f.under) : false;
        row.classList.toggle("off", off);
        input.disabled = off;
      });
      return row;
    }
    case "text": {
      const input = el("input", { type: "text", maxLength: f.maxLength, placeholder: f.placeholder ?? "", spellcheck: false });
      input.autocomplete = "off";
      const row = fieldRow(f.label, input, f.help, id);
      const warning = el("p", { className: "help warn" });
      warning.setAttribute("role", "status");
      row.append(warning);
      input.addEventListener("change", () => {
        const v = input.value.trim();
        if (!v) {
          input.value = String(get(f.path));
          return;
        }
        void save(f.path, v);
      });
      refreshers.push(() => {
        if (document.activeElement !== input) input.value = String(get(f.path));
        row.hidden = f.showIf ? !f.showIf(settings) : false;
        const text = f.warn?.(settings) ?? null;
        warning.textContent = text ?? "";
        warning.hidden = !text;
      });
      return row;
    }
    case "hotkey": {
      const btn = el("button", { className: "hotkey", type: "button" });
      let capturing = false;
      const stop = () => {
        if (!capturing) return;
        capturing = false;
        if (stopCapture === stop) stopCapture = null;
        btn.classList.remove("capturing");
        window.removeEventListener("keydown", onKey, true);
        void bridge.setHotkeysPaused(false);
        refreshAll();
      };
      const onKey = (e: KeyboardEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.key === "Escape") return stop();
        const key = keyName(e);
        if (!key) return; // solo modificadores, esperar la tecla
        const combo = [e.ctrlKey && "Ctrl", e.altKey && "Alt", e.shiftKey && "Shift", e.metaKey && "Super", key]
          .filter(Boolean)
          .join("+");
        stop();
        void save(f.path, combo);
      };
      btn.addEventListener("click", () => {
        if (capturing) return stop();
        stopCapture?.(); // solo una captura a la vez
        stopCapture = stop;
        capturing = true;
        btn.classList.add("capturing");
        btn.textContent = "Pulsa la combinación…";
        void bridge.setHotkeysPaused(true);
        window.addEventListener("keydown", onKey, true);
      });
      refreshers.push(() => {
        if (!capturing) btn.textContent = String(get(f.path));
      });
      return fieldRow(f.label, btn, undefined, id);
    }
    case "anchor": {
      const screen = el("div", { className: "screen" });
      screen.setAttribute("role", "radiogroup");
      screen.setAttribute("aria-label", f.label);
      const names: Record<string, string> = {
        "top-left": "Arriba a la izquierda",
        "top-right": "Arriba a la derecha",
        "bottom-left": "Abajo a la izquierda",
        "bottom-right": "Abajo a la derecha",
        free: "Libre",
      };
      const buttons = Object.entries(names).map(([value, name]) => {
        const b = el("button", { type: "button", title: name });
        b.dataset.value = value;
        b.setAttribute("role", "radio");
        b.setAttribute("aria-label", name);
        if (value === "free") b.textContent = "Libre";
        b.addEventListener("click", () => void save(f.path, value));
        screen.append(b);
        return [value, b] as const;
      });
      refreshers.push(() => buttons.forEach(([v, b]) => b.setAttribute("aria-checked", String(get(f.path) === v))));
      return fieldRow(f.label, screen, f.help);
    }
    case "action": {
      const btn = el("button", { className: "action", type: "button", textContent: f.button });
      btn.addEventListener("click", async () => {
        try {
          await f.run();
        } catch (e) {
          setStatus(String(e), "error");
        }
      });
      return fieldRow(f.label, btn, f.help, id);
    }
    case "designs":
      return renderDesigns();
  }
}

/** Cancela la captura de atajo en curso, si hay una. */
let stopCapture: (() => void) | null = null;

/** Nombre de la tecla en el formato que entiende el backend ("F", "1", "F5"…). */
function keyName(e: KeyboardEvent): string | null {
  if (["Control", "Alt", "Shift", "Meta", "OS"].includes(e.key)) return null;
  if (e.code.startsWith("Key")) return e.code.slice(3);
  if (e.code.startsWith("Digit")) return e.code.slice(5);
  return e.code; // F1–F24, ArrowUp, Space, Numpad…
}

// ── Diseños con vista previa ───────────────────────────────────────────────

/** Tamaño del escenario de cada tarjeta, en píxeles CSS. La píldora va a lo ancho. */
const STAGE = { w: 232, h: 336 };
const STAGE_WIDE = { w: 400, h: 84 };

function renderDesigns(): HTMLElement {
  const grid = el("div", { className: "designs" });
  grid.setAttribute("role", "radiogroup");
  grid.setAttribute("aria-label", "Diseño");
  const snap: Snapshot = demoSnapshot();
  const views: DesignView[] = [];
  const dpr = window.devicePixelRatio || 1;

  // La píldora, que es una tira, va primero y a lo ancho; las demás, en columnas.
  const ordered = [...DESIGN_LIST].sort((a, b) => Number(b.id === "pildora") - Number(a.id === "pildora"));
  for (const info of ordered) {
    const wide = info.id === "pildora";
    const card = el("button", { className: `design-card${wide ? " wide" : ""}`, type: "button" });
    card.setAttribute("role", "radio");
    const canvas = el("canvas");
    const stage = el("div", { className: "stage" }, canvas);
    const design = info.create();
    // La escala entera más grande que quepa, en píxeles físicos, para que se vea
    // nítido. Se recalcula con el ancho real de la tarjeta (la ventana se puede
    // estrechar hasta 640 px).
    const box = wide ? STAGE_WIDE : STAGE;
    const scaleFor = (w: number) =>
      Math.max(1, Math.floor(Math.min(w / design.width, box.h / design.height) * dpr)) / dpr;
    const view = new DesignView(canvas, design, scaleFor(box.w));
    views.push(view);
    new ResizeObserver(() => {
      const room = Math.min(box.w, stage.clientWidth - 16);
      if (room > 0) view.setScale(scaleFor(room));
    }).observe(stage);
    card.append(
      stage,
      el("div", { className: "head" }, el("strong", { textContent: info.name }), el("em", { className: "badge", textContent: "En uso" })),
      el("span", { textContent: info.description }),
    );
    card.addEventListener("click", () => void save("design", info.id));
    refreshers.push(() => card.setAttribute("aria-checked", String(settings.design === info.id)));
    grid.append(card);
  }

  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
  const feed = (first: boolean) => {
    const ctx = { settings, motion: effectiveMotion(settings.motion, reduce.matches), cue: () => {} };
    views.forEach((v) => v.feed(structuredClone(snap), ctx, first));
  };
  reduce.addEventListener("change", () => feed(true));
  refreshers.push(() => feed(true));

  // Las vistas previas solo se animan mientras se ven: con la ventana oculta o
  // en otra sección no gastan nada mientras juegas.
  let timer: number | undefined;
  setPreviewsActive = (active: boolean) => {
    views.forEach((v) => v.setPaused(!active));
    window.clearInterval(timer);
    timer = undefined;
    if (active) {
      timer = window.setInterval(() => {
        advanceDemo(snap);
        feed(false);
      }, 3000);
    }
  };
  return grid;
}

/** La asigna `renderDesigns`; activa o pausa las vistas previas. */
let setPreviewsActive: (active: boolean) => void = () => {};

/** Icono pixel en SVG; toma el color del texto. */
function pixelIcon(map: string[]): SVGSVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", `0 0 ${map[0].length} ${map.length}`);
  svg.setAttribute("aria-hidden", "true");
  let d = "";
  map.forEach((row, y) => [...row].forEach((ch, x) => ch === "#" && (d += `M${x} ${y}h1v1H${x}z`)));
  const path = document.createElementNS(ns, "path");
  path.setAttribute("d", d);
  svg.append(path);
  return svg;
}

/** Fibras del paño, como las de la mesa, en una tesela de 64 px. */
function feltTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      const n = hash(x, y);
      if (n >= 0.05 && n <= 0.93) continue;
      g.fillStyle = n < 0.05 ? "#21503b" : "#153a2a";
      g.fillRect(x, y, 1, 1);
    }
  }
  document.body.style.setProperty("--felt-texture", `url(${c.toDataURL()})`);
}

/** La ficha naranja de $500 junto al nombre, a 2×. */
function drawBrandChip() {
  const canvas = document.querySelector<HTMLCanvasElement>("#brand-chip");
  const g = canvas?.getContext("2d");
  if (!canvas || !g) return;
  const sprite = chipSprites("orange").face;
  canvas.width = sprite.width;
  canvas.height = sprite.height;
  g.drawImage(sprite, 0, 0);
}

// ── Arranque ───────────────────────────────────────────────────────────────

async function start() {
  bridge = await createBridge();
  await bridge.onSettings((next) => {
    settings = next;
    refreshAll();
  });
  settings = await bridge.getSettings();

  const nav = document.querySelector<HTMLElement>("#nav")!;
  const content = document.querySelector<HTMLElement>("#content")!;
  const panels = SECTIONS.map((section, i) => {
    const tab = el("button", { type: "button", id: `tab-${section.id}` }, pixelIcon(section.icon), section.title);
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-controls", `panel-${section.id}`);
    const panel = el("section", { id: `panel-${section.id}`, hidden: i !== 0 });
    panel.setAttribute("role", "tabpanel");
    panel.setAttribute("aria-labelledby", tab.id);
    panel.append(el("h2", { textContent: section.title }), el("p", { className: "lead", textContent: section.lead }));
    section.fields.forEach((f) => panel.append(renderField(f)));
    tab.addEventListener("click", () => select(i));
    nav.append(tab);
    content.append(panel);
    return { tab, panel };
  });

  let selected = 0;
  const updatePreviews = () => setPreviewsActive(!document.hidden && SECTIONS[selected].id === "diseno");

  function select(index: number) {
    selected = index;
    panels.forEach(({ tab, panel }, i) => {
      tab.setAttribute("aria-selected", String(i === index));
      tab.tabIndex = i === index ? 0 : -1;
      panel.hidden = i !== index;
    });
    content.scrollTop = 0;
    updatePreviews();
  }

  nav.addEventListener("keydown", (e) => {
    const current = panels.findIndex((p) => p.tab.getAttribute("aria-selected") === "true");
    const next = e.key === "ArrowDown" ? current + 1 : e.key === "ArrowUp" ? current - 1 : null;
    if (next === null) return;
    e.preventDefault();
    const i = (next + panels.length) % panels.length;
    select(i);
    panels[i].tab.focus();
  });

  document.querySelector("#close")!.addEventListener("click", () => {
    stopCapture?.();
    setPreviewsActive(false);
    void bridge.hideWindow();
  });
  // Si la ventana pierde el foco o se oculta, se cancela la captura de atajo
  // (si no, los atajos globales se quedarían en pausa).
  window.addEventListener("blur", () => stopCapture?.());
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopCapture?.();
    updatePreviews();
  });
  window.addEventListener("focus", updatePreviews);
  drawBrandChip();
  feltTexture();
  select(0);
  refreshAll();
}

void start();
