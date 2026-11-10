//! Detecta si conviene estar en silencio: un juego o una app en pantalla
//! completa, una presentación o el modo No molestar de Windows.

#[cfg(windows)]
pub fn is_quiet() -> bool {
    use windows::Win32::UI::Shell::{
        SHQueryUserNotificationState, QUNS_BUSY, QUNS_PRESENTATION_MODE, QUNS_QUIET_TIME, QUNS_RUNNING_D3D_FULL_SCREEN,
    };
    // SAFETY: función de Win32 sin punteros de entrada; solo devuelve un estado.
    match unsafe { SHQueryUserNotificationState() } {
        Ok(state) => {
            state == QUNS_BUSY
                || state == QUNS_RUNNING_D3D_FULL_SCREEN
                || state == QUNS_PRESENTATION_MODE
                || state == QUNS_QUIET_TIME
        }
        Err(_) => false,
    }
}

#[cfg(not(windows))]
pub fn is_quiet() -> bool {
    false
}
