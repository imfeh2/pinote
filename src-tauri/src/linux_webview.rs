use crate::{document::DocumentService, locale};
use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};
use tauri::{Manager, plugin::TauriPlugin};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use webkit2gtk::WebViewExt;

pub fn init() -> TauriPlugin<tauri::Wry> {
    tauri::plugin::Builder::new("linux-webview-recovery")
        .on_webview_ready(|webview| {
            let app = webview.app_handle().clone();
            let label = webview.label().to_string();
            if let Err(error) = webview.with_webview(move |platform| {
                let pending = Arc::new(AtomicBool::new(false));
                platform.inner().connect_web_process_terminated(move |_, reason| {
                    if pending.swap(true, Ordering::Relaxed) {
                        return;
                    }
                    let app = app.clone();
                    let label = label.clone();
                    let pending = pending.clone();
                    log::error!("web_renderer_terminated window={label:?} reason={reason:?}");
                    tauri::async_runtime::spawn(async move {
                        if let Err(error) = app.state::<DocumentService>()
                            .renderer_terminated(label.clone()).await
                        {
                            log::error!("renderer_session_reset_failed error={error}");
                            pending.store(false, Ordering::Relaxed);
                            crate::lifecycle::show_error(&app, error.to_string());
                            return;
                        }
                        let Some(window) = app.get_webview_window(&label) else {
                            pending.store(false, Ordering::Relaxed);
                            return;
                        };
                        let text = locale::current_text(&app);
                        app.dialog()
                            .message(text.renderer_stopped)
                            .title("Pinote")
                            .parent(&window)
                            .kind(MessageDialogKind::Error)
                            .buttons(MessageDialogButtons::OkCancelCustom(
                                text.reload_window.into(), text.close_window.into(),
                            ))
                            .show(move |reload| {
                                pending.store(false, Ordering::Relaxed);
                                // Close the native window, not just its webview.
                                let result = if reload {
                                    window.reload()
                                } else if window.app_handle().state::<DocumentService>()
                                    .for_window(&label).is_ok()
                                {
                                    window.close()
                                } else {
                                    window.destroy()
                                };
                                if let Err(error) = result {
                                    log::error!("renderer_recovery_failed window={label:?} error={error}");
                                    crate::lifecycle::show_error(window.app_handle(), error.to_string());
                                }
                            });
                    });
                });
            }) {
                log::error!("renderer_recovery_setup_failed window={:?} error={error}", webview.label());
            }
        })
        .build()
}
