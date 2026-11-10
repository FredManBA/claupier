# Claupier

Muestra el uso de Claude en pixel art, con temática de casino. Es una ventana pequeña que se queda encima de las demás y se muestra u oculta con una tecla, por ejemplo para jugar mientras trabajas.

## Diseños

Se eligen en **Ajustes → Diseño**, que tiene vista previa animada.

| Diseño | Qué muestra |
|---|---|
| **Mesa** (el crupier) | Las bombillas de la marquesina son lo que te queda de la semana; la lámpara es el estado. En el **pozo** está el gasto en fichas. Abajo está **tu banca** de 5 h; cuando baja, el rastrillo del crupier se lleva tus fichas al pozo |
| **Píldora** | Una sola fila mínima para dejar encima de un juego: banca de 5 h, semana y dinero |
| **Tragamonedas** | Tres rodillos (5 h, semana y dinero) que giran al cambiar, la palanca baja y en la bandeja caen las fichas |
| **Pachinko** | La tolva guarda lo que te queda de las 5 h. Las bolas caen entre los clavos hasta la casilla de su ficha. El tubo de la derecha es la semana |

Las fichas son las mismas en todos los diseños:

| Ficha | Valor |
|---|---|
| Blanca | $1 |
| Roja | $5 |
| Verde | $25 |
| Negra | $100 |
| **Naranja** | **$500** |

El dinero es **equivalente**: es lo que costarían esos tokens con los precios de la API. Con un plan Pro o Max no se paga por token. Las fichas siempre valen dólares, aunque el monto se muestre en colones.

## Atajos y ratón

| Acción | Qué hace |
|---|---|
| `Ctrl+Alt+F` | Muestra u oculta la mesa sin quitarle el foco al juego |
| `Ctrl+Alt+G` | Modo fantasma: los clics atraviesan la mesa |
| Arrastrar | Mueve la mesa (si estaba anclada a una esquina, pasa a posición libre) |
| Doble clic | Actualiza el plan en ese momento |
| Clic derecho | Abre los ajustes |

Los atajos se cambian en **Ajustes → Atajos**. La bandeja también tiene todas estas opciones.

## Ajustes

- **Ventana:** tamaño 2×, 3× o 4×; opacidad; anclar a una esquina; siempre encima; animación completa, reducida o apagada.
- **Inicio:** arrancar con Windows, empezar oculta y empezar en modo fantasma.
- **Avisos:** notificaciones de Windows cuando la banca de 5 h o la semanal bajan del % que elijas, cuando se pasa un tope de gasto o cuando caduca la sesión. Cada aviso suena una sola vez por ventana o periodo.
- **Datos:** la banca muestra lo que queda o lo usado; el gasto puede ser de hoy, de la ventana de 5 h o de la semana; cada cuánto se consulta el plan (mínimo 2 min); dólares o colones con un tipo de cambio que escribes tú.
- **Sonido:** sonido de moneda sintetizado, sin archivos ni agudos y apagado por defecto. Se puede silenciar solo durante el juego (una app en pantalla completa o Windows en No molestar).

Los ajustes se guardan en `%APPDATA%\com.needyfriends.claupier\settings.json`.

## De dónde salen los datos

1. **El plan:** se consulta el mismo servicio que usa `/usage` de Claude Code, con el token que Claude Code guarda en `~/.claude/.credentials.json`. El token se envía solo a `api.anthropic.com` y nunca se registra. Ese servicio no está documentado oficialmente; si responde 429, se espera cada vez más (hasta 15 minutos).
2. **Los tokens y el gasto:** se leen de los registros locales de Claude Code (`~/.claude/projects/**/*.jsonl`) de los últimos 8 días. Solo se lee lo que se añadió desde la última vez.

Los precios están en `src-tauri/src/pricing.rs`.

## Desarrollo

Necesita Node 24, Rust (MSVC) y WebView2.

```
npm install
npm run tauri dev                       # la app con datos reales
npm run dev                             # en el navegador, con datos simulados
npm run tauri build -- --no-bundle      # ejecutable en src-tauri/target/release/claupier.exe
cd src-tauri && cargo test              # pruebas de ajustes, avisos, precios y registros
```

En el navegador, `/` es la mesa y `/settings.html` son los ajustes. Parámetros: `?design=pildora|tragamonedas|pachinko`, `?still` (sin simulación), `?cost=1873.5`, `?used=93`, `?period=week`, `?currency=CRC`, `?bank=used`, `?ghost` y `?status=expired`.

Estructura:

- `src-tauri/src/`: ajustes, registros, plan, avisos, silencio en juego y precios.
- `src/core/`: fuente pixel, fichas, pilas, formatos, sonido, puente con Tauri y vista.
- `src/designs/`: un archivo por diseño, todos con la misma interfaz (`design.ts`).
- `src/settings/`: la ventana de ajustes.

## Limitación conocida

Los juegos en **pantalla completa exclusiva** pueden tapar la mesa. En **pantalla completa sin bordes** se ve bien.
