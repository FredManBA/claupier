mod alerts;
mod logs;
mod plan;
mod pricing;
mod quiet;
mod settings;

use std::path::PathBuf;
use std::sync::mpsc::{self, RecvTimeoutError, Sender};
use std::sync::Mutex;
use std::time::Duration;

use chrono::{DateTime, DurationRound, Utc};
use serde::Serialize;
use settings::Settings;
use tauri::menu::{CheckMenuItem, CheckMenuItemBuilder, MenuBuilder, MenuItem, MenuItemBuilder};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WindowEvent, Wry};
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_window_state::{AppHandleExt, StateFlags};

const LOOP_EVERY: Duration = Duration::from_secs(5);
const MAIN: &str = "main";
const SETTINGS: &str = "ajustes";
/// Lado máximo de la mesa en píxeles físicos (el diseño más alto, a 4× y con la
/// pantalla al 300 %, mide menos de 2000).
const MAX_SIDE: u32 = 4096;

#[derive(Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    plan: plan::PlanInfo,
    today: logs::Totals,
    window5h: logs::Totals,
    week: logs::Totals,
    ghost: bool,
    /// Hay un juego en pantalla completa o Windows está en No molestar.
    quiet: bool,
}

struct AppState {
    snap: Mutex<Snapshot>,
    settings: Mutex<Settings>,
    settings_path: Mutex<PathBuf>,
    keys: Mutex<Option<(Shortcut, Shortcut)>>,
    hotkeys_paused: Mutex<bool>,
    refresh: Mutex<Option<Sender<()>>>,
    toggle_item: Mutex<Option<MenuItem<Wry>>>,
    ghost_item: Mutex<Option<CheckMenuItem<Wry>>>,
}

// ── Comandos ──────────────────────────────────────────────────────────────

#[tauri::command]
fn get_snapshot(state: tauri::State<AppState>) -> Snapshot {
    state.snap.lock().unwrap().clone()
}

#[tauri::command]
fn refresh_now(state: tauri::State<AppState>) {
    if let Some(tx) = state.refresh.lock().unwrap().as_ref() {
        let _ = tx.send(());
    }
}

#[tauri::command]
fn get_settings(state: tauri::State<AppState>) -> Settings {
    state.settings.lock().unwrap().clone()
}

#[tauri::command]
fn update_settings(app: AppHandle, patch: serde_json::Value) -> Result<Settings, String> {
    let state = app.state::<AppState>();
    let current = state.settings.lock().unwrap().clone();
    let next = current.merged(&patch)?;
    let path = state.settings_path.lock().unwrap().clone();
    // Si algo falla (un atajo ocupado, el disco), se deshace lo ya aplicado
    // para que lo activo, lo guardado y lo que muestra la ventana coincidan.
    if let Err(e) = apply_settings(&app, Some(&current), &next).and_then(|_| next.save(&path)) {
        let _ = apply_settings(&app, Some(&next), &current);
        return Err(e);
    }
    *state.settings.lock().unwrap() = next.clone();
    let _ = app.emit("settings", next.clone());
    Ok(next)
}

