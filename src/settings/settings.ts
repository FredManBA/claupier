// Ventana de ajustes. Cada campo se describe en un esquema y se dibuja y
// conecta de forma genérica; Rust valida, guarda y aplica cada cambio.

import "./settings.css";
import { advanceDemo, createBridge, demoSnapshot, type Bridge } from "../core/bridge";
import { chipSprites } from "../core/chips";
import { pixelSupports, setTextStyle } from "../core/font";
import { L, resolveLang, setLang } from "../core/i18n";
import { hash } from "../core/paint";
import { SoundEngine } from "../core/sound";
import type { DeepPartial, Settings, Snapshot } from "../core/types";
import type { Cue } from "../designs/design";
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
  | { kind: "hotkey"; path: Path; label: string; help?: string }
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

/** Las secciones, en el idioma elegido (se construyen al arrancar). */
function buildSections(): Section[] {
  return [
  {
    id: "diseno",
    title: L("Diseño", "Design"),
    icon: ["..#####..", ".#.....#.", "#..###..#", "#.#...#.#", "#..###..#", ".#.....#.", "..#####.."],
    lead: L("Elige cómo se ve Claupier. Las vistas previas usan datos de ejemplo.", "Choose how Claupier looks. The previews use sample data."),
    fields: [{ kind: "designs" }],
  },
  {
    id: "ventana",
    title: L("Ventana", "Window"),
    icon: ["#########", "#########", "#.......#", "#.......#", "#.......#", "#.......#", "#########"],
    lead: L("Tamaño, transparencia y lugar de la mesa en la pantalla.", "Size, transparency and where the table sits on the screen."),
    fields: [
      {
        kind: "choice",
        path: "language",
        label: L("Idioma", "Language"),
        options: [["auto", L("Automático", "Automatic")], ["es", "Español"], ["en", "English"]],
        help: L("Automático usa el idioma de Windows.", "Automatic follows the Windows language."),
      },
      {
        kind: "choice",
        path: "scale",
        label: L("Tamaño", "Size"),
        options: [[1, "1×"], [1.5, L("1,5×", "1.5×")], [2, "2×"], [2.5, L("2,5×", "2.5×")], [3, "3×"], [4, "4×"]],
        help: L("1× es la más chica: ideal para dejarla en una esquina mientras juegas. Los tamaños con medio se ven un poco más suaves.", "1× is the smallest: great for a corner of the screen while you play. Half sizes look slightly softer."),
      },
      {
        kind: "choice",
        path: "textStyle",
        label: L("Texto", "Text"),
        options: [["pixel", L("Pixel", "Pixel")], ["smooth", L("Normal", "Smooth")]],
        help: L("Normal usa la letra de Windows, sin pixelar, para leer las cifras con más claridad. El logotipo sigue en pixel.", "Smooth uses the Windows font, without pixels, so numbers read more clearly. The logo stays pixel art."),
      },
      {
        kind: "range",
        path: "opacity",
        label: L("Opacidad", "Opacity"),
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
        label: L("Posición", "Position"),
        help: L("Ánclala a una esquina o déjala libre para moverla arrastrando. Si la arrastras, queda libre.", "Anchor it to a corner or leave it free to move it by dragging. If you drag it, it becomes free."),
      },
      { kind: "switch", path: "alwaysOnTop", label: L("Siempre encima", "Always on top") },
      {
        kind: "choice",
        path: "motion",
        label: L("Animación", "Animation"),
        options: [["full", L("Completa", "Full")], ["reduced", L("Reducida", "Reduced")], ["off", L("Apagada", "Off")]],
        help: L("Reducida: las fichas aparecen sin caer y no giran solas.", "Reduced: chips appear without falling and don't spin by themselves."),
      },
    ],
  },
  {
    id: "inicio",
    title: L("Inicio", "Startup"),
    icon: ["....#....", "..#.#.#..", ".#..#..#.", "#...#...#", "#.......#", ".#.....#.", "..#####.."],
    lead: L("Qué hace Claupier al arrancar.", "What Claupier does when it starts."),
    fields: [
      { kind: "switch", path: "autostart", label: L("Arrancar con Windows", "Start with Windows") },
      { kind: "switch", path: "startHidden", label: L("Empezar oculta", "Start hidden"), help: L("Aparece cuando pulses el atajo.", "It appears when you press the shortcut.") },
      { kind: "switch", path: "startGhost", label: L("Empezar en modo fantasma", "Start in ghost mode"), help: L("Los clics atraviesan la mesa.", "Clicks go through the table.") },
    ],
  },
  {
    id: "atajos",
    title: L("Atajos", "Shortcuts"),
    icon: ["#########", "#.......#", "#.#.#.#.#", "#.......#", "#.#####.#", "#.......#", "#########"],
    lead: L("Pulsa un botón y luego la combinación nueva. Esc cancela.", "Press a button, then the new combination. Esc cancels."),
    fields: [
      { kind: "hotkey", path: "hotkeyToggle", label: L("Mostrar u ocultar", "Show or hide") },
      { kind: "hotkey", path: "hotkeyGhost", label: L("Modo fantasma", "Ghost mode") },
      {
        kind: "hotkey",
        path: "hotkeyReplay",
        label: L("Repetir animación", "Replay animation"),
        help: L(
          "Vacía el diseño y lo vuelve a llenar con tus datos reales, para ver el arte desde cero.",
          "Empties the design and fills it again with your real data, to watch the art from scratch.",
        ),
      },
      {
        kind: "hotkey",
        path: "hotkeyShow",
        label: L("Modo caótico", "Chaos mode"),
        help: L(
          "Unos 12 segundos con datos de prueba: el gasto pasa por todas las fichas y las bancas bajan hasta el rojo, para ver cada animación y color. Después vuelve a tus datos.",
          "About 12 seconds of test data: spend runs through every chip and the banks drop to red, to see every animation and color. Then it goes back to your data.",
        ),
      },
    ],
  },
  {
    id: "avisos",
    title: L("Avisos", "Alerts"),
    icon: ["....#....", "..#####..", ".#######.", ".#######.", ".#######.", "#########", "....#...."],
    lead: L("Notificaciones de Windows. Cada una suena una sola vez por ventana o periodo.", "Windows notifications. Each one fires only once per window or period."),
    fields: [
      { kind: "switch", path: "alerts.fiveHour", label: L("Banca de 5 h baja", "Low 5-hour bank") },
      { kind: "number", path: "alerts.fiveHourBelow", label: L("Avisar bajo", "Alert below"), min: 1, max: 90, step: 1, unit: "%", under: "alerts.fiveHour" },
      { kind: "switch", path: "alerts.week", label: L("Banca semanal baja", "Low weekly bank") },
      { kind: "number", path: "alerts.weekBelow", label: L("Avisar bajo", "Alert below"), min: 1, max: 90, step: 1, unit: "%", under: "alerts.week" },
      { kind: "switch", path: "alerts.spend", label: L("Tope de gasto", "Spending cap"), help: L("Del periodo elegido en Datos, en dólares.", "For the period chosen in Data, in dollars.") },
      {
        kind: "number",
        path: "alerts.spendOverUsd",
        label: L("Avisar sobre", "Alert above"),
        min: 1,
        max: 100000,
        step: 1,
        unit: "USD",
        under: "alerts.spend",
      },
      { kind: "switch", path: "alerts.expired", label: L("Sesión caducada", "Session expired") },
      { kind: "action", label: L("Probar", "Try it"), button: L("Enviar aviso de prueba", "Send a test alert"), run: () => bridge.testAlert() },
    ],
  },
  {
    id: "datos",
    title: L("Datos", "Data"),
    icon: [".......#.", ".......#.", "....#..#.", "....#..#.", ".#..#..#.", ".#..#..#.", "#########"],
    lead: L("Qué cuenta la banca, qué periodo muestran las fichas y en qué moneda.", "What the bank counts, which period the chips show and in which currency."),
    fields: [
      { kind: "choice", path: "bankShows", label: L("La banca muestra", "The bank shows"), options: [["left", L("Lo que queda", "What's left")], ["used", L("Lo usado", "What's used")]] },
      {
        kind: "choice",
        path: "period",
        label: L("Gasto de", "Spend for"),
        options: [["today", L("Hoy", "Today")], ["window5h", L("Ventana 5 h", "5-hour window")], ["week", L("Semana", "Week")]],
      },
      {
        kind: "range",
        path: "planPollMinutes",
        label: L("Consultar el plan", "Check the plan"),
        min: 2,
        max: 30,
        step: 1,
        show: (v) => `${v} min`,
        help: L("Anthropic limita las consultas seguidas; menos de 2 minutos no está permitido.", "Anthropic limits repeated requests; less than 2 minutes is not allowed."),
      },
      {
        kind: "choice",
        path: "currency",
        label: L("Moneda", "Currency"),
        options: [["USD", L("Dólares", "Dollars")], ["local", L("Otra moneda", "Other currency")]],
        help: L("El gasto se calcula en dólares. Con otra moneda, Claupier lo convierte con el cambio que escribas.", "Spend is calculated in dollars. With another currency, Claupier converts it with the rate you type."),
      },
      {
        kind: "text",
        path: "localSymbol",
        label: L("Símbolo", "Symbol"),
        maxLength: 4,
        placeholder: "₡",
        help: L("Por ejemplo ₡, €, £, ¥, MX$ o S/. Hasta 4 caracteres.", "For example ₡, €, £, ¥, MX$ or S/. Up to 4 characters."),
        showIf: (s) => s.currency === "local",
        warn: (s) => {
          if (s.textStyle !== "pixel") return null;
          const missing = [...s.localSymbol].filter((ch) => ch.trim() && !pixelSupports(ch));
          if (!missing.length) return null;
          const chars = missing.join("");
          return L(
            `La letra pixel no tiene «${chars}»: elige el texto Normal en Ventana o usa otro símbolo.`,
            `The pixel font has no "${chars}": choose Smooth text in Window or use another symbol.`,
          );
        },
      },
      {
        kind: "number",
        path: "localPerUsd",
        label: L("1 dólar vale", "1 dollar is worth"),
        min: 0.0001,
        max: 1_000_000,
        step: 0.01,
        unit: (s) => s.localSymbol || "¤",
        help: L("Cuántas unidades de tu moneda compras con un dólar. Escríbelo a mano y actualízalo cuando cambie.", "How many units of your currency one dollar buys. Type it in and update it when it changes."),
        showIf: (s) => s.currency === "local",
      },
    ],
  },
  {
    id: "sonido",
    title: L("Sonido", "Sound"),
    icon: ["...#.....", "..##..#..", "####...#.", "####.#.#.", "####...#.", "..##..#..", "...#....."],
    lead: L("Sonidos suaves generados en el momento, sin agudos. Cada diseño tiene los suyos. Vienen apagados.", "Soft sounds generated on the fly, with no harsh highs. Each design has its own. They start off."),
    fields: [
      { kind: "switch", path: "sound.enabled", label: L("Activar sonido", "Turn on sound") },
      {
        kind: "range",
        path: "sound.volume",
        label: L("Volumen", "Volume"),
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
        label: L("Silenciar en juego", "Mute while gaming"),
        help: L("Con una app en pantalla completa o con Windows en No molestar.", "With an app in full screen or Windows in Do Not Disturb."),
      },
      {
        kind: "action",
        label: L("Probar", "Try it"),
        button: L("Escuchar el diseño elegido", "Play the chosen design"),
        help: L("Mesa: fichas y su roce. Píldora: un toque mínimo. Tragamonedas: palanca, rodillos y monedas. Pachinko: bolas y casillas.", "Table: chips and their slide. Pill: a tiny tap. Slot machine: lever, reels and coins. Pachinko: balls and pockets."),
        run: () => playDesignSounds(),
      },
    ],
  },
  ];
}

