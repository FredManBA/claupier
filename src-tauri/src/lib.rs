mod logs;
mod plan;
mod pricing;

use std::path::PathBuf;
use std::sync::mpsc::{self, RecvTimeoutError, Sender};
use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use tauri::menu::{CheckMenuItem, CheckMenuItemBuilder, MenuBuilder, MenuItemBuilder};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, Wry};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
use tauri_plugin_window_state::{AppHandleExt, StateFlags};

const SCAN_EVERY: Duration = Duration::from_secs(10);

#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    plan: plan::PlanInfo,
    today: logs::TodayTotals,
    ghost: bool,
}

struct AppState {
    snap: Mutex<Snapshot>,
    refresh: Mutex<Option<Sender<()>>>,
    ghost_item: Mutex<Option<CheckMenuItem<Wry>>>,
}

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

fn claude_dir() -> PathBuf {
    if let Ok(dir) = std::env::var("CLAUDE_CONFIG_DIR") {
        return PathBuf::from(dir);
    }
    let home = std::env::var("USERPROFILE").or_else(|_| std::env::var("HOME")).unwrap_or_default();
    PathBuf::from(home).join(".claude")
}

fn emit_snapshot(app: &AppHandle) {
    let snap = app.state::<AppState>().snap.lock().unwrap().clone();
    let _ = app.emit("snapshot", snap);
}

fn toggle_visible(app: &AppHandle) {
    let Some(w) = app.get_webview_window("main") else { return };
    if w.is_visible().unwrap_or(false) {
        let _ = w.hide();
    } else {
        // La ventana no es enfocable: aparece sin quitarle el foco al juego.
        let _ = w.show();
        let _ = w.set_always_on_top(true);
    }
}

fn set_ghost(app: &AppHandle, on: bool) {
    if let Some(w) = app.get_webview_window("main") {
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

fn quit(app: &AppHandle) {
    let _ = app.save_window_state(StateFlags::POSITION);
    app.exit(0);
}

/// Hilo que lee los registros y consulta el plan, y avisa a la ventana.
fn start_worker(app: AppHandle) {
    let (tx, rx) = mpsc::channel::<()>();
    *app.state::<AppState>().refresh.lock().unwrap() = Some(tx);

    std::thread::spawn(move || {
        let dir = claude_dir();
        let mut scanner = logs::LogScanner::new(dir.join("projects"));
        let mut fetcher = plan::PlanFetcher::new(dir);
        loop {
            let logs_changed = scanner.scan();
            let plan_changed = fetcher.tick();
            if logs_changed || plan_changed {
                {
                    let state = app.state::<AppState>();
                    let mut snap = state.snap.lock().unwrap();
                    snap.today = scanner.totals.clone();
                    snap.plan = fetcher.info.clone();
                }
                emit_snapshot(&app);
            }
            match rx.recv_timeout(SCAN_EVERY) {
                Ok(()) => fetcher.poke(),
                Err(RecvTimeoutError::Timeout) => {}
                Err(RecvTimeoutError::Disconnected) => break,
            }
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let toggle_key = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyF);
    let ghost_key = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyG);

    tauri::Builder::default()
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(StateFlags::POSITION)
                .build(),
        )
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(move |app, shortcut, event| {
                    if event.state() != ShortcutState::Pressed {
                        return;
                    }
                    if shortcut == &toggle_key {
                        toggle_visible(app);
                    } else if shortcut == &ghost_key {
                        toggle_ghost(app);
                    }
                })
                .build(),
        )
        .manage(AppState {
            snap: Mutex::new(Snapshot::default()),
            refresh: Mutex::new(None),
            ghost_item: Mutex::new(None),
        })
        .setup(move |app| {
            // Si otra copia ya tiene los atajos, esta sigue funcionando desde la bandeja.
            let _ = app.global_shortcut().register(toggle_key);
            let _ = app.global_shortcut().register(ghost_key);

            let show = MenuItemBuilder::with_id("toggle", "Mostrar u ocultar   Ctrl+Alt+F").build(app)?;
            let ghost = CheckMenuItemBuilder::with_id("ghost", "Modo fantasma   Ctrl+Alt+G").build(app)?;
            let refresh = MenuItemBuilder::with_id("refresh", "Actualizar ahora").build(app)?;
            let quit_item = MenuItemBuilder::with_id("quit", "Salir").build(app)?;
            let menu = MenuBuilder::new(app)
                .items(&[&show, &ghost, &refresh])
                .separator()
                .item(&quit_item)
                .build()?;
            *app.state::<AppState>().ghost_item.lock().unwrap() = Some(ghost);

            let mut tray = TrayIconBuilder::with_id("claupier")
                .tooltip("Claupier")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "toggle" => toggle_visible(app),
                    "ghost" => toggle_ghost(app),
                    "refresh" => refresh_now(app.state::<AppState>()),
                    "quit" => quit(app),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        toggle_visible(tray.app_handle());
                    }
                });
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.build(app)?;

            start_worker(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![get_snapshot, refresh_now])
        .run(tauri::generate_context!())
        .expect("no se pudo iniciar Claupier");
}
