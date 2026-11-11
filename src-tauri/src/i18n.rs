//! Idioma de los textos que escribe Rust: la bandeja, los avisos y los errores
//! de los ajustes. La ventana tiene su propia copia en `src/core/i18n.ts`.

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Lang {
    Es,
    En,
}

impl Lang {
    /// Elige el texto del idioma.
    pub fn pick<'a>(self, es: &'a str, en: &'a str) -> &'a str {
        match self {
            Lang::Es => es,
            Lang::En => en,
        }
    }
}

/// El idioma del ajuste: "es", "en" o "auto" (el de Windows).
pub fn resolve(setting: &str) -> Lang {
    match setting {
        "es" => Lang::Es,
        "en" => Lang::En,
        _ => system(),
    }
}

/// Español si Windows está en español; inglés en cualquier otro caso.
#[cfg(windows)]
fn system() -> Lang {
    // SAFETY: no recibe punteros y solo lee el idioma de la interfaz del usuario.
    let id = unsafe { windows::Win32::Globalization::GetUserDefaultUILanguage() };
    const LANG_SPANISH: u16 = 0x0a;
    if id & 0x3ff == LANG_SPANISH { Lang::Es } else { Lang::En }
}

#[cfg(not(windows))]
fn system() -> Lang {
    let locale = std::env::var("LANG").unwrap_or_default();
    if locale.starts_with("es") { Lang::Es } else { Lang::En }
}
