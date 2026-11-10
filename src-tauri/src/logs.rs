//! Lee los registros locales de Claude Code (`~/.claude/projects/**/*.jsonl`)
//! y calcula los tokens y el gasto equivalente por periodo.
//!
//! - Guarda los mensajes de los últimos 8 días, que cubren la ventana semanal.
//! - Solo abre archivos modificados en ese rango y lee únicamente lo nuevo
//!   (guarda la posición de cada archivo), porque la carpeta puede pesar gigas.
//! - Lee línea a línea, sin cargar archivos enteros en memoria.
//! - Claude Code escribe varias líneas por mensaje con el mismo `usage`, así que
//!   se agrupan por id de mensaje y petición, y se queda la más completa.

use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{BufRead, BufReader, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use chrono::{DateTime, Local, TimeZone, Utc};
use serde::Serialize;
use serde_json::Value;

use crate::pricing::{self, Usage};

const KEEP: Duration = Duration::from_secs(8 * 24 * 3600);

#[derive(Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Totals {
    /// Desde cuándo se cuenta (ISO 8601).
    pub since: String,
    pub cost_usd: f64,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cache_write_tokens: u64,
    pub cache_read_tokens: u64,
    pub total_tokens: u64,
    pub messages: u64,
}

struct Msg {
    at: DateTime<Utc>,
    model: String,
    usage: Usage,
}

pub struct LogScanner {
    root: PathBuf,
    offsets: HashMap<PathBuf, u64>,
    msgs: HashMap<String, Msg>,
}

impl LogScanner {
    pub fn new(root: PathBuf) -> Self {
        Self { root, offsets: HashMap::new(), msgs: HashMap::new() }
    }

    /// Lee lo nuevo de los registros. Devuelve `true` si entró algún mensaje.
    pub fn scan(&mut self) -> bool {
        let since = SystemTime::now() - KEEP;
        let mut files = Vec::new();
        collect_jsonl(&self.root, since, &mut files, 0);
        let mut changed = false;
        for path in files {
            changed |= self.read_new_lines(&path);
        }

        let cutoff = Utc::now() - chrono::Duration::from_std(KEEP).unwrap();
        let before = self.msgs.len();
        self.msgs.retain(|_, m| m.at >= cutoff);
        changed || before != self.msgs.len()
    }

    /// Suma lo gastado desde `since`.
    pub fn totals_since(&self, since: DateTime<Utc>) -> Totals {
        let mut t = Totals { since: since.to_rfc3339(), ..Default::default() };
        for m in self.msgs.values().filter(|m| m.at >= since) {
            let u = &m.usage;
            t.cost_usd += pricing::cost_usd(&m.model, u);
            t.input_tokens += u.input;
            t.output_tokens += u.output;
            t.cache_write_tokens += u.cache_write_5m + u.cache_write_1h;
            t.cache_read_tokens += u.cache_read;
            t.messages += 1;
        }
        t.total_tokens = t.input_tokens + t.output_tokens + t.cache_write_tokens + t.cache_read_tokens;
        t
    }

    fn read_new_lines(&mut self, path: &Path) -> bool {
        let Ok(mut file) = File::open(path) else { return false };
        let len = file.metadata().map(|m| m.len()).unwrap_or(0);
        let mut offset = *self.offsets.get(path).unwrap_or(&0);
        if len < offset {
            offset = 0; // el archivo se truncó o se reemplazó
        }
        if len == offset || file.seek(SeekFrom::Start(offset)).is_err() {
            return false;
        }

        let mut reader = BufReader::with_capacity(256 * 1024, file);
        let mut line = Vec::with_capacity(16 * 1024);
        let mut changed = false;
        loop {
            line.clear();
            let Ok(read) = reader.read_until(b'\n', &mut line) else { break };
            // Fin del archivo, o una última línea que aún se está escribiendo.
            if read == 0 || line.last() != Some(&b'\n') {
                break;
            }
            offset += read as u64;
            changed |= self.ingest(&line);
        }
        self.offsets.insert(path.to_path_buf(), offset);
        changed
    }

    fn ingest(&mut self, line: &[u8]) -> bool {
        // Filtro barato antes de parsear el JSON.
        if line.len() < 20 || !contains(line, b"\"usage\"") {
            return false;
        }
        let Ok(v) = serde_json::from_slice::<Value>(line) else { return false };
        if v["type"] != "assistant" {
            return false;
        }
        let Some(at) = v["timestamp"].as_str().and_then(|s| s.parse::<DateTime<Utc>>().ok()) else {
            return false;
        };

        let msg = &v["message"];
        let model = msg["model"].as_str().unwrap_or("");
        if model.is_empty() || model == "<synthetic>" {
            return false;
        }
        let u = &msg["usage"];
        if !u.is_object() {
            return false;
        }

        let n = |val: &Value| val.as_u64().unwrap_or(0);
        let detail = &u["cache_creation"];
        let (cw5, cw1h) = if detail.is_object() {
            (n(&detail["ephemeral_5m_input_tokens"]), n(&detail["ephemeral_1h_input_tokens"]))
        } else {
            (n(&u["cache_creation_input_tokens"]), 0)
        };
        let usage = Usage {
            input: n(&u["input_tokens"]),
            output: n(&u["output_tokens"]),
            cache_write_5m: cw5,
            cache_write_1h: cw1h,
            cache_read: n(&u["cache_read_input_tokens"]),
            fast: u["speed"] == "fast",
        };

        let id = msg["id"].as_str().or_else(|| v["uuid"].as_str()).unwrap_or("");
        let req = v["requestId"].as_str().unwrap_or("");
        let key = format!("{id}:{req}");

        match self.msgs.get(&key) {
            Some(old) if old.usage.output >= usage.output => false,
            _ => {
                self.msgs.insert(key, Msg { at, model: model.to_string(), usage });
                true
            }
        }
    }
}

