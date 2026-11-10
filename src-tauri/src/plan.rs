//! Porcentaje usado del plan (ventana de 5 h y semanal), con la misma fuente
//! que el comando `/usage` de Claude Code.
//!
//! Usa el token OAuth que Claude Code guarda en `~/.claude/.credentials.json`.
//! El token solo se envía a api.anthropic.com y nunca se registra ni se muestra.
//! No se refresca el token aquí: si caduca, Claude Code lo renueva al usarlo.
//!
//! El endpoint no está documentado oficialmente y limita las consultas
//! seguidas (429), así que se consulta cada pocos minutos con espera creciente.

use std::io::Read;
use std::path::PathBuf;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use serde_json::Value;

const USAGE_URL: &str = "https://api.anthropic.com/api/oauth/usage";
const RETRY_EVERY: Duration = Duration::from_secs(60);
const MAX_BACKOFF: Duration = Duration::from_secs(15 * 60);
/// Tiempo mínimo entre una consulta y la siguiente pedida a mano.
const MIN_MANUAL_GAP: Duration = Duration::from_secs(30);
/// La respuesta ocupa unos cientos de bytes; más que esto es un error.
const MAX_BODY: u64 = 64 * 1024;

#[derive(Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LimitWindow {
    /// Porcentaje usado, de 0 a 100.
    pub used: f64,
    pub resets_at: Option<String>,
}

#[derive(Clone, PartialEq, Serialize)]
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
    /// `None` si no se encontró la carpeta de Claude.
    credentials: Option<PathBuf>,
    /// `None` si no se pudo crear el cliente HTTP (por ejemplo, sin TLS).
    client: Option<reqwest::blocking::Client>,
    next: Instant,
    last_fetch: Option<Instant>,
    every: Duration,
    backoff: Duration,
    pub info: PlanInfo,
}

impl PlanFetcher {
    pub fn new(claude_dir: Option<PathBuf>) -> Self {
        // Sin redirecciones y solo HTTPS: el token nunca sale de api.anthropic.com.
        let client = reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(15))
            .user_agent("claupier/0.1")
            .redirect(reqwest::redirect::Policy::none())
            .https_only(true)
            .build()
            .ok();
        Self {
            credentials: claude_dir.map(|d| d.join(".credentials.json")),
            client,
            next: Instant::now(),
            last_fetch: None,
            every: Duration::from_secs(180),
            backoff: Duration::from_secs(180),
            info: PlanInfo::default(),
        }
    }

    /// Cada cuánto consultar cuando todo va bien.
    pub fn set_every(&mut self, every: Duration) {
        if every != self.every {
            self.every = every;
            self.backoff = self.backoff.max(every);
        }
    }

    /// Adelanta la próxima consulta (al pedir «Actualizar ahora»). Respeta la
    /// espera tras un 429 y deja al menos `MIN_MANUAL_GAP` desde la anterior.
    pub fn poke(&mut self) {
        if self.info.status == "rate_limited" {
            return;
        }
        let earliest = self.last_fetch.map_or_else(Instant::now, |t| t + MIN_MANUAL_GAP);
        self.next = self.next.min(earliest.max(Instant::now()));
    }

    /// Consulta el plan si ya toca.
    pub fn tick(&mut self) {
        if Instant::now() < self.next {
            return;
        }
        let wait = self.fetch();
        let now = Instant::now();
        self.last_fetch = Some(now);
        self.next = now + wait;
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

        let Some(client) = &self.client else {
            self.set_status("error");
            return RETRY_EVERY * 5;
        };
        let res = client
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
                // Nunca esperar menos que el sondeo normal, y respetar Retry-After.
                let retry_after = res
                    .headers()
                    .get(reqwest::header::RETRY_AFTER)
                    .and_then(|v| v.to_str().ok())
                    .and_then(|v| v.trim().parse::<u64>().ok())
                    .map(|s| Duration::from_secs(s.min(3600)))
                    .unwrap_or_default();
                self.backoff = (self.backoff * 2).min(MAX_BACKOFF.max(self.every)).max(retry_after);
                return self.backoff;
            }
            _ => {
                self.set_status("error");
                return RETRY_EVERY * 2;
            }
        }

        let mut bytes = Vec::new();
        let body = res
            .take(MAX_BODY)
            .read_to_end(&mut bytes)
            .ok()
            .and_then(|_| serde_json::from_slice::<Value>(&bytes).ok());
        let Some(body) = body else {
            self.set_status("error");
            return RETRY_EVERY * 2;
        };

        self.info.five_hour = parse_window(&body["five_hour"]);
        self.info.seven_day = parse_window(&body["seven_day"]);
        self.info.updated_at = Some(chrono::Utc::now().to_rfc3339());
        self.set_status("ok");
        self.backoff = self.every;
        self.every
    }

    fn read_credentials(&self) -> Option<(String, Option<i64>, Option<String>)> {
        let text = std::fs::read_to_string(self.credentials.as_ref()?).ok()?;
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
