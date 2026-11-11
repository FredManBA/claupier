// Idioma de la interfaz: español o inglés. Rust tiene su propia copia para la
// bandeja y los avisos (`src-tauri/src/i18n.rs`).

export type Lang = "es" | "en";
export type LanguageSetting = "auto" | Lang;

let lang: Lang = "es";

/** «auto» sigue el idioma del sistema: español si lo es; si no, inglés. */
export function resolveLang(setting: LanguageSetting | undefined): Lang {
  if (setting === "es" || setting === "en") return setting;
  return (navigator.language || "en").toLowerCase().startsWith("es") ? "es" : "en";
}

export function setLang(next: Lang) {
  lang = next;
}

export function getLang(): Lang {
  return lang;
}

/** El texto en el idioma actual. */
export function L(es: string, en: string): string {
  return lang === "es" ? es : en;
}
