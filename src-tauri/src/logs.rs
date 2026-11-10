//! Lee los registros locales de Claude Code (`~/.claude/projects/**/*.jsonl`)
//! y suma los tokens y el gasto equivalente del día.
//!
//! - Solo abre archivos modificados hoy y lee únicamente lo nuevo (guarda la
//!   posición de cada archivo), porque la carpeta puede pesar gigas.
//! - Claude Code escribe varias líneas por mensaje con el mismo `usage`, así que
//!   se agrupan por id de mensaje y petición, y se queda la más completa.

use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use chrono::{DateTime, Local, NaiveDate, TimeZone, Utc};
use serde::Serialize;
use serde_json::Value;

use crate::pricing::{self, Usage};

#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TodayTotals {
    pub date: String,
    pub cost_usd: f64,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cache_write_tokens: u64,
    pub cache_read_tokens: u64,
    pub total_tokens: u64,
    pub messages: u64,
}

struct Msg {
    model: String,
    usage: Usage,
}

pub struct LogScanner {
    root: PathBuf,
    day: NaiveDate,
    offsets: HashMap<PathBuf, u64>,
    msgs: HashMap<String, Msg>,
    pub totals: TodayTotals,
}

impl LogScanner {
    pub fn new(root: PathBuf) -> Self {
        let day = Local::now().date_naive();
        Self {
            root,
            day,
            offsets: HashMap::new(),
            msgs: HashMap::new(),
            totals: TodayTotals { date: day.to_string(), ..Default::default() },
        }
    }

    /// Devuelve `true` si cambiaron los totales.
    pub fn scan(&mut self) -> bool {
        let today = Local::now().date_naive();
        let mut changed = false;
        if today != self.day {
            self.day = today;
            self.offsets.clear();
            self.msgs.clear();
            changed = true;
        }

        let midnight = Local
            .from_local_datetime(&today.and_hms_opt(0, 0, 0).unwrap())
            .earliest()
            .map(SystemTime::from)
            .unwrap_or(SystemTime::UNIX_EPOCH);

        let mut files = Vec::new();
        collect_jsonl(&self.root, midnight, &mut files, 0);
        for path in files {
            if self.read_new_lines(&path) {
                changed = true;
            }
        }

        if changed {
            self.recompute();
        }
        changed
    }

    fn read_new_lines(&mut self, path: &Path) -> bool {
        let Ok(mut file) = File::open(path) else { return false };
        let len = file.metadata().map(|m| m.len()).unwrap_or(0);
        let mut offset = *self.offsets.get(path).unwrap_or(&0);
        if len < offset {
            offset = 0; // el archivo se truncó o se reemplazó
        }
        if len == offset {
            return false;
        }
        if file.seek(SeekFrom::Start(offset)).is_err() {
            return false;
        }
        let mut buf = Vec::with_capacity((len - offset) as usize);
        if file.read_to_end(&mut buf).is_err() {
            return false;
        }
        // Solo líneas completas: la última puede estar escribiéndose.
        let Some(last_nl) = buf.iter().rposition(|&b| b == b'\n') else { return false };
        let complete = &buf[..=last_nl];
        self.offsets.insert(path.to_path_buf(), offset + complete.len() as u64);

        let mut changed = false;
        for line in complete.split(|&b| b == b'\n') {
            if self.ingest(line) {
                changed = true;
            }
        }
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
        let Some(ts) = v["timestamp"].as_str() else { return false };
        let Ok(ts) = ts.parse::<DateTime<Utc>>() else { return false };
        if ts.with_timezone(&Local).date_naive() != self.day {
            return false;
        }

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
        let cw_total = n(&u["cache_creation_input_tokens"]);
        let detail = &u["cache_creation"];
        let (cw5, cw1h) = if detail.is_object() {
            (n(&detail["ephemeral_5m_input_tokens"]), n(&detail["ephemeral_1h_input_tokens"]))
        } else {
            (cw_total, 0)
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
                self.msgs.insert(key, Msg { model: model.to_string(), usage });
                true
            }
        }
    }

    fn recompute(&mut self) {
        let mut t = TodayTotals { date: self.day.to_string(), ..Default::default() };
        for m in self.msgs.values() {
            let u = &m.usage;
            t.cost_usd += pricing::cost_usd(&m.model, u);
            t.input_tokens += u.input;
            t.output_tokens += u.output;
            t.cache_write_tokens += u.cache_write_5m + u.cache_write_1h;
            t.cache_read_tokens += u.cache_read;
            t.messages += 1;
        }
        t.total_tokens = t.input_tokens + t.output_tokens + t.cache_write_tokens + t.cache_read_tokens;
        self.totals = t;
    }
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

    fn line(id: &str, output: u64) -> String {
        let ts = Utc::now().to_rfc3339();
        format!(
            r#"{{"type":"assistant","timestamp":"{ts}","requestId":"r1","message":{{"id":"{id}","model":"claude-opus-5-5","usage":{{"input_tokens":1000000,"output_tokens":{output},"cache_creation_input_tokens":0,"cache_read_input_tokens":0}}}}}}"#
        )
    }

    #[test]
    fn agrupa_lineas_repetidas_del_mismo_mensaje() {
        let mut s = LogScanner::new(PathBuf::from("."));
        assert!(s.ingest(line("m1", 10).as_bytes()));
        assert!(s.ingest(line("m1", 500).as_bytes()));
        assert!(!s.ingest(line("m1", 400).as_bytes()));
        assert!(s.ingest(line("m2", 0).as_bytes()));
        s.recompute();
        assert_eq!(s.totals.messages, 2);
        assert_eq!(s.totals.input_tokens, 2_000_000);
        assert_eq!(s.totals.output_tokens, 500);
        assert!((s.totals.cost_usd - (8.0 + 0.01)).abs() < 1e-9);
    }

    #[test]
    fn ignora_lineas_que_no_son_del_asistente() {
        let mut s = LogScanner::new(PathBuf::from("."));
        let l = line("m1", 10).replace("\"assistant\"", "\"user\"");
        assert!(!s.ingest(l.as_bytes()));
    }
}