/// Medianoche local de hoy, en UTC.
pub fn start_of_today() -> DateTime<Utc> {
    let today = Local::now().date_naive();
    Local
        .from_local_datetime(&today.and_hms_opt(0, 0, 0).unwrap())
        .earliest()
        .map(|d| d.with_timezone(&Utc))
        .unwrap_or_else(Utc::now)
}

fn collect_jsonl(dir: &Path, since: SystemTime, out: &mut Vec<PathBuf>, depth: u8) {
    if depth > 6 {
        return;
    }
    let Ok(entries) = fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let Ok(meta) = entry.metadata() else { continue };
        let path = entry.path();
        if meta.is_dir() {
            collect_jsonl(&path, since, out, depth + 1);
        } else if path.extension().is_some_and(|e| e == "jsonl")
            && meta.modified().map(|m| m >= since).unwrap_or(false)
        {
            out.push(path);
        }
    }
}

fn contains(haystack: &[u8], needle: &[u8]) -> bool {
    haystack.windows(needle.len()).any(|w| w == needle)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn line_at(id: &str, output: u64, at: DateTime<Utc>) -> String {
        let ts = at.to_rfc3339();
        format!(
            r#"{{"type":"assistant","timestamp":"{ts}","requestId":"r1","message":{{"id":"{id}","model":"claude-opus-5-5","usage":{{"input_tokens":1000000,"output_tokens":{output},"cache_creation_input_tokens":0,"cache_read_input_tokens":0}}}}}}"#
        )
    }

    fn line(id: &str, output: u64) -> String {
        line_at(id, output, Utc::now())
    }

    #[test]
    fn agrupa_lineas_repetidas_del_mismo_mensaje() {
        let mut s = LogScanner::new(PathBuf::from("."));
        assert!(s.ingest(line("m1", 10).as_bytes()));
        assert!(s.ingest(line("m1", 500).as_bytes()));
        assert!(!s.ingest(line("m1", 400).as_bytes()));
        assert!(s.ingest(line("m2", 0).as_bytes()));
        let t = s.totals_since(Utc::now() - chrono::Duration::hours(1));
        assert_eq!(t.messages, 2);
        assert_eq!(t.input_tokens, 2_000_000);
        assert_eq!(t.output_tokens, 500);
        assert!((t.cost_usd - 8.01).abs() < 1e-9);
    }

    #[test]
    fn ignora_lineas_que_no_son_del_asistente() {
        let mut s = LogScanner::new(PathBuf::from("."));
        let l = line("m1", 10).replace("\"assistant\"", "\"user\"");
        assert!(!s.ingest(l.as_bytes()));
    }

    #[test]
    fn cada_periodo_suma_solo_desde_su_inicio() {
        let mut s = LogScanner::new(PathBuf::from("."));
        let now = Utc::now();
        s.ingest(line_at("hace1h", 0, now - chrono::Duration::hours(1)).as_bytes());
        s.ingest(line_at("hace6h", 0, now - chrono::Duration::hours(6)).as_bytes());
        s.ingest(line_at("hace3d", 0, now - chrono::Duration::days(3)).as_bytes());
        assert_eq!(s.totals_since(now - chrono::Duration::hours(5)).messages, 1);
        assert_eq!(s.totals_since(now - chrono::Duration::days(1)).messages, 2);
        assert_eq!(s.totals_since(now - chrono::Duration::days(7)).messages, 3);
    }

    #[test]
    fn lee_solo_lineas_completas_y_continua_donde_quedo() {
        // Carpeta única por corrida: el número de proceso se reutiliza en Windows.
        let nanos = SystemTime::now().duration_since(SystemTime::UNIX_EPOCH).unwrap().as_nanos();
        let dir = std::env::temp_dir().join(format!("claupier-test-{}-{nanos}", std::process::id()));
        fs::remove_dir_all(&dir).ok();
        fs::create_dir_all(&dir).unwrap();
        let file = dir.join("s.jsonl");
        // La segunda línea queda a medias, como si Claude Code la estuviera escribiendo.
        // La primera se genera una sola vez: Claude Code solo añade al final, así
        // que la parte ya leída del archivo nunca cambia.
        let first = line("m1", 5);
        let partial = line("m2", 7);
        fs::write(&file, format!("{first}\n{}", &partial[..40])).unwrap();

        let mut s = LogScanner::new(dir.clone());
        assert!(s.scan());
        assert_eq!(s.totals_since(Utc::now() - chrono::Duration::hours(1)).messages, 1);

        fs::write(&file, format!("{first}\n{partial}\n")).unwrap();
        assert!(s.scan());
        assert_eq!(s.totals_since(Utc::now() - chrono::Duration::hours(1)).messages, 2);
        assert!(!s.scan(), "sin cambios no hay nada nuevo");
        fs::remove_dir_all(&dir).ok();
    }
}
