fn main() {
    // Declarar los comandos hace que Tauri genere un permiso por cada uno
    // (`allow-get-snapshot`, …), y así cada ventana recibe solo los que usa.
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(&[
        "get_snapshot",
        "refresh_now",
        "get_settings",
        "update_settings",
        "open_settings",
        "fit_window",
        "set_hotkeys_paused",
        "test_alert",
    ])))
    .expect("no se pudo preparar la compilación de Claupier");
}
