//! Decide cuándo mandar una notificación de Windows. Cada aviso suena una vez
//! por ventana (o por periodo) y solo se rearma cuando la situación mejora con
//! margen, para no repetirse si el valor baila alrededor del umbral.

use chrono::{DateTime, Duration, DurationRound, Utc};

use crate::i18n::Lang;
use crate::plan::{LimitWindow, PlanInfo};
use crate::settings::Alerts as AlertSettings;

/// Margen (en puntos de %) para rearmar un aviso de banca.
const REARM_MARGIN: f64 = 5.0;

#[derive(Default)]
pub struct AlertState {
    five_hour: Option<String>,
    week: Option<String>,
    spend: Option<String>,
    expired: bool,
}

pub struct Alert {
    pub title: String,
    pub body: String,
}

/// Identifica una ventana del plan por la hora de su reinicio, redondeada a la
/// hora más cercana: así 17:59:59 y 18:00:01 cuentan como la misma ventana.
/// `None` si el servidor no dio un reinicio válido.
pub fn window_key(w: &LimitWindow) -> Option<String> {
    let reset = w.resets_at.as_deref()?.parse::<DateTime<Utc>>().ok()?;
    let rounded = (reset + Duration::minutes(30)).duration_trunc(Duration::hours(1)).ok()?;
    Some(rounded.format("%Y-%m-%dT%H").to_string())
}

/// Qué banca es, para escribir el aviso.
#[derive(Clone, Copy)]
enum Bank {
    FiveHour,
    Week,
}

#[allow(clippy::too_many_arguments)]
fn check_bank(
    fired: &mut Option<String>,
    enabled: bool,
    below: u8,
    win: Option<&LimitWindow>,
    bank: Bank,
    lang: Lang,
    out: &mut Vec<Alert>,
) {
    let Some(w) = win else { return };
    let left = (100.0 - w.used).max(0.0);
    // Sin reinicio conocido se conserva la ventana anterior: un hueco en los
    // datos no debe rearmar el aviso.
    let key = window_key(w);
    let new_window = key.as_ref().is_some_and(|k| fired.as_ref().is_some_and(|f| f != k));
    if left > below as f64 + REARM_MARGIN || new_window {
        *fired = None;
    }
    if enabled && left <= below as f64 && fired.is_none() {
        *fired = Some(key.unwrap_or_else(|| "?".into()));
        let title = match (bank, lang) {
            (Bank::FiveHour, Lang::Es) => format!("Tu banca de 5 h está al {left:.0} %"),
            (Bank::Week, Lang::Es) => format!("Tu banca semanal está al {left:.0} %"),
            (Bank::FiveHour, Lang::En) => format!("Your 5-hour bank is at {left:.0}%"),
            (Bank::Week, Lang::En) => format!("Your weekly bank is at {left:.0}%"),
        };
        let body = match lang {
            Lang::Es => format!("Bajó del {below} % que elegiste en los ajustes de Claupier."),
            Lang::En => format!("It dropped below the {below}% you chose in Claupier's settings."),
        };
        out.push(Alert { title, body });
    }
}

