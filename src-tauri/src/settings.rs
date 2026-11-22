use serde::Serialize;
use serde_json::{Map, Value};
use std::{fs, io, path::PathBuf, sync::Mutex};
use tauri::{Emitter, Manager};

use crate::{fonts, storage};

const SERIF_FONT_FAMILIES: &[&str] = &["Georgia", "Cambria", "Times New Roman", "Times"];
const MONO_FONT_FAMILIES: &[&str] = &[
    "JetBrains Mono",
    "Fira Code",
    "Menlo",
    "Monaco",
    "Consolas",
    "Liberation Mono",
    "Courier New",
];

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

fn context_menu_actions(default: &Value) -> Vec<&str> {
    default
        .as_array()
        .expect("Context menu defaults must be an array")
        .iter()
        .map(|item| {
            item["action"]
                .as_str()
                .expect("Context menu action must be a string")
        })
        .collect()
}

fn valid_value(key: &str, value: &Value, default: &Value) -> bool {
    if key == "dragMouseButtons" {
        return value.as_array().is_some_and(|buttons| {
            buttons.iter().enumerate().all(|(index, button)| {
                button
                    .as_str()
                    .is_some_and(|button| ["middle", "right"].contains(&button))
                    && !buttons[..index].contains(button)
            })
        });
    }
    if key == "editorFontFamily" {
        return value.as_array().is_some_and(|items| {
            items.iter().enumerate().all(|(index, item)| {
                item.as_object().is_some_and(|item| {
                    item.len() == 2
                        && item.get("enabled").is_some_and(Value::is_boolean)
                        && item.get("family").is_some_and(|family| {
                            family
                                .as_str()
                                .is_some_and(|family| !family.is_empty() && family.trim() == family)
                                && !items[..index]
                                    .iter()
                                    .any(|other| other["family"] == *family)
                        })
                })
            })
        });
    }
    if key == "contextMenuItems" {
        let actions = context_menu_actions(default);
        return value.as_array().is_some_and(|items| {
            items.len() == actions.len()
                && items.iter().enumerate().all(|(index, item)| {
                    item.as_object().is_some_and(|item| {
                        item.len() == 2
                            && item.get("visible").is_some_and(Value::is_boolean)
                            && item.get("action").is_some_and(|action| {
                                action
                                    .as_str()
                                    .is_some_and(|action| actions.contains(&action))
                                    && !items[..index]
                                        .iter()
                                        .any(|other| other["action"] == *action)
                            })
                    })
                })
        });
    }
    let choices: &[&str] = match key {
        "language" => &["system", "en-US", "zh-CN"],
        "theme" => &["system", "light", "dark"],
        "noteGlassEffectWindows" => &["none", "mica", "acrylic", "blur"],
        "wheelResizeModifier" | "wheelOpacityModifier" => &["none", "alt", "ctrl", "shift", "meta"],
        "dragModifier" => &["none", "alt", "ctrl", "meta"],
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

fn font_families_from_preset(
    preset: &str,
    installed: impl FnOnce() -> Result<Vec<String>, String>,
) -> Result<Value, String> {
    let families = match preset {
        "serif" => SERIF_FONT_FAMILIES,
        "mono" => MONO_FONT_FAMILIES,
        _ => return Ok(Value::Array(Vec::new())),
    };
    let installed = installed()?;
    Ok(Value::Array(
        families
            .iter()
            .filter(|family| {
                installed
                    .iter()
                    .any(|installed| installed.eq_ignore_ascii_case(family))
            })
            .map(|family| serde_json::json!({"family": family, "enabled": true}))
            .collect(),
    ))
}

fn normalize(
    mut stored: Map<String, Value>,
    installed_font_families: impl FnOnce() -> Result<Vec<String>, String>,
) -> Result<Map<String, Value>, String> {
    let defaults = defaults();
    stored.remove("noteGlassBlur");
    if let Some(Value::String(preset)) = stored.get("editorFontFamily") {
        let families = font_families_from_preset(preset, installed_font_families)?;
        stored.insert("editorFontFamily".into(), families);
    }
    if let Some(Value::String(button)) = stored.remove("dragMouseButton")
        && !stored.contains_key("dragMouseButtons")
    {
        stored.insert(
            "dragMouseButtons".into(),
            Value::Array(vec![Value::String(button)]),
        );
    }
    if let Some(Value::Array(items)) = stored.get_mut("contextMenuItems") {
        for item in defaults["contextMenuItems"]
            .as_array()
            .expect("Context menu defaults must be an array")
        {
            if !items
                .iter()
                .any(|stored| stored.get("action") == item.get("action"))
            {
                items.push(item.clone());
            }
        }
    }
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
    Ok(stored)
}

impl SettingsStore {
    pub fn new(path: PathBuf) -> Result<Self, String> {
        Self::open(path, fonts::installed_font_families)
    }

    fn open(
        path: PathBuf,
        installed_font_families: impl FnOnce() -> Result<Vec<String>, String>,
    ) -> Result<Self, String> {
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
                settings: normalize(stored, installed_font_families)?,
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

    #[test]
    fn drag_settings_are_migrated_and_validated() {
        let directory = storage::test_directory();
        let path = directory.path().join("settings.json");
        for (stored, buttons) in [
            (json!({"dragMouseButton": "right"}), json!(["right"])),
            (json!({"dragMouseButton": "middle"}), json!(["middle"])),
            (json!({"dragMouseButton": "left"}), json!(["middle"])),
            (json!({}), json!(["middle"])),
        ] {
            fs::write(&path, stored.to_string()).unwrap();
            let settings = SettingsStore::new(path.clone())
                .unwrap()
                .snapshot()
                .settings;
            assert_eq!(settings["dragMouseButtons"], buttons);
            assert_eq!(settings["dragModifier"], "alt");
            assert!(!settings.contains_key("dragMouseButton"));
        }
        let store = SettingsStore::new(path).unwrap();
        for value in [
            json!({"dragMouseButtons": []}),
            json!({"dragMouseButtons": ["right", "middle"]}),
            json!({"dragModifier": "none"}),
            json!({"dragModifier": "meta"}),
            json!({"wheelResizeModifier": "none"}),
            json!({"wheelOpacityModifier": "none"}),
        ] {
            assert!(store.update(patch(value)).is_ok());
        }
        for value in [
            json!({"dragMouseButtons": ["middle", "middle"]}),
            json!({"dragMouseButtons": ["left"]}),
            json!({"dragMouseButtons": "middle"}),
            json!({"dragModifier": "shift"}),
            json!({"dragMouseButton": "right"}),
        ] {
            assert!(store.update(patch(value)).is_err());
        }
    }

    #[test]
    fn font_presets_become_installed_font_families() {
        let directory = storage::test_directory();
        let path = directory.path().join("settings.json");
        let installed = || {
            Ok(["consolas", "Courier New", "Georgia", "Noto Sans"]
                .map(String::from)
                .to_vec())
        };
        let font = |family: &str, enabled: bool| json!({"family": family, "enabled": enabled});
        let chosen = json!([font("LXGW WenKai", false), font("Georgia", true)]);
        for (stored, families) in [
            (json!("serif"), json!([font("Georgia", true)])),
            (
                json!("mono"),
                json!([font("Consolas", true), font("Courier New", true)]),
            ),
            (json!("system"), json!([])),
            (chosen.clone(), chosen.clone()),
            (
                json!([font("Georgia", true), font("Georgia", false)]),
                json!([]),
            ),
            (json!([font(" Georgia", true)]), json!([])),
            (json!([{"family": "Georgia"}]), json!([])),
            (json!(["Georgia"]), json!([])),
            (json!(null), json!([])),
        ] {
            fs::write(&path, json!({"editorFontFamily": stored}).to_string()).unwrap();
            let settings = SettingsStore::open(path.clone(), installed)
                .unwrap()
                .snapshot()
                .settings;
            assert_eq!(settings["editorFontFamily"], families);
        }
        fs::write(&path, json!({"editorFontFamily": "mono"}).to_string()).unwrap();
        assert!(SettingsStore::open(path.clone(), || Err("No fonts".into())).is_err());
        let store = SettingsStore::open(path, installed).unwrap();
        assert!(
            store
                .update(patch(json!({"editorFontFamily": chosen})))
                .is_ok()
        );
        for value in [
            json!("serif"),
            json!([font("", true)]),
            json!([font("A", true), font("A", true)]),
            json!([{"family": "A", "enabled": "yes"}]),
            json!([{"family": "A", "enabled": true, "size": 1}]),
        ] {
            assert!(
                store
                    .update(patch(json!({"editorFontFamily": value})))
                    .is_err()
            );
        }
    }

    #[test]
    fn context_menu_items_keep_their_order_and_gain_new_actions() {
        let directory = storage::test_directory();
        let path = directory.path().join("settings.json");
        let defaults = defaults()["contextMenuItems"].clone();
        let mut reordered = defaults.as_array().unwrap().clone();
        reordered.reverse();
        reordered[0]["visible"] = json!(!reordered[0]["visible"].as_bool().unwrap());
        let missing = reordered.remove(3);
        fs::write(&path, json!({"contextMenuItems": reordered}).to_string()).unwrap();
        let store = SettingsStore::new(path.clone()).unwrap();
        let mut expected = reordered.clone();
        expected.push(missing);
        assert_eq!(
            store.snapshot().settings["contextMenuItems"],
            json!(expected)
        );
        for stored in [
            json!({"contextMenuItems": [{"action": "unknown", "visible": true}]}),
            json!({"contextMenuItems": "new-note"}),
            json!({}),
        ] {
            fs::write(&path, stored.to_string()).unwrap();
            let settings = SettingsStore::new(path.clone())
                .unwrap()
                .snapshot()
                .settings;
            assert_eq!(settings["contextMenuItems"], defaults);
        }
        let store = SettingsStore::new(path).unwrap();
        assert!(
            store
                .update(patch(json!({"contextMenuItems": expected})))
                .is_ok()
        );
        let mut duplicated = defaults.as_array().unwrap().clone();
        duplicated[1] = duplicated[0].clone();
        let mut extra_key = defaults.as_array().unwrap().clone();
        extra_key[0]["label"] = json!("New");
        let mut shortened = defaults.as_array().unwrap().clone();
        shortened.pop();
        for value in [duplicated, extra_key, shortened] {
            assert!(
                store
                    .update(patch(json!({"contextMenuItems": value})))
                    .is_err()
            );
        }
    }
}
