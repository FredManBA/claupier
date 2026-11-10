//! Ajustes de Claupier. Rust es la única fuente de verdad: aquí se validan,
//! se guardan en `app_config_dir()/settings.json` y desde aquí se aplican.

use std::path::{Path, PathBuf};
use std::str::FromStr;

use serde::{Deserialize, Serialize};
use tauri_plugin_global_shortcut::{Modifiers, Shortcut};

pub const DESIGNS: &[&str] = &["mesa", "pildora", "tragamonedas", "pachinko"];
const ANCHORS: &[&str] = &["free", "top-left", "top-right", "bottom-left", "bottom-right"];
/// Ctrl+Shift+Alt+Super y una tecla como «MediaPlayPause» caben de sobra.
const MAX_HOTKEY_LEN: usize = 48;
/// «MX$», «CHF» o «S/» caben; más no entra en las placas.
const MAX_SYMBOL_CHARS: usize = 4;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Alerts {
    pub five_hour: bool,
    /// Avisa cuando lo que queda de la ventana de 5 h baja de este %.
    pub five_hour_below: u8,
    pub week: bool,
    pub week_below: u8,
    pub spend: bool,
    /// Tope de gasto del periodo, en USD.
    pub spend_over_usd: f64,
    pub expired: bool,
}

impl Default for Alerts {
    fn default() -> Self {
        Self {
            five_hour: true,
            five_hour_below: 20,
            week: true,
            week_below: 15,
            spend: false,
            spend_over_usd: 100.0,
            expired: true,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Sound {
    pub enabled: bool,
    /// 0 a 1.
    pub volume: f64,
    pub mute_in_game: bool,
}

impl Default for Sound {
    fn default() -> Self {
        Self { enabled: false, volume: 0.5, mute_in_game: true }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub design: String,
    /// Escala de los píxeles: de 1 a 4.
    pub scale: u8,
    /// "pixel" o "smooth" (texto normal, sin pixelar).
    pub text_style: String,
    /// 0,3 a 1.
    pub opacity: f64,
    pub anchor: String,
    pub always_on_top: bool,
    pub autostart: bool,
    pub start_hidden: bool,
    pub start_ghost: bool,
    pub hotkey_toggle: String,
    pub hotkey_ghost: String,
    pub alerts: Alerts,
    /// "left": la banca muestra lo que queda; "used": lo usado.
    pub bank_shows: String,
    /// "today", "window5h" o "week".
    pub period: String,
    pub plan_poll_minutes: u32,
    /// "USD" o "local" (otra moneda, con su símbolo y su cambio).
    /// Los archivos viejos dicen "CRC": se leen como "local" con ₡.
    pub currency: String,
    /// Símbolo de la otra moneda, como «₡», «€» o «MX$».
    pub local_symbol: String,
    /// Cuánto vale un dólar en la otra moneda, escrito a mano.
    #[serde(alias = "crcPerUsd")]
    pub local_per_usd: f64,
    /// "full", "reduced" u "off".
    pub motion: String,
    pub sound: Sound,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            design: "mesa".into(),
            scale: 3,
            text_style: "pixel".into(),
            opacity: 1.0,
            anchor: "free".into(),
            always_on_top: true,
            autostart: false,
            start_hidden: false,
            start_ghost: false,
            hotkey_toggle: "Ctrl+Alt+F".into(),
            hotkey_ghost: "Ctrl+Alt+G".into(),
            alerts: Alerts::default(),
            bank_shows: "left".into(),
            period: "today".into(),
            plan_poll_minutes: 3,
            currency: "USD".into(),
            local_symbol: "₡".into(),
            local_per_usd: 505.0,
            motion: "full".into(),
            sound: Sound::default(),
        }
    }
}

fn one_of(value: &mut String, allowed: &[&str], fallback: &str) {
    if !allowed.contains(&value.as_str()) {
        *value = fallback.into();
    }
}

impl Settings {
    /// Corrige valores fuera de rango en vez de fallar: un archivo editado a
    /// mano o de una versión vieja nunca debe impedir que la app arranque.
    pub fn sanitize(&mut self) {
        let d = Settings::default();
        one_of(&mut self.design, DESIGNS, &d.design);
        one_of(&mut self.anchor, ANCHORS, &d.anchor);
        one_of(&mut self.bank_shows, &["left", "used"], &d.bank_shows);
        one_of(&mut self.period, &["today", "window5h", "week"], &d.period);
        if self.currency == "CRC" {
            self.currency = "local".into();
            self.local_symbol = "₡".into();
        }
        one_of(&mut self.currency, &["USD", "local"], &d.currency);
        one_of(&mut self.motion, &["full", "reduced", "off"], &d.motion);
        one_of(&mut self.text_style, &["pixel", "smooth"], &d.text_style);
        self.scale = self.scale.clamp(1, 4);
        self.opacity = if self.opacity.is_finite() { self.opacity.clamp(0.3, 1.0) } else { 1.0 };
        self.plan_poll_minutes = self.plan_poll_minutes.clamp(2, 30);
        if !self.local_per_usd.is_finite() || self.local_per_usd <= 0.0 {
            self.local_per_usd = d.local_per_usd;
        }
        let symbol: String = self.local_symbol.trim().chars().filter(|c| !c.is_control()).take(MAX_SYMBOL_CHARS).collect();
        self.local_symbol = if symbol.is_empty() { d.local_symbol } else { symbol };
        let a = &mut self.alerts;
        a.five_hour_below = a.five_hour_below.clamp(1, 90);
        a.week_below = a.week_below.clamp(1, 90);
        if !a.spend_over_usd.is_finite() || a.spend_over_usd < 1.0 {
            a.spend_over_usd = 1.0;
        }
        let s = &mut self.sound;
        s.volume = if s.volume.is_finite() { s.volume.clamp(0.0, 1.0) } else { 0.5 };
        if parse_hotkey(&self.hotkey_toggle).is_err() {
            self.hotkey_toggle = d.hotkey_toggle;
        }
        if parse_hotkey(&self.hotkey_ghost).is_err() || same_hotkey(&self.hotkey_ghost, &self.hotkey_toggle) {
            self.hotkey_ghost = d.hotkey_ghost;
        }
    }

    pub fn load(path: &Path) -> Self {
        let mut s = std::fs::read_to_string(path)
            .ok()
            .and_then(|text| serde_json::from_str::<Settings>(&text).ok())
            .unwrap_or_default();
        s.sanitize();
        s
    }

    pub fn save(&self, path: &Path) -> Result<(), String> {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        }
        let text = serde_json::to_string_pretty(self).map_err(|e| e.to_string())?;
        // Escribir a un temporal y renombrar, para no dejar el archivo a medias.
        let tmp = path.with_extension("json.tmp");
        std::fs::write(&tmp, text).map_err(|e| e.to_string())?;
        std::fs::rename(&tmp, path).map_err(|e| e.to_string())
    }

    /// Aplica un cambio parcial (JSON) sobre los ajustes actuales.
    pub fn merged(&self, patch: &serde_json::Value) -> Result<Settings, String> {
        let mut base = serde_json::to_value(self).map_err(|e| e.to_string())?;
        merge(&mut base, patch);
        let mut next: Settings = serde_json::from_value(base).map_err(|e| format!("Ajuste inválido: {e}"))?;
        // Los atajos se validan aparte para poder explicar el error.
        parse_hotkey(&next.hotkey_toggle)?;
        parse_hotkey(&next.hotkey_ghost)?;
        if same_hotkey(&next.hotkey_toggle, &next.hotkey_ghost) {
            return Err("Los dos atajos no pueden ser iguales.".into());
        }
        next.sanitize();
        Ok(next)
    }
}

fn merge(base: &mut serde_json::Value, patch: &serde_json::Value) {
    match (base, patch) {
        (serde_json::Value::Object(b), serde_json::Value::Object(p)) => {
            for (k, v) in p {
                merge(b.entry(k.clone()).or_insert(serde_json::Value::Null), v);
            }
        }
        (b, p) => *b = p.clone(),
    }
}

/// Lee un atajo como "Ctrl+Alt+F". Exige al menos un modificador, para no
/// secuestrar una tecla suelta que el juego necesite.
pub fn parse_hotkey(text: &str) -> Result<Shortcut, String> {
    if text.len() > MAX_HOTKEY_LEN || text.split('+').count() > 5 {
        return Err("Ese atajo es demasiado largo. Usa algo como Ctrl+Alt+F.".into());
    }
    let shortcut =
        Shortcut::from_str(text).map_err(|_| format!("No entiendo el atajo «{text}». Usa algo como Ctrl+Alt+F."))?;
    if shortcut.mods.is_empty() || shortcut.mods == Modifiers::SHIFT {
        return Err(format!("El atajo «{text}» necesita Ctrl, Alt o Win."));
    }
    Ok(shortcut)
}

fn same_hotkey(a: &str, b: &str) -> bool {
    matches!((parse_hotkey(a), parse_hotkey(b)), (Ok(x), Ok(y)) if x == y)
}

pub fn settings_path(config_dir: PathBuf) -> PathBuf {
    config_dir.join("settings.json")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn archivo_viejo_o_incompleto_usa_valores_por_defecto() {
        let s: Settings = serde_json::from_str(r#"{"design":"pildora","sound":{"enabled":true}}"#).unwrap();
        assert_eq!(s.design, "pildora");
        assert!(s.sound.enabled);
        assert_eq!(s.sound.volume, 0.5);
        assert_eq!(s.hotkey_toggle, "Ctrl+Alt+F");
    }

    #[test]
    fn sanitize_corrige_valores_fuera_de_rango() {
        let mut s = Settings { scale: 9, opacity: 0.0, design: "ruleta".into(), plan_poll_minutes: 0, ..Default::default() };
        s.sanitize();
        assert_eq!(s.scale, 4);
        assert_eq!(s.opacity, 0.3);
        assert_eq!(s.design, "mesa");
        assert_eq!(s.plan_poll_minutes, 2);
    }

    #[test]
    fn los_colones_de_antes_pasan_a_otra_moneda() {
        let mut s: Settings = serde_json::from_str(r#"{"currency":"CRC","crcPerUsd":512.5}"#).unwrap();
        s.sanitize();
        assert_eq!(s.currency, "local");
        assert_eq!(s.local_symbol, "₡");
        assert_eq!(s.local_per_usd, 512.5);
    }

    #[test]
    fn simbolo_de_moneda_corto_y_sin_controles() {
        let mut s = Settings { local_symbol: "  MX$\u{7}XYZ ".into(), scale: 0, ..Default::default() };
        s.sanitize();
        assert_eq!(s.local_symbol, "MX$X");
        assert_eq!(s.scale, 1, "1× es el tamaño más chico");
        let mut vacio = Settings { local_symbol: "   ".into(), ..Default::default() };
        vacio.sanitize();
        assert_eq!(vacio.local_symbol, "₡");
    }

    #[test]
    fn merged_aplica_cambios_anidados() {
        let s = Settings::default();
        let next = s.merged(&json!({"alerts": {"spend": true}, "scale": 2})).unwrap();
        assert!(next.alerts.spend);
        assert!(next.alerts.five_hour, "no pisa los demás campos anidados");
        assert_eq!(next.scale, 2);
    }

    #[test]
    fn atajos_validos_e_invalidos() {
        assert!(parse_hotkey("Ctrl+Alt+F").is_ok());
        assert!(parse_hotkey("Ctrl+Shift+F9").is_ok());
        assert!(parse_hotkey("F").is_err(), "sin modificador");
        assert!(parse_hotkey("Shift+F").is_err(), "solo Shift no basta");
        assert!(parse_hotkey("Ctrl+Alt+Nada").is_err());
        let s = Settings::default();
        assert!(s.merged(&json!({"hotkeyGhost": "Ctrl+Alt+F"})).is_err(), "atajos repetidos");
        assert!(s.merged(&json!({"hotkeyToggle": "banana"})).is_err());
        assert!(parse_hotkey("Ctrl+Ctrl+Ctrl+Ctrl+Ctrl+Ctrl+F").is_err(), "demasiado largo");
    }

    #[test]
    fn sanitize_detecta_atajos_iguales_escritos_distinto() {
        let mut s = Settings { hotkey_ghost: "Alt+Ctrl+F".into(), ..Default::default() };
        s.sanitize();
        assert_eq!(s.hotkey_ghost, "Ctrl+Alt+G");
    }
}