impl AlertState {
    /// `spend` es el gasto del periodo elegido (`period`: "today", "window5h" o
    /// "week") y `period_key` lo identifica
    /// (la fecha de hoy o el reinicio de la ventana). Debe ser estable durante
    /// todo el periodo: si cambia, el aviso de gasto se rearma.
    pub fn check(
        &mut self,
        cfg: &AlertSettings,
        plan: &PlanInfo,
        spend_usd: f64,
        period_key: &str,
        period: &str,
        lang: Lang,
    ) -> Vec<Alert> {
        let mut out = Vec::new();
        check_bank(&mut self.five_hour, cfg.five_hour, cfg.five_hour_below, plan.five_hour.as_ref(), Bank::FiveHour, lang, &mut out);
        check_bank(&mut self.week, cfg.week, cfg.week_below, plan.seven_day.as_ref(), Bank::Week, lang, &mut out);

        if self.spend.as_deref().is_some_and(|k| k != period_key) {
            self.spend = None;
        }
        if cfg.spend && spend_usd >= cfg.spend_over_usd && self.spend.is_none() {
            self.spend = Some(period_key.to_string());
            let when = match (period, lang) {
                ("window5h", Lang::Es) => "en esta ventana de 5 h",
                ("week", Lang::Es) => "esta semana",
                (_, Lang::Es) => "hoy",
                ("window5h", Lang::En) => "in this 5-hour window",
                ("week", Lang::En) => "this week",
                (_, Lang::En) => "today",
            };
            let cap = cfg.spend_over_usd;
            out.push(Alert {
                title: match lang {
                    Lang::Es => format!("Llevas ${spend_usd:.2} {when}"),
                    Lang::En => format!("You've spent ${spend_usd:.2} {when}"),
                },
                body: match lang {
                    Lang::Es => format!("Pasaste el tope de ${cap:.0} que elegiste en Claupier."),
                    Lang::En => format!("You passed the ${cap:.0} cap you set in Claupier."),
                },
            });
        }

        let expired = plan.status == "expired";
        if cfg.expired && expired && !self.expired {
            out.push(Alert {
                title: lang.pick("La sesión de Claude caducó", "Your Claude session expired").into(),
                body: lang
                    .pick(
                        "Abre Claude Code para renovarla y Claupier volverá a mostrar tu plan.",
                        "Open Claude Code to renew it and Claupier will show your plan again.",
                    )
                    .into(),
            });
        }
        self.expired = expired;
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn plan(used5h: f64, reset: &str) -> PlanInfo {
        PlanInfo {
            status: "ok".into(),
            five_hour: Some(LimitWindow { used: used5h, resets_at: Some(reset.into()) }),
            seven_day: None,
            plan: None,
            updated_at: None,
        }
    }

    #[test]
    fn avisa_una_vez_por_ventana_y_se_rearma_con_margen() {
        let cfg = AlertSettings::default(); // avisa bajo 20 %
        let mut st = AlertState::default();
        let r1 = "2026-11-10T18:00:00Z";
        assert!(st.check(&cfg, &plan(70.0, r1), 0.0, "d", "today", Lang::Es).is_empty());
        assert_eq!(st.check(&cfg, &plan(82.0, r1), 0.0, "d", "today", Lang::Es).len(), 1);
        assert!(st.check(&cfg, &plan(85.0, r1), 0.0, "d", "today", Lang::Es).is_empty(), "no se repite");
        assert!(st.check(&cfg, &plan(78.0, r1), 0.0, "d", "today", Lang::Es).is_empty(), "sube un poco: sin rearmar");
        assert!(st.check(&cfg, &plan(81.0, r1), 0.0, "d", "today", Lang::Es).is_empty());
        // Ventana nueva: se rearma.
        let r2 = "2026-11-10T23:00:00Z";
        assert_eq!(st.check(&cfg, &plan(90.0, r2), 0.0, "d", "today", Lang::Es).len(), 1);
    }

    #[test]
    fn el_reinicio_que_baila_alrededor_de_la_hora_es_la_misma_ventana() {
        let cfg = AlertSettings::default();
        let mut st = AlertState::default();
        assert_eq!(st.check(&cfg, &plan(85.0, "2026-11-10T17:59:59.900Z"), 0.0, "d", "today", Lang::Es).len(), 1);
        assert!(st.check(&cfg, &plan(86.0, "2026-11-10T18:00:00.100Z"), 0.0, "d", "today", Lang::Es).is_empty());
        // Un reinicio que falta tampoco cuenta como ventana nueva.
        let mut sin_reinicio = plan(87.0, "x");
        sin_reinicio.five_hour.as_mut().unwrap().resets_at = None;
        assert!(st.check(&cfg, &sin_reinicio, 0.0, "d", "today", Lang::Es).is_empty());
    }

    #[test]
    fn tope_de_gasto_por_periodo_y_sesion_caducada() {
        let cfg = AlertSettings { spend: true, spend_over_usd: 50.0, ..Default::default() };
        let mut st = AlertState::default();
        let p = plan(10.0, "x");
        assert!(st.check(&cfg, &p, 49.0, "lunes", "today", Lang::Es).is_empty());
        assert_eq!(st.check(&cfg, &p, 51.0, "lunes", "today", Lang::Es).len(), 1);
        assert!(st.check(&cfg, &p, 80.0, "lunes", "today", Lang::Es).is_empty());
        assert_eq!(st.check(&cfg, &p, 60.0, "martes", "today", Lang::Es).len(), 1);

        let mut expired = p.clone();
        expired.status = "expired".into();
        assert_eq!(st.check(&cfg, &expired, 0.0, "martes", "today", Lang::Es).len(), 1);
        assert!(st.check(&cfg, &expired, 0.0, "martes", "today", Lang::Es).is_empty());
    }
}
