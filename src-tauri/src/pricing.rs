//! Precios por millón de tokens (USD) de la API de Anthropic, para calcular
//! el gasto *equivalente*: en un plan Pro/Max ese dinero no se paga de verdad.
//!
//! Fuente: skill claude-api (tabla de modelos, cacheada el 2026-11-03).
//! Escritura de caché: 1,25× la entrada (5 min) y 2× (1 h).
//! Lectura de caché: varía por modelo.

pub struct Rates {
    pub input: f64,
    pub output: f64,
    pub cache_read: f64,
}

const fn r(input: f64, output: f64, cache_read: f64) -> Rates {
    Rates { input, output, cache_read }
}

/// El orden importa: los nombres más específicos van primero
/// ("opus-5-5" antes que "opus-5").
const TABLE: &[(&str, Rates)] = &[
    ("fable-5-2", r(8.0, 40.0, 0.20)),
    ("mythos-5-2", r(8.0, 40.0, 0.20)),
    ("fable-5-1", r(10.0, 50.0, 0.25)),
    ("mythos-5-1", r(10.0, 50.0, 0.25)),
    ("fable-5", r(10.0, 50.0, 1.00)),
    ("mythos-5", r(10.0, 50.0, 1.00)),
    ("opus-5-5", r(4.0, 20.0, 0.20)),
    ("opus-5", r(5.0, 25.0, 0.50)),
    ("opus-4-8", r(5.0, 25.0, 0.50)),
    ("opus-4-7", r(5.0, 25.0, 0.50)),
    ("opus-4-6", r(5.0, 25.0, 0.50)),
    ("opus-4-5", r(5.0, 25.0, 0.50)),
    ("opus-4", r(15.0, 75.0, 1.50)),
    ("sonnet-5-5", r(2.0, 10.0, 0.10)),
    ("sonnet-5", r(2.0, 10.0, 0.20)),
    ("sonnet-4", r(3.0, 15.0, 0.30)),
    ("sonnet-3", r(3.0, 15.0, 0.30)),
    ("haiku-5-5", r(0.10, 0.50, 0.01)),
    ("haiku-4-5", r(1.0, 5.0, 0.10)),
    ("haiku-3-5", r(0.80, 4.0, 0.08)),
];

/// Si aparece un modelo desconocido se cobra como Opus 5.5 (el modelo por defecto).
const FALLBACK: Rates = r(4.0, 20.0, 0.20);

pub struct Usage {
    pub input: u64,
    pub output: u64,
    pub cache_write_5m: u64,
    pub cache_write_1h: u64,
    pub cache_read: u64,
    pub fast: bool,
}

pub fn cost_usd(model: &str, u: &Usage) -> f64 {
    let rates = TABLE
        .iter()
        .find(|(key, _)| model.contains(key))
        .map(|(_, rates)| rates)
        .unwrap_or(&FALLBACK);

    // Haiku 5.5 sube de precio con prompts de más de 100K tokens.
    let prompt = u.input + u.cache_write_5m + u.cache_write_1h + u.cache_read;
    let big_haiku = model.contains("haiku-5-5") && prompt > 100_000;
    let (input, output, cache_read) = if big_haiku {
        (0.50, 2.50, 0.05)
    } else {
        (rates.input, rates.output, rates.cache_read)
    };

    let m = 1_000_000.0;
    let mut cost = u.input as f64 * input / m
        + u.output as f64 * output / m
        + u.cache_write_5m as f64 * input * 1.25 / m
        + u.cache_write_1h as f64 * input * 2.0 / m
        + u.cache_read as f64 * cache_read / m;

    // El modo rápido cuesta el doble.
    if u.fast {
        cost *= 2.0;
    }
    cost
}

#[cfg(test)]
mod tests {
    use super::*;

    fn usage(input: u64, output: u64) -> Usage {
        Usage { input, output, cache_write_5m: 0, cache_write_1h: 0, cache_read: 0, fast: false }
    }

    #[test]
    fn opus_55_no_se_confunde_con_opus_5() {
        let c = cost_usd("claude-opus-5-5", &usage(1_000_000, 1_000_000));
        assert!((c - 24.0).abs() < 1e-9);
        let c = cost_usd("claude-opus-5", &usage(1_000_000, 1_000_000));
        assert!((c - 30.0).abs() < 1e-9);
    }

    #[test]
    fn cache_y_modo_rapido() {
        let u = Usage {
            input: 0,
            output: 0,
            cache_write_5m: 1_000_000,
            cache_write_1h: 1_000_000,
            cache_read: 1_000_000,
            fast: true,
        };
        // (4*1.25 + 4*2 + 0.20) * 2
        let c = cost_usd("claude-opus-5-5", &u);
        assert!((c - 26.4).abs() < 1e-9);
    }

    #[test]
    fn haiku_grande() {
        let c = cost_usd("claude-haiku-5-5", &usage(200_000, 0));
        assert!((c - 0.10).abs() < 1e-9);
    }
}
