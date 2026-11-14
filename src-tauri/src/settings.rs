use serde::Serialize;
use serde_json::{Map, Value};
use std::{fs, io, path::PathBuf, sync::Mutex};
use tauri::{Emitter, Manager};

use crate::storage;

#[derive(Clone, Debug, Serialize)]
pub struct SettingsSnapshot {
    pub revision: u64,
    pub settings: Map<String, Value>,
}

#[derive(Debug, Serialize)]
pub struct SettingsError {
    message: String,
    snapshot: Option<SettingsSnapshot>,
}

impl From<String> for SettingsError {
    fn from(message: String) -> Self {
        Self {
            message,
            snapshot: None,
        }
    }
}

pub struct SettingsStore {
    path: PathBuf,
    snapshot: Mutex<SettingsSnapshot>,
}

fn defaults() -> Map<String, Value> {
    serde_json::from_str(include_str!("../../src/settings.defaults.json"))
        .expect("Invalid bundled settings defaults")
}

fn valid_value(key: &str, value: &Value, default: &Value) -> bool {
    let choices: &[&str] = match key {
        "language" => &["system", "en-US", "zh-CN"],
        "theme" => &["system", "light", "dark"],
        "noteGlassEffectWindows" => &["none", "mica", "acrylic", "blur"],
        "editorFontFamily" => &["system", "serif", "mono"],
        "wheelResizeModifier" | "wheelOpacityModifier" => &["alt", "ctrl", "shift", "meta"],
        "dragMouseButton" => &["middle", "right"],
        _ => &[],
    };
    if !choices.is_empty() {
        return value.as_str().is_some_and(|value| choices.contains(&value));
    }
    match default {
        Value::Bool(_) => value.is_boolean(),
        Value::String(_) => value.is_string(),
        Value::Number(_) => value.as_f64().is_some_and(|number| {
            number.is_finite()
                && match key {
                    "editorFontSize" | "editorLineHeight" => number > 0.0,
                    "editorPaddingX" | "editorPaddingY" => number >= 0.0,
                    _ => true,
                }
        }),
        _ => false,
    }
}

fn normalize(mut stored: Map<String, Value>) -> Map<String, Value> {
    let defaults = defaults();
    stored.remove("noteGlassBlur");
    for (key, default) in &defaults {
        if key == "shortcuts" {
            let mut shortcuts = stored
                .remove(key)
                .and_then(|value| value.as_object().cloned())
                .unwrap_or_default();
            if !shortcuts.contains_key("restoreWindow")
                && let Some(value) = shortcuts
                    .get("toggleWindow")
                    .filter(|value| value.is_string())
                    .cloned()
            {
                shortcuts.insert("restoreWindow".into(), value);
            }
            for (name, value) in default
                .as_object()
                .expect("Shortcuts defaults must be an object")
            {
                if !shortcuts.get(name).is_some_and(Value::is_string) {
                    shortcuts.insert(name.clone(), value.clone());
                }
            }
            let legacy = [
                ("restoreWindow", "Alt+N"),
                ("showAllHiddenWindows", "Alt+Shift+H"),
                ("toggleVisibleWindows", "Alt+Shift+N"),
                ("toggleAlwaysOnTop", "Ctrl+Shift+T"),
                ("toggleReadOnly", "Alt+R"),
                ("toggleTheme", "Ctrl+Shift+D"),
                ("hideWindow", "Escape"),
                ("closeWindow", "Ctrl+Shift+W"),
            ];
            if legacy
                .iter()
                .all(|(name, value)| shortcuts[*name] == *value)
            {
                for name in [
                    "restoreWindow",
                    "toggleVisibleWindows",
                    "toggleAlwaysOnTop",
                    "toggleReadOnly",
                ] {
                    shortcuts.insert(name.into(), default[name].clone());
                }
            }
            stored.insert(key.clone(), Value::Object(shortcuts));
        } else if !stored
            .get(key)
            .is_some_and(|value| valid_value(key, value, default))
        {
            stored.insert(key.clone(), default.clone());
        }
    }
    if let Some(Value::String(directory)) = stored.get_mut("newNoteDirectory") {
        *directory = directory.trim().to_string();
    }
    stored
}

impl SettingsStore {
    pub fn new(path: PathBuf) -> Result<Self, String> {
        let stored = match fs::read_to_string(&path) {
            Ok(content) => serde_json::from_str(content.trim_start_matches('\u{feff}'))
                .map_err(|error| format!("Could not read settings: {error}"))?,
            Err(error) if error.kind() == io::ErrorKind::NotFound => Map::new(),
            Err(error) => return Err(format!("Could not read settings: {error}")),
        };
        Ok(Self {
            path,
            snapshot: Mutex::new(SettingsSnapshot {
                revision: 0,
                settings: normalize(stored),
            }),
        })
    }

    pub fn snapshot(&self) -> SettingsSnapshot {
        self.snapshot
            .lock()
            .expect("Settings lock poisoned")
            .clone()
    }

    pub fn update(&self, patch: Map<String, Value>) -> Result<SettingsSnapshot, String> {
        let defaults = defaults();
        let mut current = self.snapshot.lock().expect("Settings lock poisoned");
        let mut next = current.settings.clone();
        for (key, value) in patch {
            let default = defaults
                .get(&key)
                .ok_or_else(|| format!("Unknown setting: {key}"))?;
            if key == "shortcuts" {
                let patch = value.as_object().ok_or("Shortcuts must be an object")?;
                let shortcuts = next
                    .get_mut(&key)
                    .and_then(Value::as_object_mut)
                    .expect("Invalid shortcuts state");
                for (name, value) in patch {
                    if default.get(name).is_none() || !value.is_string() {
                        return Err(format!("Invalid shortcut: {name}"));
                    }
                    shortcuts.insert(name.clone(), value.clone());
                }
            } else {
                if !valid_value(&key, &value, default) {
                    return Err(format!("Invalid setting: {key}"));
                }
                next.insert(key, value);
            }
        }
        if next == current.settings {
            return Ok(current.clone());
        }
        let bytes = serde_json::to_vec_pretty(&next).map_err(|error| error.to_string())?;
        storage::replace_file(&self.path, &bytes)
            .map_err(|error| format!("Could not save settings: {error}"))?;
        current.settings = next;
        current.revision += 1;
        Ok(current.clone())
    }
}

