# Claupier

Mesa de casino en pixel art que muestra el uso de Claude. Es una ventana pequeña que se queda siempre encima de las demás y se puede mostrar u ocultar con una tecla, por ejemplo para jugar mientras trabajas.

## Atajos

| Atajo | Qué hace |
|---|---|
| `Ctrl+Alt+F` | Muestra u oculta la mesa. Aparece sin quitarle el foco al juego |
| `Ctrl+Alt+G` | Modo fantasma: los clics atraviesan la mesa y llegan a lo que está detrás |
| Arrastrar | Mueve la mesa a otro lugar. La posición se recuerda |
| Doble clic | Actualiza el plan en ese momento |

Desde el ícono de la bandeja también se puede mostrar u ocultar, activar el modo fantasma, actualizar y salir.

## Qué muestra

- **Banca**: las fichas azules son lo que **te queda** del plan. Cada ficha equivale al 10 %. Hay una pila para la ventana de 5 horas y otra para la semana, cada una con el tiempo que falta para el reinicio.
- **Hoy**: el gasto del día convertido en fichas de casino:

| Ficha | Valor |
|---|---|
| Blanca | $1 |
| Roja | $5 |
| Verde | $25 |
| Negra | $100 |
| **Naranja** | **$500** |

  Si una pila supera las 8 fichas, encima aparece cuántas faltan por dibujar (`+4`).
- **Abajo**: el gasto en dólares y los tokens del día.
- **Luz de estado**: verde si todo va bien, ámbar si Anthropic pidió esperar y roja si la sesión caducó o no hay conexión. Si la sesión caducó, basta con abrir Claude Code para que se renueve sola.

El gasto es **equivalente**: es lo que costarían esos tokens con los precios de la API. Con un plan Pro o Max no se paga por token, así que el número sirve para ver cuánto le sacas al plan.

## De dónde salen los datos

1. **El plan**: se consulta el mismo servicio que usa `/usage` de Claude Code, con el token que Claude Code guarda en `~/.claude/.credentials.json`. El token se envía solo a `api.anthropic.com` y nunca se registra. Ese servicio no está documentado oficialmente, así que se consulta cada 2,5 minutos y, si responde 429, se espera cada vez más (hasta 15 minutos).
2. **Los tokens y el gasto**: se leen de los registros locales de Claude Code (`~/.claude/projects/**/*.jsonl`). Solo se abren los archivos modificados hoy y solo se lee lo que se añadió desde la última vez.

Los precios están en `src-tauri/src/pricing.rs`.

## Desarrollo

Necesita Node 24, Rust (MSVC) y WebView2.

```
npm install
npm run tauri dev                       # la app con datos reales
npm run dev                             # solo la mesa en el navegador, con datos simulados
npm run tauri build -- --no-bundle      # ejecutable en src-tauri/target/release/claupier.exe
cd src-tauri && cargo test              # pruebas de precios y lectura de registros
```

Parámetros del modo navegador: `?still` (sin simulación), `?cost=1873.5`, `?used=93`, `?ghost` y `?status=expired`.

## Limitación conocida

Los juegos en **pantalla completa exclusiva** pueden tapar la mesa. En **pantalla completa sin bordes** se ve bien.
