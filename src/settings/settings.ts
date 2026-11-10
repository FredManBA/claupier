// Ventana de ajustes. Cada campo se describe en un esquema y se dibuja y
// conecta de forma genérica; Rust valida, guarda y aplica cada cambio.

import "./settings.css";
import { advanceDemo, createBridge, demoSnapshot, type Bridge } from "../core/bridge";
import { SoundEngine } from "../core/sound";
import type { DeepPartial, Settings, Snapshot } from "../core/types";
import { DesignView } from "../core/view";
import { DESIGN_LIST } from "../designs/index";

type Path = string; // "sound.volume"

type Field =
  | { kind: "switch"; path: Path; label: string; help?: string }
  | { kind: "choice"; path: Path; label: string; help?: string; options: [string | number, string][] }
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
  | { kind: "number"; path: Path; label: string; help?: string; min: number; max: number; step: number; unit: string; showIf?: (s: Settings) => boolean }
  | { kind: "hotkey"; path: Path; label: string }
  | { kind: "anchor"; path: Path; label: string; help?: string }
  | { kind: "action"; label: string; button: string; help?: string; run: () => Promise<void> | void }
  | { kind: "designs" };

interface Section {
  id: string;
  title: string;
  lead: string;
  fields: Field[];
}

const sound = new SoundEngine();
let bridge: Bridge;
let settings: Settings;

const SECTIONS: Section[] = [
  {
    id: "diseno",
    title: "Diseño",
    lead: "Elige cómo se ve Claupier. Las vistas previas usan datos de ejemplo.",
    fields: [{ kind: "designs" }],
  },
  {
    id: "ventana",
    title: "Ventana",
    lead: "Tamaño, transparencia y lugar de la mesa en la pantalla.",
    fields: [
      { kind: "choice", path: "scale", label: "Tamaño", options: [[2, "2×"], [3, "3×"], [4, "4×"]] },
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
    lead: "Pulsa un botón y luego la combinación nueva. Esc cancela.",
    fields: [
      { kind: "hotkey", path: "hotkeyToggle", label: "Mostrar u ocultar" },
      { kind: "hotkey", path: "hotkeyGhost", label: "Modo fantasma" },
    ],
  },
  {
    id: "avisos",
    title: "Avisos",
    lead: "Notificaciones de Windows. Cada una suena una sola vez por ventana o periodo.",
    fields: [
      { kind: "switch", path: "alerts.fiveHour", label: "Banca de 5 h baja" },
      { kind: "number", path: "alerts.fiveHourBelow", label: "Avisar bajo", min: 1, max: 90, step: 1, unit: "%" },
      { kind: "switch", path: "alerts.week", label: "Banca semanal baja" },
      { kind: "number", path: "alerts.weekBelow", label: "Avisar bajo", min: 1, max: 90, step: 1, unit: "%" },
      { kind: "switch", path: "alerts.spend", label: "Tope de gasto", help: "Del periodo elegido en Datos, en dólares." },
      { kind: "number", path: "alerts.spendOverUsd", label: "Avisar sobre", min: 1, max: 100000, step: 1, unit: "USD" },
      { kind: "switch", path: "alerts.expired", label: "Sesión caducada" },
      { kind: "action", label: "Probar", button: "Enviar aviso de prueba", run: () => bridge.testAlert() },
    ],
  },
  {
    id: "datos",
    title: "Datos",
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
      { kind: "choice", path: "currency", label: "Moneda", options: [["USD", "Dólares"], ["CRC", "Colones"]] },
      {
        kind: "number",
        path: "crcPerUsd",
        label: "Tipo de cambio",
        min: 1,
        max: 5000,
        step: 0.5,
        unit: "₡ por $",
        showIf: (s) => s.currency === "CRC",
      },
    ],
  },
  {
    id: "sonido",
    title: "Sonido",
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
      {
        kind: "action",
        label: "Probar",
        button: "Escuchar fichas",
        run: () => {
          sound.configure({ ...settings.sound, enabled: true, muteInGame: false }, false);
          sound.play("chip");
          window.setTimeout(() => sound.play("chip"), 160);
          window.setTimeout(() => sound.play("chip"), 300);
        },
      },
    ],
  },
];

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
  statusEl.textContent = text;
  statusEl.className = `status ${kind}`;
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
  refreshers.forEach((r) => r());
}

