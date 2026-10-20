//! System tray: closing the main window hides to tray so presence + friend
//! toasts keep running in the background. Quit only from the tray menu.

use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, Runtime, Window, WindowEvent,
};

static ALLOW_EXIT: AtomicBool = AtomicBool::new(false);

fn restore_main<R: Runtime>(app: &AppHandle<R>) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let _ = window.show();
    let _ = window.unminimize();
    let _ = window.set_focus();
}

/// Close on the main window → hide (keep process alive). Other windows close normally.
pub fn on_window_event<R: Runtime>(window: &Window<R>, event: &WindowEvent) {
    if window.label() != "main" {
        return;
    }
    if let WindowEvent::CloseRequested { api, .. } = event {
        if ALLOW_EXIT.load(Ordering::SeqCst) {
            return;
        }
        api.prevent_close();
        let _ = window.hide();
    }
}

pub fn install(app: &AppHandle) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "tray-show", "Open Remined", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "tray-quit", "Quit Remined", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &quit])?;

    let mut builder = TrayIconBuilder::with_id("remined-tray")
        .menu(&menu)
        .tooltip("Remined — running in background")
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "tray-show" => restore_main(app),
            "tray-quit" => {
                ALLOW_EXIT.store(true, Ordering::SeqCst);
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.destroy();
                }
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                restore_main(tray.app_handle());
            }
        });

    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }

    builder.build(app)?;
    Ok(())
}

/// Dock / taskbar reopen while the main window is hidden.
pub fn on_reopen<R: Runtime>(app: &AppHandle<R>, has_visible_windows: bool) {
    if !has_visible_windows {
        restore_main(app);
    }
}
