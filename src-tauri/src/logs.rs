//! Lee los registros locales de Claude Code (`~/.claude/projects/**/*.jsonl`)
//! y calcula los tokens y el gasto equivalente por periodo.
//!
//! - Guarda los mensajes de los últimos 8 días, que cubren la ventana semanal.
//! - Solo abre archivos modificados en ese rango y lee únicamente lo nuevo
//!   (guarda la posición de cada archivo), porque la carpeta puede pesar gigas.
//! - Lee línea a línea, sin cargar archivos enteros en memoria. Las líneas de
//!   más de `MAX_LINE` se saltan sin leerlas enteras.
//! - Descarta valores imposibles (tokens absurdos, fechas del futuro), para que
//!   una línea corrupta no rompa los totales ni la ventana.
//! - Claude Code escribe varias líneas por mensaje con el mismo `usage`, así que
//!   se agrupan por id de mensaje y petición, y se queda la más completa.

use std::collections::{HashMap, HashSet};
use std::fs::{self, File};
use std::io::{self, BufRead, BufReader, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use chrono::{DateTime, Local, TimeZone, Utc};
use serde::{Deserialize, Serialize};

use crate::pricing::{self, Usage};

const KEEP: Duration = Duration::from_secs(8 * 24 * 3600);
/// Las líneas reales pesan como mucho unos pocos MB (resultados de herramientas).
const MAX_LINE: u64 = 16 * 1024 * 1024;
/// Ningún mensaje real se acerca a esto en ningún contador de tokens.
const MAX_TOKENS: u64 = 100_000_000;

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

/// Hasta dónde se leyó un archivo.
#[derive(Clone, Copy, Default)]
struct FilePos {
    offset: u64,
    /// La última línea era demasiado larga y se está saltando hasta su fin.
    skipping: bool,
}

pub struct LogScanner {
    /// `None` si no se encontró la carpeta de Claude.
    root: Option<PathBuf>,
    files: HashMap<PathBuf, FilePos>,
    msgs: HashMap<String, Msg>,
}

// Solo los campos que se usan: serde salta el resto sin guardarlo en memoria.
#[derive(Deserialize)]
struct RawLine {
    #[serde(rename = "type")]
    kind: Option<String>,
    timestamp: Option<String>,
    #[serde(rename = "requestId")]
    request_id: Option<String>,
    uuid: Option<String>,
    message: Option<RawMessage>,
}

#[derive(Deserialize)]
struct RawMessage {
    id: Option<String>,
    model: Option<String>,
    usage: Option<RawUsage>,
}

#[derive(Deserialize)]
struct RawUsage {
    input_tokens: Option<u64>,
    output_tokens: Option<u64>,
    cache_creation_input_tokens: Option<u64>,
    cache_read_input_tokens: Option<u64>,
    cache_creation: Option<RawCacheCreation>,
    speed: Option<String>,
}

#[derive(Deserialize)]
struct RawCacheCreation {
    ephemeral_5m_input_tokens: Option<u64>,
    ephemeral_1h_input_tokens: Option<u64>,
}

impl LogScanner {
    pub fn new(root: Option<PathBuf>) -> Self {
        Self { root, files: HashMap::new(), msgs: HashMap::new() }
    }

    /// Lee lo nuevo de los registros. Devuelve `true` si entró algún mensaje.
    pub fn scan(&mut self) -> bool {
        let since = SystemTime::now() - KEEP;
        let mut files = Vec::new();
        if let Some(root) = &self.root {
            collect_jsonl(root, since, &mut files, 0);
        }
        // Olvidar los archivos que ya salieron del rango o se borraron.
        let seen: HashSet<&PathBuf> = files.iter().collect();
        self.files.retain(|p, _| seen.contains(p));
        let mut changed = false;
        for path in &files {
            changed |= self.read_new_lines(path);
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
            t.input_tokens = t.input_tokens.saturating_add(u.input);
            t.output_tokens = t.output_tokens.saturating_add(u.output);
            t.cache_write_tokens = t.cache_write_tokens.saturating_add(u.cache_write_5m + u.cache_write_1h);
            t.cache_read_tokens = t.cache_read_tokens.saturating_add(u.cache_read);
            t.messages += 1;
        }
        t.total_tokens = t
            .input_tokens
            .saturating_add(t.output_tokens)
            .saturating_add(t.cache_write_tokens)
            .saturating_add(t.cache_read_tokens);
        t
    }

    fn read_new_lines(&mut self, path: &Path) -> bool {
        let Ok(mut file) = File::open(path) else { return false };
        let len = file.metadata().map(|m| m.len()).unwrap_or(0);
        let mut pos = self.files.get(path).copied().unwrap_or_default();
        if len < pos.offset {
            pos = FilePos::default(); // el archivo se truncó o se reemplazó
        }
        if len == pos.offset || file.seek(SeekFrom::Start(pos.offset)).is_err() {
            self.files.insert(path.to_path_buf(), pos);
            return false;
        }

        let mut reader = BufReader::with_capacity(256 * 1024, file);
        let mut line = Vec::with_capacity(16 * 1024);
        let mut changed = false;
        loop {
            if pos.skipping {
                let Ok((skipped, found)) = skip_line(&mut reader) else { break };
                pos.offset += skipped;
                if !found {
                    break;
                }
                pos.skipping = false;
                continue;
            }
            line.clear();
            let Ok(read) = (&mut reader).take(MAX_LINE).read_until(b'\n', &mut line) else { break };
            if read == 0 {
                break;
            }
            if line.last() == Some(&b'\n') {
                pos.offset += read as u64;
                changed |= self.ingest(&line);
            } else if read as u64 >= MAX_LINE {
                // Línea gigante: se descarta lo leído y se salta el resto.
                pos.offset += read as u64;
                pos.skipping = true;
            } else {
                break; // última línea que aún se está escribiendo
            }
        }
        self.files.insert(path.to_path_buf(), pos);
        changed
    }

    fn ingest(&mut self, line: &[u8]) -> bool {
        // Filtro barato antes de parsear el JSON.
        if line.len() < 20 || !contains(line, b"\"usage\"") {
            return false;
        }
        let Ok(v) = serde_json::from_slice::<RawLine>(line) else { return false };
        if v.kind.as_deref() != Some("assistant") {
            return false;
        }
        let Some(at) = v.timestamp.as_deref().and_then(|s| s.parse::<DateTime<Utc>>().ok()) else {
            return false;
        };
        if at > Utc::now() + chrono::Duration::days(1) {
            return false; // fecha imposible: contaría en todos los periodos para siempre
        }

        let Some(msg) = v.message else { return false };
        let model = msg.model.unwrap_or_default();
        if model.is_empty() || model == "<synthetic>" {
            return false;
        }
        let Some(u) = msg.usage else { return false };

        let total_write = u.cache_creation_input_tokens.unwrap_or(0);
        let (cw5, cw1h) = match &u.cache_creation {
            Some(d) => {
                let (m5, h1) = (d.ephemeral_5m_input_tokens.unwrap_or(0), d.ephemeral_1h_input_tokens.unwrap_or(0));
                // Si el detalle viene vacío, vale el total (como si fuera de 5 min).
                if m5 == 0 && h1 == 0 { (total_write, 0) } else { (m5, h1) }
            }
            None => (total_write, 0),
        };
        let usage = Usage {
            input: u.input_tokens.unwrap_or(0),
            output: u.output_tokens.unwrap_or(0),
            cache_write_5m: cw5,
            cache_write_1h: cw1h,
            cache_read: u.cache_read_input_tokens.unwrap_or(0),
            fast: u.speed.as_deref() == Some("fast"),
        };
        let counters = [usage.input, usage.output, usage.cache_write_5m, usage.cache_write_1h, usage.cache_read];
        if counters.iter().any(|&n| n > MAX_TOKENS) {
            return false;
        }

        let id = msg.id.or(v.uuid).unwrap_or_default();
        let req = v.request_id.unwrap_or_default();
        // Sin ningún identificador, al menos no se mezclan mensajes distintos.
        let key = if id.is_empty() && req.is_empty() {
            format!("@{}:{model}", v.timestamp.unwrap_or_default())
        } else {
            format!("{id}:{req}")
        };

        match self.msgs.get(&key) {
            Some(old) if old.usage.output >= usage.output => false,
            _ => {
                self.msgs.insert(key, Msg { at, model, usage });
                true
            }
        }
    }
}

/// Inicio del día local de hoy, en UTC. Si la medianoche no existe (un cambio
/// de horario a las 00:00), se usa la primera hora válida del día.
pub fn start_of_today() -> DateTime<Utc> {
    let today = Local::now().date_naive();
    (0..4)
        .filter_map(|h| today.and_hms_opt(h, 0, 0))
        .find_map(|t| Local.from_local_datetime(&t).earliest())
        .map(|d| d.with_timezone(&Utc))
        .unwrap_or_else(Utc::now)
}

/// Salta hasta el fin de la línea actual. Devuelve los bytes saltados y si
/// encontró el salto de línea.
fn skip_line(reader: &mut impl BufRead) -> io::Result<(u64, bool)> {
    let mut skipped = 0u64;
    loop {
        let buf = reader.fill_buf()?;
        if buf.is_empty() {
            return Ok((skipped, false));
        }
        if let Some(i) = buf.iter().position(|&b| b == b'\n') {
            reader.consume(i + 1);
            return Ok((skipped + i as u64 + 1, true));
        }
        let n = buf.len();
        reader.consume(n);
        skipped += n as u64;
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
        let mut s = LogScanner::new(None);
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
        let mut s = LogScanner::new(None);
        let l = line("m1", 10).replace("\"assistant\"", "\"user\"");
        assert!(!s.ingest(l.as_bytes()));
    }

    #[test]
    fn cada_periodo_suma_solo_desde_su_inicio() {
        let mut s = LogScanner::new(None);
        let now = Utc::now();
        s.ingest(line_at("hace1h", 0, now - chrono::Duration::hours(1)).as_bytes());
        s.ingest(line_at("hace6h", 0, now - chrono::Duration::hours(6)).as_bytes());
        s.ingest(line_at("hace3d", 0, now - chrono::Duration::days(3)).as_bytes());
        assert_eq!(s.totals_since(now - chrono::Duration::hours(5)).messages, 1);
        assert_eq!(s.totals_since(now - chrono::Duration::days(1)).messages, 2);
        assert_eq!(s.totals_since(now - chrono::Duration::days(7)).messages, 3);
    }

    #[test]
    fn descarta_valores_imposibles_y_fechas_futuras() {
        let mut s = LogScanner::new(None);
        assert!(!s.ingest(line("m1", 1_000_000_000_000_000).as_bytes()), "tokens absurdos");
        let futuro = line_at("m2", 10, Utc::now() + chrono::Duration::days(30));
        assert!(!s.ingest(futuro.as_bytes()), "fecha del futuro");
        let con_nulos = line("m3", 10).replace("\"cache_read_input_tokens\":0", "\"cache_read_input_tokens\":null");
        assert!(s.ingest(con_nulos.as_bytes()), "un contador nulo cuenta como 0");
    }

    #[test]
    fn salta_lineas_gigantes_sin_perder_las_siguientes() {
        let nanos = SystemTime::now().duration_since(SystemTime::UNIX_EPOCH).unwrap().as_nanos();
        let dir = std::env::temp_dir().join(format!("claupier-test-big-{}-{nanos}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let file = dir.join("s.jsonl");
        let giant = "x".repeat(MAX_LINE as usize + 10);
        fs::write(&file, format!("{giant}\n{}\n", line("m1", 5))).unwrap();
        let mut s = LogScanner::new(Some(dir.clone()));
        assert!(s.scan());
        assert_eq!(s.totals_since(Utc::now() - chrono::Duration::hours(1)).messages, 1);
        fs::remove_dir_all(&dir).ok();
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

        let mut s = LogScanner::new(Some(dir.clone()));
        assert!(s.scan());
        assert_eq!(s.totals_since(Utc::now() - chrono::Duration::hours(1)).messages, 1);

        fs::write(&file, format!("{first}\n{partial}\n")).unwrap();
        assert!(s.scan());
        assert_eq!(s.totals_since(Utc::now() - chrono::Duration::hours(1)).messages, 2);
        assert!(!s.scan(), "sin cambios no hay nada nuevo");
        fs::remove_dir_all(&dir).ok();
    }
}
