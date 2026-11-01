use log::warn;
use serde::{Deserialize, Serialize};
use std::str::FromStr;
use tauri::Manager;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

use crate::{
    open_new_note_window,
    window::{restore_hidden_window, show_all_hidden_windows, toggle_visible_note_windows},
};

const DEFAULT_NEW_NOTE_SHORTCUT: &str = "Alt+C";
const DEFAULT_RESTORE_WINDOW_SHORTCUT: &str = "Alt+S";
const DEFAULT_SHOW_ALL_HIDDEN_WINDOWS_SHORTCUT: &str = "Alt+Shift+H";
const DEFAULT_TOGGLE_VISIBLE_WINDOWS_SHORTCUT: &str = "Alt+D";
const LEGACY_DEFAULT_RESTORE_WINDOW_SHORTCUT: &str = "Alt+N";
const LEGACY_DEFAULT_TOGGLE_VISIBLE_WINDOWS_SHORTCUT: &str = "Alt+Shift+N";

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GlobalShortcutConfig {
    pub new_note: String,
    pub restore_window: String,
    pub show_all_hidden_windows: String,
    pub toggle_visible_windows: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GlobalShortcutRegistrationSnapshot {
    pub new_note: bool,
    pub restore_window: bool,
    pub show_all_hidden_windows: bool,
    pub toggle_visible_windows: bool,
    pub errors: Vec<String>,
}

struct LoadedShortcuts {
    new_note: String,
    restore_window: String,
    show_all_hidden_windows: String,
    toggle_visible_windows: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredSettings {
    shortcuts: Option<StoredShortcuts>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredShortcuts {
    new_note: Option<String>,
    restore_window: Option<String>,
    show_all_hidden_windows: Option<String>,
    toggle_window: Option<String>,
    toggle_visible_windows: Option<String>,
}

pub fn setup_shortcuts(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let shortcuts = load_shortcuts(app);
    let snapshot = register_shortcuts(
        app,
        &shortcuts.new_note,
        &shortcuts.restore_window,
        &shortcuts.show_all_hidden_windows,
        &shortcuts.toggle_visible_windows,
    );
    for message in snapshot.errors {
        warn!("global_shortcut_register_failed error={message}");
    }
    Ok(())
}

pub fn apply_global_shortcuts(
    app: &tauri::AppHandle,
    shortcuts: &GlobalShortcutConfig,
) -> GlobalShortcutRegistrationSnapshot {
    register_shortcuts(
        app,
        &shortcuts.new_note,
        &shortcuts.restore_window,
        &shortcuts.show_all_hidden_windows,
        &shortcuts.toggle_visible_windows,
    )
}

fn register_shortcuts(
    app: &tauri::AppHandle,
    new_note_shortcut_text: &str,
    restore_window_shortcut_text: &str,
    show_all_hidden_windows_shortcut_text: &str,
    toggle_visible_windows_shortcut_text: &str,
) -> GlobalShortcutRegistrationSnapshot {
    let mut snapshot = GlobalShortcutRegistrationSnapshot {
        new_note: false,
        restore_window: false,
        show_all_hidden_windows: false,
        toggle_visible_windows: false,
        errors: Vec::new(),
    };

    let manager = app.global_shortcut();
    if let Err(error) = manager.unregister_all() {
        snapshot
            .errors
            .push(format!("failed to clear global shortcuts: {error}"));
    }

    match Shortcut::from_str(restore_window_shortcut_text) {
        Ok(shortcut) => {
            if let Err(error) = manager.on_shortcut(shortcut, |app, _shortcut, event| {
                if event.state != ShortcutState::Pressed {
                    return;
                }
                restore_hidden_window(app);
            }) {
                snapshot.errors.push(format!(
                    "failed to register global shortcut `{restore_window_shortcut_text}`: {error}"
                ));
            } else {
                snapshot.restore_window = true;
            }
        }
        Err(error) => {
            snapshot.errors.push(format!(
                "invalid shortcut `{restore_window_shortcut_text}`: {error}"
            ));
        }
    }

    match Shortcut::from_str(new_note_shortcut_text) {
        Ok(shortcut) => {
            if let Err(error) = manager.on_shortcut(shortcut, |app, _shortcut, event| {
                if event.state != ShortcutState::Pressed {
                    return;
                }
                open_new_note_window(app);
            }) {
                snapshot.errors.push(format!(
                    "failed to register global shortcut `{new_note_shortcut_text}`: {error}"
                ));
            } else {
                snapshot.new_note = true;
            }
        }
        Err(error) => {
            snapshot.errors.push(format!(
                "invalid shortcut `{new_note_shortcut_text}`: {error}"
            ));
        }
    }

    match Shortcut::from_str(show_all_hidden_windows_shortcut_text) {
        Ok(shortcut) => {
            if let Err(error) = manager.on_shortcut(shortcut, |app, _shortcut, event| {
                if event.state != ShortcutState::Pressed {
                    return;
                }
                show_all_hidden_windows(app);
            }) {
                snapshot.errors.push(format!(
                    "failed to register global shortcut `{show_all_hidden_windows_shortcut_text}`: {error}"
                ));
            } else {
                snapshot.show_all_hidden_windows = true;
            }
        }
        Err(error) => {
            snapshot.errors.push(format!(
                "invalid shortcut `{show_all_hidden_windows_shortcut_text}`: {error}"
            ));
        }
    }

    match Shortcut::from_str(toggle_visible_windows_shortcut_text) {
        Ok(shortcut) => {
            if let Err(error) = manager.on_shortcut(shortcut, |app, _shortcut, event| {
                if event.state != ShortcutState::Pressed {
                    return;
                }
                toggle_visible_note_windows(app);
            }) {
                snapshot.errors.push(format!(
                    "failed to register global shortcut `{toggle_visible_windows_shortcut_text}`: {error}"
                ));
            } else {
                snapshot.toggle_visible_windows = true;
            }
        }
        Err(error) => {
            snapshot.errors.push(format!(
                "invalid shortcut `{toggle_visible_windows_shortcut_text}`: {error}"
            ));
        }
    }

    snapshot
}

fn load_shortcuts(app: &tauri::AppHandle) -> LoadedShortcuts {
    let settings: StoredSettings = serde_json::from_value(serde_json::Value::Object(
        app.state::<crate::settings::SettingsStore>()
            .snapshot()
            .settings,
    ))
    .expect("Invalid shortcut settings");
    let shortcuts = settings.shortcuts;
    let new_note = shortcuts
        .as_ref()
        .and_then(|stored| stored.new_note.clone())
        .unwrap_or_else(|| DEFAULT_NEW_NOTE_SHORTCUT.to_string());
    let mut restore_window = shortcuts
        .as_ref()
        .and_then(|stored| {
            stored
                .restore_window
                .clone()
                .or(stored.toggle_window.clone())
        })
        .unwrap_or_else(|| DEFAULT_RESTORE_WINDOW_SHORTCUT.to_string());
    let show_all_hidden_windows = shortcuts
        .as_ref()
        .and_then(|stored| stored.show_all_hidden_windows.clone())
        .unwrap_or_else(|| DEFAULT_SHOW_ALL_HIDDEN_WINDOWS_SHORTCUT.to_string());
    let mut toggle_visible_windows = shortcuts
        .and_then(|stored| stored.toggle_visible_windows)
        .unwrap_or_else(|| DEFAULT_TOGGLE_VISIBLE_WINDOWS_SHORTCUT.to_string());
    if restore_window == LEGACY_DEFAULT_RESTORE_WINDOW_SHORTCUT
        && toggle_visible_windows == LEGACY_DEFAULT_TOGGLE_VISIBLE_WINDOWS_SHORTCUT
    {
        restore_window = DEFAULT_RESTORE_WINDOW_SHORTCUT.to_string();
        toggle_visible_windows = DEFAULT_TOGGLE_VISIBLE_WINDOWS_SHORTCUT.to_string();
    }
    LoadedShortcuts {
        new_note,
        restore_window,
        show_all_hidden_windows,
        toggle_visible_windows,
    }
}
