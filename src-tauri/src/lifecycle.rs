use crate::{document::DocumentService, locale};
use std::{collections::HashSet, time::Duration};
use tauri::{Emitter, Manager};
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};
use tokio::sync::{RwLock, watch};
use uuid::Uuid;

enum ExitState {
    Running,
    Draining,
    Saving {
        attempt: String,
        pending: HashSet<String>,
        failed: bool,
    },
    Confirmed {
        attempt: String,
        code: i32,
    },
}

pub struct ApplicationLifecycle {
    pub operations: RwLock<()>,
    state: watch::Sender<ExitState>,
}

impl Default for ApplicationLifecycle {
    fn default() -> Self {
        Self {
            operations: RwLock::new(()),
            state: watch::channel(ExitState::Running).0,
        }
    }
}

impl ApplicationLifecycle {
    pub fn ensure_running(&self) -> Result<(), String> {
        if matches!(*self.state.borrow(), ExitState::Running) {
            Ok(())
        } else {
            Err(String::from("The application is closing."))
        }
    }

    fn begin(&self) -> bool {
        self.state.send_if_modified(|state| {
            if !matches!(state, ExitState::Running) {
                return false;
            }
            *state = ExitState::Draining;
            true
        })
    }

    pub fn confirmed(&self, code: Option<i32>) -> bool {
        matches!(*self.state.borrow(), ExitState::Confirmed { code: expected, .. } if code == Some(expected))
    }

    fn saving(&self, attempt: String, labels: Vec<String>) {
        self.state.send_replace(ExitState::Saving {
            attempt,
            pending: labels.into_iter().collect(),
            failed: false,
        });
    }

    pub fn acknowledge(&self, label: &str, attempt: Option<&str>, ready: bool) -> bool {
        self.state.send_if_modified(|state| {
            let ExitState::Saving {
                attempt: current,
                pending,
                failed,
            } = state
            else {
                return false;
            };
            if attempt.is_some_and(|attempt| attempt != current) || !pending.remove(label) {
                return false;
            }
            *failed |= !ready;
            true
        })
    }

    async fn wait_ready(&self, attempt: &str) -> Result<(), String> {
        let mut receiver = self.state.subscribe();
        let result = tokio::time::timeout(Duration::from_secs(15), receiver.wait_for(|state| {
            !matches!(state, ExitState::Saving { attempt: current, pending, failed } if current == attempt && !failed && !pending.is_empty())
        })).await.map_err(|_| String::from("Note save confirmation timed out."))?;
        let state = result.expect("Exit state sender disappeared");
        if matches!(&*state, ExitState::Saving { attempt: current, failed: false, .. } if current == attempt)
        {
            Ok(())
        } else {
            Err(String::from("Some notes could not be saved."))
        }
    }

    pub async fn wait_finished(&self, attempt: &str) -> bool {
        let mut receiver = self.state.subscribe();
        let state = receiver.wait_for(|state| !matches!(state, ExitState::Saving { attempt: current, .. } if current == attempt))
            .await.expect("Exit state sender disappeared");
        matches!(&*state, ExitState::Confirmed { attempt: current, .. } if current == attempt)
    }

    fn cancel(&self) -> Option<String> {
        match self.state.send_replace(ExitState::Running) {
            ExitState::Saving { attempt, .. } => Some(attempt),
            _ => None,
        }
    }
}

pub fn show_error(app: &tauri::AppHandle, message: impl Into<String>) {
    app.dialog()
        .message(message)
        .title("Pinote")
        .kind(MessageDialogKind::Error)
        .show(|_| {});
}

pub fn request_exit(app: &tauri::AppHandle, code: i32) {
    if !app.state::<DocumentService>().lifecycle.begin() {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let service = app.state::<DocumentService>();
        let _exclusive = service.lifecycle.operations.write().await;
        let attempt = Uuid::new_v4().to_string();
        let preparation = async {
            let labels = service
                .ready_sessions()
                .await
                .map_err(|error| error.to_string())?;
            service.lifecycle.saving(attempt.clone(), labels.clone());
            for label in labels {
                if let Some(window) = app.get_webview_window(&label) {
                    window
                        .emit_to(window.label(), "note-prepare-exit", &attempt)
                        .map_err(|error| error.to_string())?;
                } else {
                    service.lifecycle.acknowledge(&label, Some(&attempt), true);
                }
            }
            service.lifecycle.wait_ready(&attempt).await
        }
        .await;
        match preparation {
            Ok(()) => {
                service
                    .finish_exit()
                    .await
                    .expect("Document shutdown failed");
                service
                    .lifecycle
                    .state
                    .send_replace(ExitState::Confirmed { attempt, code });
                app.exit(code);
            }
            Err(error) => {
                if let Some(attempt) = service.lifecycle.cancel() {
                    for window in app.webview_windows().values() {
                        if let Err(error) =
                            window.emit_to(window.label(), "note-cancel-exit", &attempt)
                        {
                            log::error!("exit_cancel_notification_failed error={error}");
                        }
                    }
                }
                log::error!("exit_cancelled error={error}");
                show_error(&app, locale::current_text(&app).exit_failed);
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn requires_every_window_and_ignores_replies_from_old_attempts() {
        tauri::async_runtime::block_on(async {
            let lifecycle = ApplicationLifecycle::default();
            assert!(lifecycle.begin());
            assert!(!lifecycle.begin());
            assert!(lifecycle.ensure_running().is_err());
            lifecycle.saving("first".into(), vec!["a".into(), "b".into()]);
            assert!(lifecycle.acknowledge("a", Some("first"), true));
            assert!(
                matches!(&*lifecycle.state.borrow(), ExitState::Saving { pending, .. } if pending.contains("b"))
            );
            assert!(lifecycle.acknowledge("b", Some("first"), false));
            assert!(lifecycle.wait_ready("first").await.is_err());
            assert_eq!(lifecycle.cancel().as_deref(), Some("first"));
            assert!(!lifecycle.wait_finished("first").await);
            assert!(lifecycle.ensure_running().is_ok());
            assert!(lifecycle.begin());
            lifecycle.saving("second".into(), vec!["a".into(), "b".into()]);
            assert!(!lifecycle.acknowledge("a", Some("first"), false));
            assert!(lifecycle.acknowledge("a", Some("second"), true));
            assert!(lifecycle.acknowledge("b", None, true));
            assert!(lifecycle.wait_ready("second").await.is_ok());
            lifecycle.state.send_replace(ExitState::Confirmed {
                attempt: "second".into(),
                code: 0,
            });
            assert!(lifecycle.wait_finished("second").await);
            assert!(!lifecycle.wait_finished("first").await);
            assert!(lifecycle.confirmed(Some(0)));
        });
    }
}