/** Una muestra de los sonidos del diseño elegido, con el volumen elegido. */
function playDesignSounds() {
  sound.configure(settings.sound, false);
  const demos: Record<Settings["design"], [number, Cue, number?][]> = {
    mesa: [[0, "chip"], [170, "chip"], [320, "chip"], [620, "glide"]],
    pildora: [[0, "tick"], [260, "tick"]],
    tragamonedas: [
      [0, "lever"],
      ...[200, 260, 320, 380, 440, 520, 620].map((ms): [number, Cue] => [ms, "reel"]),
      [820, "coin", 1.12],
      [910, "coin", 0.9],
      [1000, "coin", 0.72],
    ],
    pachinko: [...[0, 80, 160, 240, 320, 400].map((ms): [number, Cue] => [ms, "ball"]), [560, "pocket"]],
  };
  for (const [delay, cue, pitch] of demos[settings.design]) window.setTimeout(() => sound.preview(cue, pitch), delay);
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
    setStatus(L("Guardado", "Saved"), "saved");
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
        btn.textContent = L("Pulsa la combinación…", "Press the combination…");
        void bridge.setHotkeysPaused(true);
        window.addEventListener("keydown", onKey, true);
      });
      refreshers.push(() => {
        if (!capturing) btn.textContent = String(get(f.path));
      });
      return fieldRow(f.label, btn, f.help, id);
    }
    case "anchor": {
      const screen = el("div", { className: "screen" });
      screen.setAttribute("role", "radiogroup");
      screen.setAttribute("aria-label", f.label);
      const names: Record<string, string> = {
        "top-left": L("Arriba a la izquierda", "Top left"),
        "top-right": L("Arriba a la derecha", "Top right"),
        "bottom-left": L("Abajo a la izquierda", "Bottom left"),
        "bottom-right": L("Abajo a la derecha", "Bottom right"),
        free: L("Libre", "Free"),
      };
      const buttons = Object.entries(names).map(([value, name]) => {
        const b = el("button", { type: "button", title: name });
        b.dataset.value = value;
        b.setAttribute("role", "radio");
        b.setAttribute("aria-label", name);
        if (value === "free") b.textContent = L("Libre", "Free");
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
  grid.setAttribute("aria-label", L("Diseño", "Design"));
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
    // En pasos de un cuarto: los tamaños no enteros se suavizan un poco, pero
    // así la vista previa aprovecha la tarjeta en vez de quedarse en 1×.
    const scaleFor = (w: number) =>
      Math.max(1, Math.floor(Math.min(w / design.width, box.h / design.height) * dpr * 4) / 4) / dpr;
    const view = new DesignView(canvas, design, scaleFor(box.w));
    views.push(view);
    new ResizeObserver(() => {
      const room = Math.min(box.w, stage.clientWidth - 8);
      if (room > 0) view.setScale(scaleFor(room));
    }).observe(stage);
    card.append(
      stage,
      el("div", { className: "head" }, el("strong", { textContent: info.name }), el("em", { className: "badge", textContent: L("En uso", "In use") })),
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

/** Los textos fijos de settings.html, en el idioma elegido. */
function applyStaticTexts() {
  document.documentElement.lang = L("es", "en");
  document.title = L("Ajustes de Claupier", "Claupier settings");
  document.querySelector(".subtitle")!.textContent = L("Ajustes", "Settings");
  document.querySelector("#close")!.setAttribute("aria-label", L("Cerrar ajustes", "Close settings"));
  document.querySelector("#nav")!.setAttribute("aria-label", L("Secciones", "Sections"));
}

async function start() {
  bridge = await createBridge();
  await bridge.onSettings((next) => {
    const relabel = next.language !== settings?.language && settings !== undefined;
    settings = next;
    if (relabel) location.reload();
    else refreshAll();
  });
  settings = await bridge.getSettings();
  setLang(resolveLang(settings.language));
  applyStaticTexts();
  const SECTIONS = buildSections();

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