#[tauri::command]
fn open_settings(app: AppHandle) {
    if let Some(w) = app.get_webview_window(SETTINGS) {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

/// La ventana principal pide su tamaño exacto en píxeles físicos (depende
/// del diseño y la escala) y se reubica si está anclada a una esquina.
#[tauri::command]
fn fit_window(app: AppHandle, width: u32, height: u32) {
    if let Some(w) = app.get_webview_window(MAIN) {
        let size = PhysicalSize::new(width.clamp(16, MAX_SIDE), height.clamp(16, MAX_SIDE));
        let _ = w.set_size(size);
        let anchor = app.state::<AppState>().settings.lock().unwrap().anchor.clone();
        place_main(&app, &anchor, size);
    }
}

/// Mientras se captura un atajo nuevo, los actuales no deben dispararse.
#[tauri::command]
fn set_hotkeys_paused(state: tauri::State<AppState>, paused: bool) {
    *state.hotkeys_paused.lock().unwrap() = paused;
}

#[tauri::command]
fn test_alert(app: AppHandle) -> Result<(), String> {
    notify(&app, "Así se verán los avisos de Claupier", "Este es un aviso de prueba.")
}

// ── Ventana y estado ──────────────────────────────────────────────────────

fn emit_snapshot(app: &AppHandle) {
    let snap = app.state::<AppState>().snap.lock().unwrap().clone();
    let _ = app.emit("snapshot", snap);
}

fn toggle_visible(app: &AppHandle) {
    let Some(w) = app.get_webview_window(MAIN) else { return };
    if w.is_visible().unwrap_or(false) {
        let _ = w.hide();
    } else {
        // La ventana no es enfocable: aparece sin quitarle el foco al juego.
        let _ = w.show();
        let on_top = app.state::<AppState>().settings.lock().unwrap().always_on_top;
        let _ = w.set_always_on_top(on_top);
    }
}

fn set_ghost(app: &AppHandle, on: bool) {
    if let Some(w) = app.get_webview_window(MAIN) {
        let _ = w.set_ignore_cursor_events(on);
    }
    let state = app.state::<AppState>();
    state.snap.lock().unwrap().ghost = on;
    if let Some(item) = state.ghost_item.lock().unwrap().as_ref() {
        let _ = item.set_checked(on);
    }
    emit_snapshot(app);
}

fn toggle_ghost(app: &AppHandle) {
    let on = !app.state::<AppState>().snap.lock().unwrap().ghost;
    set_ghost(app, on);
}

fn place_main(app: &AppHandle, anchor: &str, size: PhysicalSize<u32>) {
    if anchor == "free" {
        return;
    }
    let Some(w) = app.get_webview_window(MAIN) else { return };
    let monitor = w.current_monitor().ok().flatten().or_else(|| w.primary_monitor().ok().flatten());
    let Some(monitor) = monitor else { return };
    let area = monitor.work_area();
    let margin = (16.0 * monitor.scale_factor()).round() as i32;
    let px = |v: u32| i32::try_from(v).unwrap_or(i32::MAX);
    let (x0, y0) = (area.position.x, area.position.y);
    let left = x0.saturating_add(margin);
    let right = x0.saturating_add(px(area.size.width)).saturating_sub(px(size.width)).saturating_sub(margin);
    let top = y0.saturating_add(margin);
    let bottom = y0.saturating_add(px(area.size.height)).saturating_sub(px(size.height)).saturating_sub(margin);
    let (x, y) = match anchor {
        "top-left" => (left, top),
        "top-right" => (right, top),
        "bottom-left" => (left, bottom),
        _ => (right, bottom),
    };
    let _ = w.set_position(PhysicalPosition::new(x, y));
}

fn hotkey_label(text: &str, key: &str) -> String {
    format!("{text}   {key}")
}

/// Registra los atajos nuevos.
///
/// - Al cambiarlos desde los ajustes (`strict`), es todo o nada: si uno falla
///   se vuelve a los anteriores para no quedarse sin atajos.
/// - Al arrancar, cada atajo va por separado: si otra app ocupa uno, el otro
///   sigue funcionando.
fn apply_hotkeys(app: &AppHandle, new: &Settings, strict: bool) -> Result<(), String> {
    let state = app.state::<AppState>();
    let toggle = settings::parse_hotkey(&new.hotkey_toggle)?;
    let ghost = settings::parse_hotkey(&new.hotkey_ghost)?;
    let gs = app.global_shortcut();
    let _ = gs.unregister_all();
    let mut taken = Vec::new();
    for (key, text) in [(toggle, &new.hotkey_toggle), (ghost, &new.hotkey_ghost)] {
        if gs.register(key).is_err() {
            taken.push(text.as_str());
            if strict {
                break;
            }
        }
    }
    if strict && !taken.is_empty() {
        let _ = gs.unregister_all();
        if let Some((t, g)) = *state.keys.lock().unwrap() {
            let _ = gs.register(t);
            let _ = gs.register(g);
        }
        return Err(format!("El atajo {} ya lo usa otra aplicación.", taken.join(" y ")));
    }
    *state.keys.lock().unwrap() = Some((toggle, ghost));
    if let Some(item) = state.toggle_item.lock().unwrap().as_ref() {
        let _ = item.set_text(hotkey_label("Mostrar u ocultar", &new.hotkey_toggle));
    }
    if let Some(item) = state.ghost_item.lock().unwrap().as_ref() {
        let _ = item.set_text(hotkey_label("Modo fantasma", &new.hotkey_ghost));
    }
    if taken.is_empty() {
        Ok(())
    } else {
        Err(format!("El atajo {} ya lo usa otra aplicación; cámbialo en los ajustes.", taken.join(" y ")))
    }
}

fn apply_autostart(app: &AppHandle, on: bool) -> Result<(), String> {
    let auto = app.autolaunch();
    let enabled = auto.is_enabled().unwrap_or(false);
    if on && !enabled {
        auto.enable().map_err(|e| format!("No pude activar el arranque con Windows: {e}"))?;
    } else if !on && enabled {
        auto.disable().map_err(|e| format!("No pude quitar el arranque con Windows: {e}"))?;
    }
    Ok(())
}

/// Aplica los efectos de los ajustes.
///
/// - Con `old = None` (arranque) aplica todo y no se detiene ante un error:
///   los junta y los devuelve al final.
/// - Con `old`, solo lo que cambió, y se detiene en el primer error.
fn apply_settings(app: &AppHandle, old: Option<&Settings>, new: &Settings) -> Result<(), String> {
    let startup = old.is_none();
    let mut errors = Vec::new();
    let mut step = |result: Result<(), String>| -> Result<(), String> {
        match result {
            Err(e) if startup => {
                errors.push(e);
                Ok(())
            }
            other => other,
        }
    };

    if old.is_none_or(|o| o.hotkey_toggle != new.hotkey_toggle || o.hotkey_ghost != new.hotkey_ghost) {
        step(apply_hotkeys(app, new, !startup))?;
    }
    if old.is_none_or(|o| o.autostart != new.autostart) {
        step(apply_autostart(app, new.autostart))?;
    }
    if let Some(w) = app.get_webview_window(MAIN) {
        if old.is_none_or(|o| o.always_on_top != new.always_on_top) {
            let _ = w.set_always_on_top(new.always_on_top);
        }
        if old.is_none_or(|o| o.anchor != new.anchor)
            && let Ok(size) = w.outer_size()
        {
            place_main(app, &new.anchor, size);
        }
    }
    if errors.is_empty() { Ok(()) } else { Err(errors.join("\n")) }
}

fn notify(app: &AppHandle, title: &str, body: &str) -> Result<(), String> {
    app.notification().builder().title(title).body(body).show().map_err(|e| e.to_string())
}

fn quit(app: &AppHandle) {
    let _ = app.save_window_state(StateFlags::POSITION);
    app.exit(0);
}

/// La carpeta de Claude Code: `CLAUDE_CONFIG_DIR` si es una ruta absoluta, o
/// `~/.claude`. `None` si no se encuentra la carpeta de usuario: nunca se usa
/// una ruta relativa, que dependería de desde dónde se abrió la app.
fn claude_dir(app: &AppHandle) -> Option<PathBuf> {
    if let Ok(dir) = std::env::var("CLAUDE_CONFIG_DIR") {
        let dir = PathBuf::from(dir);
        if dir.is_absolute() {
            return Some(dir);
        }
    }
    app.path().home_dir().ok().filter(|h| h.is_absolute()).map(|h| h.join(".claude"))
}

/// Inicio de la ventana del plan.
///
/// - Con su reinicio: el reinicio menos la duración; si el reinicio ya pasó y
///   aún no hay datos nuevos, la ventana nueva empezó en ese reinicio.
/// - Sin plan: una ventana móvil hasta ahora, redondeada al minuto para que no
///   cambie en cada vuelta.
fn window_start(win: Option<&plan::LimitWindow>, length: chrono::Duration) -> DateTime<Utc> {
    let now = Utc::now();
    let reset = win.and_then(|w| w.resets_at.as_deref()).and_then(|s| s.parse::<DateTime<Utc>>().ok());
    match reset {
        Some(reset) if reset <= now => reset,
        Some(reset) => reset.checked_sub_signed(length).unwrap_or(now),
        None => {
            let start = now.checked_sub_signed(length).unwrap_or(now);
            start.duration_trunc(chrono::Duration::minutes(1)).unwrap_or(start)
        }
    }
}

/// Clave estable del periodo para el aviso de gasto: cambia solo cuando
/// empieza un periodo nuevo.
fn period_key(period: &str, plan: &plan::PlanInfo) -> String {
    let win = match period {
        "window5h" => plan.five_hour.as_ref(),
        "week" => plan.seven_day.as_ref(),
        _ => return format!("hoy:{}", chrono::Local::now().date_naive()),
    };
    // Sin reinicio conocido se mantiene una sola clave, para no repetir el aviso.
    let reset = win.and_then(alerts::window_key).unwrap_or_else(|| "sin-plan".into());
    format!("{period}:{reset}")
}

/// Hilo que lee los registros, consulta el plan, decide los avisos y avisa a
/// la ventana cuando algo cambia.
fn start_worker(app: AppHandle) {
    let (tx, rx) = mpsc::channel::<()>();
    *app.state::<AppState>().refresh.lock().unwrap() = Some(tx);

    std::thread::spawn(move || {
        let dir = claude_dir(&app);
        let mut scanner = logs::LogScanner::new(dir.as_ref().map(|d| d.join("projects")));
        let mut fetcher = plan::PlanFetcher::new(dir);
        let mut alert_state = alerts::AlertState::default();
        loop {
            let cfg = app.state::<AppState>().settings.lock().unwrap().clone();
            fetcher.set_every(Duration::from_secs(cfg.plan_poll_minutes as u64 * 60));
            scanner.scan();
            fetcher.tick();

            let plan = fetcher.info.clone();
            let today = scanner.totals_since(logs::start_of_today());
            let window5h = scanner.totals_since(window_start(plan.five_hour.as_ref(), chrono::Duration::hours(5)));
            let week = scanner.totals_since(window_start(plan.seven_day.as_ref(), chrono::Duration::days(7)));

            let (spend, name) = match cfg.period.as_str() {
                "window5h" => (window5h.cost_usd, "en esta ventana de 5 h"),
                "week" => (week.cost_usd, "esta semana"),
                _ => (today.cost_usd, "hoy"),
            };
            let key = period_key(&cfg.period, &plan);
            for a in alert_state.check(&cfg.alerts, &plan, spend, &key, name) {
                let _ = notify(&app, &a.title, &a.body);
            }

            let changed = {
                let state = app.state::<AppState>();
                let mut snap = state.snap.lock().unwrap();
                let next = Snapshot {
                    plan,
                    today,
                    window5h,
                    week,
                    ghost: snap.ghost,
                    quiet: quiet::is_quiet(),
                };
                let changed = *snap != next;
                *snap = next;
                changed
            };
            if changed {
                emit_snapshot(&app);
            }

            match rx.recv_timeout(LOOP_EVERY) {
                Ok(()) => {
                    // Varios clics seguidos cuentan como una sola petición.
                    while rx.try_recv().is_ok() {}
                    fetcher.poke();
                }
                Err(RecvTimeoutError::Timeout) => {}
                Err(RecvTimeoutError::Disconnected) => break,
            }
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_window_state::Builder::default().with_state_flags(StateFlags::POSITION).build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--autostart"]),
        ))
        .plugin(tauri_plugin_notification::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state() != ShortcutState::Pressed {
                        return;
                    }
                    let state = app.state::<AppState>();
                    if *state.hotkeys_paused.lock().unwrap() {
                        return;
                    }
                    let Some((toggle, ghost)) = *state.keys.lock().unwrap() else { return };
                    if shortcut == &toggle {
                        toggle_visible(app);
                    } else if shortcut == &ghost {
                        toggle_ghost(app);
                    }
                })
                .build(),
        )
        .manage(AppState {
            snap: Mutex::new(Snapshot::default()),
            settings: Mutex::new(Settings::default()),
            settings_path: Mutex::new(PathBuf::new()),
            keys: Mutex::new(None),
            hotkeys_paused: Mutex::new(false),
            refresh: Mutex::new(None),
            toggle_item: Mutex::new(None),
            ghost_item: Mutex::new(None),
        })
        .on_window_event(|window, event| {
            if window.label() != SETTINGS {
                return;
            }
            // Si se estaba capturando un atajo y los ajustes pierden el foco o se
            // cierran, los atajos vuelven a funcionar.
            let unpause = || *window.state::<AppState>().hotkeys_paused.lock().unwrap() = false;
            match event {
                // Cerrar los ajustes solo los esconde, para abrirlos rápido otra vez.
                WindowEvent::CloseRequested { api, .. } => {
                    api.prevent_close();
                    let _ = window.hide();
                    unpause();
                }
                WindowEvent::Focused(false) => unpause(),
                _ => {}
            }
        })
        .setup(|app| {
            let path = settings::settings_path(app.path().app_config_dir()?);
            let cfg = Settings::load(&path);
            {
                let state = app.state::<AppState>();
                *state.settings_path.lock().unwrap() = path;
                *state.settings.lock().unwrap() = cfg.clone();
            }

            let show = MenuItemBuilder::with_id("toggle", hotkey_label("Mostrar u ocultar", &cfg.hotkey_toggle)).build(app)?;
            let ghost = CheckMenuItemBuilder::with_id("ghost", hotkey_label("Modo fantasma", &cfg.hotkey_ghost)).build(app)?;
            let settings_item = MenuItemBuilder::with_id("settings", "Ajustes…").build(app)?;
            let refresh = MenuItemBuilder::with_id("refresh", "Actualizar ahora").build(app)?;
            let quit_item = MenuItemBuilder::with_id("quit", "Salir").build(app)?;
            let menu = MenuBuilder::new(app)
                .items(&[&show, &ghost, &settings_item, &refresh])
                .separator()
                .item(&quit_item)
                .build()?;
            {
                let state = app.state::<AppState>();
                *state.toggle_item.lock().unwrap() = Some(show);
                *state.ghost_item.lock().unwrap() = Some(ghost);
            }

            let mut tray = TrayIconBuilder::with_id("claupier")
                .tooltip("Claupier")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "toggle" => toggle_visible(app),
                    "ghost" => toggle_ghost(app),
                    "settings" => open_settings(app.clone()),
                    "refresh" => refresh_now(app.state::<AppState>()),
                    "quit" => quit(app),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } =
                        event
                    {
                        toggle_visible(tray.app_handle());
                    }
                });
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.build(app)?;

            let handle = app.handle().clone();
            if let Err(e) = apply_settings(&handle, None, &cfg) {
                let _ = notify(&handle, "Claupier arrancó con un problema", &e);
            }
            if !cfg.start_hidden
                && let Some(w) = app.get_webview_window(MAIN)
            {
                let _ = w.show();
            }
            if cfg.start_ghost {
                set_ghost(&handle, true);
            }

            start_worker(handle);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_snapshot,
            refresh_now,
            get_settings,
            update_settings,
            open_settings,
            fit_window,
            set_hotkeys_paused,
            test_alert
        ])
        .run(tauri::generate_context!())
        .expect("no se pudo iniciar Claupier");
}