#[tauri::command]
pub fn get_settings(state: tauri::State<'_, SettingsStore>) -> SettingsSnapshot {
    state.snapshot()
}

#[tauri::command]
pub async fn update_settings(
    app: tauri::AppHandle,
    patch: Map<String, Value>,
) -> Result<SettingsSnapshot, SettingsError> {
    tauri::async_runtime::spawn_blocking(move || {
        let snapshot = app.state::<SettingsStore>().update(patch)?;
        app.emit("settings-updated", &snapshot)
            .map_err(|error| SettingsError {
                message: format!("Settings were saved, but could not be synchronized: {error}"),
                snapshot: Some(snapshot.clone()),
            })?;
        Ok(snapshot)
    })
    .await
    .map_err(|error| SettingsError::from(error.to_string()))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::{
        sync::{Arc, Barrier},
        thread,
    };

    fn patch(value: Value) -> Map<String, Value> {
        value.as_object().unwrap().clone()
    }

    #[test]
    fn concurrent_patches_preserve_other_fields_and_survive_restart() {
        let directory = storage::test_directory();
        let path = directory.path().join("settings.json");
        fs::write(
            &path,
            r#"{"theme":"dark","futureSetting":42,"launchAtStartup":true,"shortcuts":{"newNote":"Ctrl+N"}}"#,
        )
        .unwrap();
        let store = Arc::new(SettingsStore::new(path.clone()).unwrap());
        assert_eq!(store.snapshot().settings["confirmNoteDeletion"], true);
        let barrier = Arc::new(Barrier::new(3));
        let handles = [
            json!({"confirmNoteDeletion": false}),
            json!({"shortcuts": {"deleteNote": "Alt+Delete"}}),
        ]
        .into_iter()
        .map(|value| {
            let store = store.clone();
            let barrier = barrier.clone();
            thread::spawn(move || {
                barrier.wait();
                store.update(patch(value)).unwrap()
            })
        })
        .collect::<Vec<_>>();
        barrier.wait();
        for handle in handles {
            handle.join().unwrap();
        }
        let current = store.snapshot();
        assert_eq!(current.revision, 2);
        assert_eq!(current.settings["confirmNoteDeletion"], false);
        assert_eq!(current.settings["theme"], "dark");
        assert_eq!(current.settings["futureSetting"], 42);
        assert_eq!(current.settings["launchAtStartup"], true);
        assert_eq!(current.settings["shortcuts"]["newNote"], "Ctrl+N");
        assert_eq!(current.settings["shortcuts"]["deleteNote"], "Alt+Delete");
        assert_eq!(
            SettingsStore::new(path).unwrap().snapshot().settings,
            current.settings
        );
    }

    #[test]
    fn failed_writes_and_invalid_patches_leave_settings_unchanged() {
        let directory = storage::test_directory();
        let parent = directory.path().join("blocked");
        let store = SettingsStore::new(parent.join("settings.json")).unwrap();
        fs::write(&parent, "block directory creation").unwrap();
        assert!(
            store
                .update(patch(json!({"confirmNoteDeletion": false})))
                .is_err()
        );
        assert_eq!(store.snapshot().revision, 0);
        assert_eq!(store.snapshot().settings["confirmNoteDeletion"], true);
        for value in [
            json!({"confirmNoteDeletion": "false"}),
            json!({"theme": "invalid"}),
            json!({"shortcuts": {"deleteNote": false}}),
            json!({"unknown": 1}),
        ] {
            assert!(store.update(patch(value)).is_err());
        }
        assert_eq!(store.snapshot().revision, 0);
        fs::remove_file(parent).unwrap();
        store
            .update(patch(json!({"confirmNoteDeletion": false})))
            .unwrap();
        assert_eq!(store.snapshot().revision, 1);
    }

    #[test]
    fn loads_legacy_defaults_and_preserves_corrupt_files() {
        let directory = storage::test_directory();
        let path = directory.path().join("settings.json");
        fs::write(&path, "\u{feff}{\"shortcuts\":{\"restoreWindow\":\"Alt+N\",\"toggleVisibleWindows\":\"Alt+Shift+N\",\"toggleAlwaysOnTop\":\"Ctrl+Shift+T\"},\"confirmNoteDeletion\":null}").unwrap();
        let snapshot = SettingsStore::new(path.clone()).unwrap().snapshot();
        assert_eq!(snapshot.settings["confirmNoteDeletion"], true);
        assert_eq!(snapshot.settings["shortcuts"]["restoreWindow"], "Alt+S");
        assert_eq!(
            snapshot.settings["shortcuts"]["toggleVisibleWindows"],
            "Alt+D"
        );
        assert_eq!(snapshot.settings["shortcuts"]["toggleAlwaysOnTop"], "Alt+A");
        for content in ["{broken", "[]", "null"] {
            fs::write(&path, content).unwrap();
            assert!(SettingsStore::new(path.clone()).is_err());
            assert_eq!(fs::read_to_string(&path).unwrap(), content);
        }
    }
}