function fieldRow(label: string, control: HTMLElement, help?: string, id?: string) {
  const row = el("div", { className: "field" });
  const lab = el("label", { textContent: label });
  if (id) {
    lab.htmlFor = id;
    control.id = id;
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
        b.addEventListener("click", () => void save(f.path, value));
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
      refreshers.push(() => {
        const v = toUi(Number(get(f.path)));
        input.value = String(v);
        out.textContent = show(v);
      });
      return fieldRow(f.label, wrap, f.help, id);
    }
    case "number": {
      const input = el("input", { type: "number", min: String(f.min), max: String(f.max), step: String(f.step) });
      const wrap = el("span", { className: "number" }, input, f.unit);
      input.addEventListener("change", () => {
        const v = Number(input.value);
        if (Number.isFinite(v)) void save(f.path, Math.min(f.max, Math.max(f.min, v)));
      });
      const row = fieldRow(f.label, wrap, f.help, id);
      refreshers.push(() => {
        if (document.activeElement !== input) input.value = String(get(f.path));
        row.hidden = f.showIf ? !f.showIf(settings) : false;
      });
      return row;
    }
    case "hotkey": {
      const btn = el("button", { className: "hotkey", type: "button" });
      let capturing = false;
      const stop = () => {
        capturing = false;
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

/** Nombre de la tecla en el formato que entiende el backend ("F", "1", "F5"…). */
function keyName(e: KeyboardEvent): string | null {
  if (["Control", "Alt", "Shift", "Meta", "OS"].includes(e.key)) return null;
  if (e.code.startsWith("Key")) return e.code.slice(3);
  if (e.code.startsWith("Digit")) return e.code.slice(5);
  return e.code; // F1–F24, ArrowUp, Space, Numpad…
}

// ── Diseños con vista previa ───────────────────────────────────────────────

function renderDesigns(): HTMLElement {
  const grid = el("div", { className: "designs" });
  grid.setAttribute("role", "radiogroup");
  grid.setAttribute("aria-label", "Diseño");
  const snap: Snapshot = demoSnapshot();
  const views: DesignView[] = [];

  for (const info of DESIGN_LIST) {
    const card = el("button", { className: "design-card", type: "button", disabled: !info.ready });
    card.setAttribute("role", "radio");
    const stage = el("div", { className: "stage" });
    if (info.ready) {
      const canvas = el("canvas");
      stage.append(canvas);
      const design = info.create();
      const scale = design.height > 140 ? 1 : design.width < 80 ? 2 : 1;
      views.push(new DesignView(canvas, design, scale));
    } else {
      stage.append(el("span", { className: "soon", textContent: "Pronto" }));
    }
    card.append(stage, el("strong", { textContent: info.name }), el("span", { textContent: info.description }));
    card.addEventListener("click", () => void save("design", info.id));
    refreshers.push(() => card.setAttribute("aria-checked", String(settings.design === info.id)));
    grid.append(card);
  }

  const feed = (first: boolean) =>
    views.forEach((v) => v.feed(structuredClone(snap), { settings, motion: settings.motion, cue: () => {} }, first));
  refreshers.push(() => feed(true));
  window.setInterval(() => {
    advanceDemo(snap);
    feed(false);
  }, 3000);
  return grid;
}

// ── Arranque ───────────────────────────────────────────────────────────────

async function start() {
  bridge = await createBridge();
  settings = await bridge.getSettings();
  bridge.onSettings((next) => {
    settings = next;
    refreshAll();
  });

  const nav = document.querySelector<HTMLElement>("#nav")!;
  const content = document.querySelector<HTMLElement>("#content")!;
  const panels = SECTIONS.map((section, i) => {
    const tab = el("button", { type: "button", textContent: section.title, id: `tab-${section.id}` });
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

  function select(index: number) {
    panels.forEach(({ tab, panel }, i) => {
      tab.setAttribute("aria-selected", String(i === index));
      tab.tabIndex = i === index ? 0 : -1;
      panel.hidden = i !== index;
    });
    content.scrollTop = 0;
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

  document.querySelector("#close")!.addEventListener("click", () => void bridge.hideWindow());
  select(0);
  refreshAll();
}

void start();
