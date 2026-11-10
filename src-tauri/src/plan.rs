//! Porcentaje usado del plan (ventana de 5 h y semanal), con la misma fuente
//! que el comando `/usage` de Claude Code.
//!
//! Usa el token OAuth que Claude Code guarda en `~/.claude/.credentials.json`.
//! El token solo se envía a api.anthropic.com y nunca se registra ni se muestra.
//! No se refresca el token aquí: si caduca, Claude Code lo renueva al usarlo.
//!
//! El endpoint no está documentado oficialmente y limita las consultas
//! seguidas (429), así que se consulta cada pocos minutos con espera creciente.

use std::path::PathBuf;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use serde_json::Value;

const USAGE_URL: &str = "https://api.anthropic.com/api/oauth/usage";
const NORMAL_EVERY: Duration = Duration::from_secs(150);
const RETRY_EVERY: Duration = Duration::from_secs(60);
const MAX_BACKOFF: Duration = Duration::from_secs(15 * 60);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LimitWindow {
    /// Porcentaje usado, de 0 a 100.
    pub used: f64,
    pub resets_at: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanInfo {
    /// loading | ok | expired | no_credentials | rate_limited | error
    pub status: String,
    pub five_hour: Option<LimitWindow>,
    pub seven_day: Option<LimitWindow>,
    pub plan: Option<String>,
    pub updated_at: Option<String>,
}

impl Default for PlanInfo {
    fn default() -> Self {
        Self { status: "loading".into(), five_hour: None, seven_day: None, plan: None, updated_at: None }
    }
}

pub struct PlanFetcher {
    credentials: PathBuf,
    client: reqwest::blocking::Client,
    next: Instant,
    backoff: Duration,
    pub info: PlanInfo,
}

impl PlanFetcher {
    pub fn new(claude_dir: PathBuf) -> Self {
        let client = reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(15))
            .user_agent("claupier/0.1")
            .build()
            .expect("cliente HTTP");
        Self {
            credentials: claude_dir.join(".credentials.json"),
            client,
            next: Instant::now(),
            backoff: NORMAL_EVERY,
            info: PlanInfo::default(),
        }
    }

    /// Fuerza una consulta en el próximo `tick`.
    pub fn poke(&mut self) {
        self.next = Instant::now();
    }

    /// Devuelve `true` si cambió la información.
    pub fn tick(&mut self) -> bool {
        if Instant::now() < self.next {
            return false;
        }
        let before = serde_json::to_string(&self.info).unwrap_or_default();
        let wait = self.fetch();
        self.next = Instant::now() + wait;
        before != serde_json::to_string(&self.info).unwrap_or_default()
    }

    fn set_status(&mut self, status: &str) {
        self.info.status = status.into();
    }

    fn fetch(&mut self) -> Duration {
        let Some((token, expires_at, plan)) = self.read_credentials() else {
            self.set_status("no_credentials");
            return RETRY_EVERY;
        };
        self.info.plan = plan;

        let now_ms = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0);
        if expires_at.is_some_and(|exp| exp <= now_ms) {
            self.set_status("expired");
            return RETRY_EVERY;
        }

        let res = self
            .client
            .get(USAGE_URL)
            .bearer_auth(&token)
            .header("anthropic-beta", "oauth-2025-04-20")
            .header("Content-Type", "application/json")
            .send();

        let res = match res {
            Ok(r) => r,
            Err(_) => {
                self.set_status("error");
                return RETRY_EVERY;
            }
        };

        match res.status().as_u16() {
            200 => {}
            401 | 403 => {
                self.set_status("expired");
                return RETRY_EVERY;
            }
            429 => {
                self.set_status("rate_limited");
                self.backoff = (self.backoff * 2).min(MAX_BACKOFF);
                return self.backoff;
            }
            _ => {
                self.set_status("error");
                return RETRY_EVERY * 2;
            }
        }

        let Ok(body) = res.json::<Value>() else {
            self.set_status("error");
            return RETRY_EVERY * 2;
        };

        self.info.five_hour = parse_window(&body["five_hour"]);
        self.info.seven_day = parse_window(&body["seven_day"]);
        self.info.updated_at = Some(chrono::Utc::now().to_rfc3339());
        self.set_status("ok");
        self.backoff = NORMAL_EVERY;
        NORMAL_EVERY
    }

    fn read_credentials(&self) -> Option<(String, Option<i64>, Option<String>)> {
        let text = std::fs::read_to_string(&self.credentials).ok()?;
        let v: Value = serde_json::from_str(&text).ok()?;
        let oauth = &v["claudeAiOauth"];
        let token = oauth["accessToken"].as_str()?.to_string();
        let expires = oauth["expiresAt"].as_i64();
        let plan = oauth["subscriptionType"].as_str().map(str::to_string);
        Some((token, expires, plan))
    }
}

fn parse_window(v: &Value) -> Option<LimitWindow> {
    let used = v["utilization"].as_f64()?;
    Some(LimitWindow { used, resets_at: v["resets_at"].as_str().map(str::to_string) })
}
