//! Decide cuándo mandar una notificación de Windows. Cada aviso suena una vez
//! por ventana (o por periodo) y solo se rearma cuando la situación mejora con
//! margen, para no repetirse si el valor baila alrededor del umbral.

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

/// Identifica una ventana del plan por la hora de su reinicio. Se redondea a
/// la hora para que pequeñas variaciones del servidor no cuenten como otra.
fn window_key(w: &LimitWindow) -> String {
    w.resets_at.as_deref().map(|s| s.chars().take(13).collect()).unwrap_or_else(|| "?".into())
}

fn check_bank(
    fired: &mut Option<String>,
    enabled: bool,
    below: u8,
    win: Option<&LimitWindow>,
    name: &str,
    out: &mut Vec<Alert>,
) {
    let Some(w) = win else { return };
    let left = (100.0 - w.used).max(0.0);
    let key = window_key(w);
    if left > below as f64 + REARM_MARGIN || fired.as_deref().is_some_and(|k| k != key) {
        *fired = None;
    }
    if enabled && left <= below as f64 && fired.is_none() {
        *fired = Some(key);
        out.push(Alert {
            title: format!("Tu banca {name} está al {left:.0} %"),
            body: format!("Bajó del {below} % que elegiste en los ajustes de Claupier."),
        });
    }
}

impl AlertState {
    /// `spend` es el gasto del periodo elegido y `period_key` lo identifica
    /// (la fecha de hoy o el reinicio de la ventana).
    pub fn check(
        &mut self,
        cfg: &AlertSettings,
        plan: &PlanInfo,
        spend_usd: f64,
        period_key: &str,
        period_name: &str,
    ) -> Vec<Alert> {
        let mut out = Vec::new();
        check_bank(&mut self.five_hour, cfg.five_hour, cfg.five_hour_below, plan.five_hour.as_ref(), "de 5 h", &mut out);
        check_bank(&mut self.week, cfg.week, cfg.week_below, plan.seven_day.as_ref(), "semanal", &mut out);

        if self.spend.as_deref().is_some_and(|k| k != period_key) {
            self.spend = None;
        }
        if cfg.spend && spend_usd >= cfg.spend_over_usd && self.spend.is_none() {
            self.spend = Some(period_key.to_string());
            out.push(Alert {
                title: format!("Llevas ${spend_usd:.2} {period_name}"),
                body: format!("Pasaste el tope de ${:.0} que elegiste en Claupier.", cfg.spend_over_usd),
            });
        }

        let expired = plan.status == "expired";
        if cfg.expired && expired && !self.expired {
            out.push(Alert {
                title: "La sesión de Claude caducó".into(),
                body: "Abre Claude Code para renovarla y Claupier volverá a mostrar tu plan.".into(),
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
        assert!(st.check(&cfg, &plan(70.0, r1), 0.0, "d", "hoy").is_empty());
        assert_eq!(st.check(&cfg, &plan(82.0, r1), 0.0, "d", "hoy").len(), 1);
        assert!(st.check(&cfg, &plan(85.0, r1), 0.0, "d", "hoy").is_empty(), "no se repite");
        assert!(st.check(&cfg, &plan(78.0, r1), 0.0, "d", "hoy").is_empty(), "sube un poco: sin rearmar");
        assert!(st.check(&cfg, &plan(81.0, r1), 0.0, "d", "hoy").is_empty());
        // Ventana nueva: se rearma.
        let r2 = "2026-11-10T23:00:00Z";
        assert_eq!(st.check(&cfg, &plan(90.0, r2), 0.0, "d", "hoy").len(), 1);
    }

    #[test]
    fn tope_de_gasto_por_periodo_y_sesion_caducada() {
        let cfg = AlertSettings { spend: true, spend_over_usd: 50.0, ..Default::default() };
        let mut st = AlertState::default();
        let p = plan(10.0, "x");
        assert!(st.check(&cfg, &p, 49.0, "lunes", "hoy").is_empty());
        assert_eq!(st.check(&cfg, &p, 51.0, "lunes", "hoy").len(), 1);
        assert!(st.check(&cfg, &p, 80.0, "lunes", "hoy").is_empty());
        assert_eq!(st.check(&cfg, &p, 60.0, "martes", "hoy").len(), 1);

        let mut expired = p.clone();
        expired.status = "expired".into();
        assert_eq!(st.check(&cfg, &expired, 0.0, "martes", "hoy").len(), 1);
        assert!(st.check(&cfg, &expired, 0.0, "martes", "hoy").is_empty());
    }
}
