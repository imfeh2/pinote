use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::{HashMap, HashSet},
    fs,
    path::PathBuf,
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::Manager;

const CACHE_VERSION: u32 = 2;
const PHYSICAL_SIZE_CACHE_VERSION: u64 = 1;
const NOTE_OPACITY_MIN: f64 = 0.0;
const NOTE_OPACITY_MAX: f64 = 1.0;
const NOTE_SCROLL_TOP_MIN: f64 = 0.0;
const RESERVED_WINDOW_IDS: [&str; 1] = ["settings"];
const DEFAULT_WINDOW_WIDTH: f64 = 400.0;
const DEFAULT_WINDOW_HEIGHT: f64 = 500.0;

pub struct WindowStateStore {
    path: PathBuf,
    mutex: Mutex<()>,
}

impl WindowStateStore {
    pub fn new(path: PathBuf) -> Self {
        Self {
            path,
            mutex: Mutex::new(()),
        }
    }

    pub fn read(&self) -> Result<WindowStateCache, String> {
        let _guard = self
            .mutex
            .lock()
            .map_err(|_| String::from("Failed to lock window state cache"))?;
        self.read_unlocked()
    }

    fn mutate<T>(&self, update: impl FnOnce(&mut WindowStateCache) -> T) -> Result<T, String> {
        let _guard = self
            .mutex
            .lock()
            .map_err(|_| String::from("Failed to lock window state cache"))?;
        let mut cache = self.read_unlocked()?;
        let result = update(&mut cache);
        self.write_unlocked(&cache)?;
        Ok(result)
    }

    fn write_unlocked(&self, cache: &WindowStateCache) -> Result<(), String> {
        let content = serde_json::to_vec_pretty(cache)
            .map_err(|error| format!("Failed to serialize window state cache: {error}"))?;
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        crate::storage::replace_file(&self.path, &content)
            .map_err(|error| format!("Failed to write window state cache: {error}"))
    }

    pub fn migrate_physical_sizes(
        &self,
        monitors: &[MonitorArea],
        primary: Option<&MonitorArea>,
    ) -> Result<bool, String> {
        let _guard = self
            .mutex
            .lock()
            .map_err(|_| String::from("Failed to lock window state cache"))?;
        let content = match fs::read_to_string(&self.path) {
            Ok(value) => value,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
            Err(error) => return Err(format!("Failed to read window state cache: {error}")),
        };
        let mut value = serde_json::from_str::<Value>(content.trim_start_matches('\u{feff}'))
            .map_err(|error| format!("Failed to parse window state cache: {error}"))?;
        if value.get("version").and_then(Value::as_u64) != Some(PHYSICAL_SIZE_CACHE_VERSION) {
            return Ok(false);
        }
        if let Some(windows) = value.get_mut("windows").and_then(Value::as_object_mut) {
            for item in windows.values_mut() {
                if let Some(bounds) = item.get_mut("bounds").and_then(Value::as_object_mut) {
                    convert_physical_bounds(bounds, monitors, primary)?;
                }
            }
        }
        value["version"] = Value::from(CACHE_VERSION);
        let cache = sanitize_cache(value)?;
        self.write_unlocked(&cache)?;
        Ok(true)
    }

    fn read_unlocked(&self) -> Result<WindowStateCache, String> {
        let content = match fs::read_to_string(&self.path) {
            Ok(value) => value,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Ok(build_empty_cache());
            }
            Err(error) => return Err(format!("Failed to read window state cache: {error}")),
        };
        let value = serde_json::from_str::<Value>(content.trim_start_matches('\u{feff}'))
            .map_err(|error| format!("Failed to parse window state cache: {error}"))?;
        if value.get("version").and_then(Value::as_u64) != Some(u64::from(CACHE_VERSION)) {
            return Err(String::from("Unsupported window state cache version"));
        }
        if !value.get("windows").is_some_and(Value::is_object) {
            return Err(String::from("Invalid window state cache"));
        }
        sanitize_cache(value)
    }

    pub fn remove_windows(&self, labels: &[String]) -> Result<(), String> {
        if labels.is_empty() {
            return Ok(());
        }
        let labels: HashSet<&str> = labels.iter().map(String::as_str).collect();
        self.mutate(|cache| {
            let keys: HashSet<String> = cache
                .windows
                .iter()
                .filter(|(_, state)| labels.contains(state.window_id.as_str()))
                .map(|(key, _)| key.clone())
                .collect();
            cache.windows.retain(|key, _| !keys.contains(key));
            cache.window_order.retain(|key| !keys.contains(key));
            cache.hidden_stack.retain(|key| !keys.contains(key));
            cache
                .visible_window_toggle_snapshot
                .retain(|label| !labels.contains(label.as_str()));
            cache.updated_at = timestamp_now();
        })
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum WindowVisibility {
    Visible,
    Hidden,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowBounds {
    pub x: i32,
    pub y: i32,
    pub width: f64,
    pub height: f64,
    pub monitor: Option<MonitorArea>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MonitorArea {
    pub name: String,
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub scale_factor: f64,
}

impl MonitorArea {
    fn contains(&self, x: f64, y: f64) -> bool {
        x >= f64::from(self.x)
            && x < f64::from(self.x) + f64::from(self.width)
            && y >= f64::from(self.y)
            && y < f64::from(self.y) + f64::from(self.height)
    }
}

pub fn restore_bounds(
    bounds: &WindowBounds,
    monitors: &[MonitorArea],
    primary: Option<&MonitorArea>,
) -> WindowBounds {
    let unchanged = WindowBounds {
        monitor: None,
        ..bounds.clone()
    };
    let Some(saved) = bounds.monitor.as_ref() else {
        return unchanged;
    };
    if monitors.contains(saved) || saved.width == 0 || saved.height == 0 {
        return unchanged;
    }
    let center_x = f64::from(bounds.x) + bounds.width * saved.scale_factor / 2.0;
    let center_y = f64::from(bounds.y) + bounds.height * saved.scale_factor / 2.0;
    let Some(target) = monitors
        .iter()
        .find(|monitor| !saved.name.is_empty() && monitor.name == saved.name)
        .or_else(|| {
            monitors
                .iter()
                .find(|monitor| monitor.contains(center_x, center_y))
        })
        .or(primary)
        .or_else(|| monitors.first())
    else {
        return unchanged;
    };
    let logical_area = |monitor: &MonitorArea| {
        f64::from(monitor.width) * f64::from(monitor.height)
            / (monitor.scale_factor * monitor.scale_factor)
    };
    let ratio = (logical_area(target) / logical_area(saved)).sqrt();
    let width = (bounds.width * ratio).max(1.0);
    let height = (bounds.height * ratio).max(1.0);
    let place = |origin: i32, length: u32, relative: f64, size: f64| {
        let start = f64::from(origin);
        let end = start + f64::from(length) - size;
        let position = start + relative * f64::from(length) - size / 2.0;
        position.min(end).max(start).round() as i32
    };
    WindowBounds {
        x: place(
            target.x,
            target.width,
            (center_x - f64::from(saved.x)) / f64::from(saved.width),
            width * target.scale_factor,
        ),
        y: place(
            target.y,
            target.height,
            (center_y - f64::from(saved.y)) / f64::from(saved.height),
            height * target.scale_factor,
        ),
        width,
        height,
        monitor: None,
    }
}

fn convert_physical_bounds(
    bounds: &mut serde_json::Map<String, Value>,
    monitors: &[MonitorArea],
    primary: Option<&MonitorArea>,
) -> Result<(), String> {
    let x = as_number(bounds.get("x"), 0.0);
    let y = as_number(bounds.get("y"), 0.0);
    let width = as_number(bounds.get("width"), DEFAULT_WINDOW_WIDTH);
    let height = as_number(bounds.get("height"), DEFAULT_WINDOW_HEIGHT);
    let Some(monitor) = monitors
        .iter()
        .find(|monitor| monitor.contains(x + width / 2.0, y + height / 2.0))
        .or(primary)
    else {
        return Ok(());
    };
    bounds.insert(
        String::from("width"),
        Value::from(width / monitor.scale_factor),
    );
    bounds.insert(
        String::from("height"),
        Value::from(height / monitor.scale_factor),
    );
    bounds.insert(
        String::from("monitor"),
        serde_json::to_value(monitor)
            .map_err(|error| format!("Failed to serialize monitor area: {error}"))?,
    );
    Ok(())
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CachedWindowState {
    pub window_id: String,
    pub note_id: String,
    pub note_path: String,
    pub visibility: WindowVisibility,
    pub always_on_top: bool,
    pub read_only: bool,
    pub opacity: f64,
    pub scroll_top: f64,
    pub bounds: WindowBounds,
    pub updated_at: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowStateCache {
    pub version: u32,
    pub updated_at: String,
    pub windows: HashMap<String, CachedWindowState>,
    pub window_order: Vec<String>,
    pub hidden_stack: Vec<String>,
    pub visible_window_toggle_snapshot: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowPreferences {
    pub read_only: bool,
    pub opacity: f64,
    pub scroll_top: f64,
    pub visibility: Option<WindowVisibility>,
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct UpdateWindowStateOptions {
    pub push_hidden_to_top: Option<bool>,
    pub preserve_hidden_visibility: Option<bool>,
}

fn timestamp_now() -> String {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default();
    format!("{millis:020}")
}

fn build_empty_cache() -> WindowStateCache {
    WindowStateCache {
        version: CACHE_VERSION,
        updated_at: timestamp_now(),
        windows: HashMap::new(),
        window_order: Vec::new(),
        hidden_stack: Vec::new(),
        visible_window_toggle_snapshot: Vec::new(),
    }
}

fn as_string(value: Option<&Value>) -> String {
    value
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or_default()
}

fn as_number(value: Option<&Value>, fallback: f64) -> f64 {
    value.and_then(Value::as_f64).unwrap_or(fallback)
}

fn as_i32(value: Option<&Value>, fallback: i32) -> i32 {
    value
        .and_then(Value::as_i64)
        .and_then(|number| i32::try_from(number).ok())
        .unwrap_or(fallback)
}

fn as_bool(value: Option<&Value>, fallback: bool) -> bool {
    value.and_then(Value::as_bool).unwrap_or(fallback)
}

fn compare_updated_at(left: &str, right: &str) -> std::cmp::Ordering {
    match (left.parse::<u128>(), right.parse::<u128>()) {
        (Ok(left_value), Ok(right_value)) => left_value.cmp(&right_value),
        _ => left.cmp(right),
    }
}

fn build_note_cache_key(note_path: &str) -> String {
    crate::document::storage_key(note_path)
}

fn sanitize_bounds(value: Option<&Value>) -> Option<WindowBounds> {
    let Some(source) = value.and_then(Value::as_object) else {
        return Some(WindowBounds {
            x: 0,
            y: 0,
            width: DEFAULT_WINDOW_WIDTH,
            height: DEFAULT_WINDOW_HEIGHT,
            monitor: None,
        });
    };
    let monitor = match source.get("monitor") {
        None | Some(Value::Null) => None,
        Some(value) => Some(serde_json::from_value(value.clone()).ok()?),
    };
    Some(WindowBounds {
        x: as_i32(source.get("x"), 0),
        y: as_i32(source.get("y"), 0),
        width: as_number(source.get("width"), DEFAULT_WINDOW_WIDTH).max(1.0),
        height: as_number(source.get("height"), DEFAULT_WINDOW_HEIGHT).max(1.0),
        monitor,
    })
}

fn sanitize_window_state(value: &Value) -> Option<CachedWindowState> {
    let source = value.as_object()?;
    let window_id = as_string(source.get("windowId"));
    let note_id = as_string(source.get("noteId"));
    let note_path = as_string(source.get("notePath"));
    if window_id.is_empty() || note_id.is_empty() || note_path.is_empty() {
        return None;
    }
    if RESERVED_WINDOW_IDS.contains(&window_id.as_str()) {
        return None;
    }
    let updated_at = {
        let value = as_string(source.get("updatedAt"));
        if value.is_empty() {
            timestamp_now()
        } else {
            value
        }
    };
    Some(CachedWindowState {
        window_id,
        note_id,
        note_path,
        visibility: if as_string(source.get("visibility")) == "hidden" {
            WindowVisibility::Hidden
        } else {
            WindowVisibility::Visible
        },
        always_on_top: as_bool(source.get("alwaysOnTop"), false),
        read_only: as_bool(source.get("readOnly"), false),
        opacity: as_number(source.get("opacity"), 1.0).clamp(NOTE_OPACITY_MIN, NOTE_OPACITY_MAX),
        scroll_top: as_number(source.get("scrollTop"), 0.0).max(NOTE_SCROLL_TOP_MIN),
        bounds: sanitize_bounds(source.get("bounds"))?,
        updated_at,
    })
}

fn sanitize_cache(value: Value) -> Result<WindowStateCache, String> {
    let Some(source) = value.as_object() else {
        return Err(String::from("Invalid window state cache"));
    };
    let version = source
        .get("version")
        .and_then(Value::as_u64)
        .and_then(|value| u32::try_from(value).ok())
        .unwrap_or_default();
    if version != CACHE_VERSION {
        return Err(String::from("Unsupported window state cache version"));
    }

    let mut windows: HashMap<String, CachedWindowState> = HashMap::new();
    let mut key_mapping = HashMap::new();
    if let Some(windows_source) = source.get("windows").and_then(Value::as_object) {
        for (old_key, item) in windows_source {
            if item
                .get("windowId")
                .and_then(Value::as_str)
                .is_some_and(|label| RESERVED_WINDOW_IDS.contains(&label))
            {
                continue;
            }
            let parsed = sanitize_window_state(item)
                .ok_or_else(|| format!("Invalid window state entry: {old_key:?}"))?;
            let cache_key = build_note_cache_key(&parsed.note_path);
            key_mapping.insert(old_key.clone(), cache_key.clone());
            match windows.get(&cache_key) {
                Some(previous)
                    if compare_updated_at(&parsed.updated_at, &previous.updated_at)
                        == std::cmp::Ordering::Less => {}
                _ => {
                    windows.insert(cache_key, parsed);
                }
            }
        }
    }

    let resolve_key = |item: &Value| {
        let key = as_string(Some(item));
        key_mapping.get(&key).cloned().unwrap_or(key)
    };
    let existing_ids = windows.keys().cloned().collect::<HashSet<_>>();
    let existing_window_ids = windows
        .values()
        .map(|state| state.window_id.clone())
        .collect::<HashSet<_>>();

    let mut window_order = Vec::new();
    let mut seen_order: HashSet<String> = HashSet::new();
    if let Some(order_source) = source.get("windowOrder").and_then(Value::as_array) {
        for item in order_source {
            let key = resolve_key(item);
            if key.is_empty() || !existing_ids.contains(&key) || !seen_order.insert(key.clone()) {
                continue;
            }
            window_order.push(key);
        }
    }
    for key in &existing_ids {
        if seen_order.contains(key) {
            continue;
        }
        window_order.push(key.clone());
    }

    let mut hidden_stack = Vec::new();
    if let Some(hidden_source) = source.get("hiddenStack").and_then(Value::as_array) {
        for item in hidden_source {
            let key = resolve_key(item);
            if key.is_empty() || !existing_ids.contains(&key) {
                continue;
            }
            let Some(state) = windows.get(&key) else {
                continue;
            };
            if state.visibility != WindowVisibility::Hidden {
                continue;
            }
            hidden_stack.push(key);
        }
    }

    let mut visible_window_toggle_snapshot = Vec::new();
    let mut seen_snapshot = HashSet::new();
    if let Some(snapshot_source) = source
        .get("visibleWindowToggleSnapshot")
        .and_then(Value::as_array)
    {
        for item in snapshot_source {
            let label = item
                .as_str()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToOwned::to_owned)
                .unwrap_or_default();
            if label.is_empty()
                || !existing_window_ids.contains(&label)
                || !seen_snapshot.insert(label.clone())
            {
                continue;
            }
            visible_window_toggle_snapshot.push(label);
        }
    }

    let updated_at = {
        let value = as_string(source.get("updatedAt"));
        if value.is_empty() {
            timestamp_now()
        } else {
            value
        }
    };

    Ok(WindowStateCache {
        version: CACHE_VERSION,
        updated_at,
        windows,
        window_order,
        hidden_stack,
        visible_window_toggle_snapshot,
    })
}

fn read_cache(app: &tauri::AppHandle) -> Result<WindowStateCache, String> {
    app.state::<crate::document::DocumentService>().cache.read()
}

fn mutate_cache<T>(
    app: &tauri::AppHandle,
    update: impl FnOnce(&mut WindowStateCache) -> T,
) -> Result<T, String> {
    app.state::<crate::document::DocumentService>()
        .cache
        .mutate(update)
}

fn resolve_cache_key_by_window_id(cache: &WindowStateCache, window_id: &str) -> Option<String> {
    let target = window_id.trim();
    if target.is_empty() {
        return None;
    }
    if cache.windows.contains_key(target) {
        return Some(target.to_string());
    }
    cache.windows.iter().find_map(|(cache_key, state)| {
        if state.window_id == target {
            Some(cache_key.clone())
        } else {
            None
        }
    })
}

fn set_window_order(cache: &mut WindowStateCache, cache_key: &str) {
    if cache.window_order.iter().any(|item| item == cache_key) {
        return;
    }
    cache.window_order.push(cache_key.to_string());
}

fn set_hidden_stack(cache: &mut WindowStateCache, cache_key: &str, push_hidden_to_top: bool) {
    let already_hidden = cache.hidden_stack.iter().any(|item| item == cache_key);
    if already_hidden && !push_hidden_to_top {
        return;
    }
    cache.hidden_stack.retain(|item| item != cache_key);
    cache.hidden_stack.push(cache_key.to_string());
}

fn clear_hidden_stack(cache: &mut WindowStateCache, cache_key: &str) {
    cache.hidden_stack.retain(|item| item != cache_key);
}

pub fn load_windows_for_startup(app: &tauri::AppHandle) -> Result<Vec<CachedWindowState>, String> {
    let cache = read_cache(app)?;
    let mut ordered = Vec::new();
    for cache_key in &cache.window_order {
        let Some(state) = cache.windows.get(cache_key) else {
            continue;
        };
        ordered.push(state.clone());
    }
    Ok(ordered)
}

pub fn get_window_state(
    app: &tauri::AppHandle,
    window_id: &str,
) -> Result<Option<CachedWindowState>, String> {
    let cache = read_cache(app)?;
    let Some(cache_key) = resolve_cache_key_by_window_id(&cache, window_id) else {
        return Ok(None);
    };
    Ok(cache.windows.get(&cache_key).cloned())
}

pub fn get_window_state_by_note_path(
    app: &tauri::AppHandle,
    note_path: &str,
) -> Result<Option<CachedWindowState>, String> {
    let cache = read_cache(app)?;
    Ok(cache.windows.get(&build_note_cache_key(note_path)).cloned())
}

pub fn get_most_recent_hidden_window_state(
    app: &tauri::AppHandle,
) -> Result<Option<CachedWindowState>, String> {
    let cache = read_cache(app)?;
    for cache_key in cache.hidden_stack.iter().rev() {
        let Some(state) = cache.windows.get(cache_key) else {
            continue;
        };
        if state.visibility != WindowVisibility::Hidden {
            continue;
        }
        return Ok(Some(state.clone()));
    }
    Ok(None)
}

pub fn list_hidden_window_ids(app: &tauri::AppHandle) -> Result<Vec<String>, String> {
    let cache = read_cache(app)?;
    let mut labels = Vec::new();
    let mut seen = HashSet::new();
    for cache_key in &cache.hidden_stack {
        let Some(state) = cache.windows.get(cache_key) else {
            continue;
        };
        if state.visibility != WindowVisibility::Hidden {
            continue;
        }
        if !seen.insert(state.window_id.clone()) {
            continue;
        }
        labels.push(state.window_id.clone());
    }
    for state in cache.windows.values() {
        if state.visibility != WindowVisibility::Hidden {
            continue;
        }
        if !seen.insert(state.window_id.clone()) {
            continue;
        }
        labels.push(state.window_id.clone());
    }
    Ok(labels)
}

pub fn list_visible_window_toggle_snapshot(app: &tauri::AppHandle) -> Result<Vec<String>, String> {
    let cache = read_cache(app)?;
    Ok(cache.visible_window_toggle_snapshot.clone())
}

pub fn set_visible_window_toggle_snapshot(
    app: &tauri::AppHandle,
    window_labels: &[String],
) -> Result<(), String> {
    mutate_cache(app, |cache| {
        let now = timestamp_now();
        let mut snapshot = Vec::new();
        let mut seen = HashSet::new();
        for window_label in window_labels {
            let normalized = window_label.trim();
            if normalized.is_empty() || !seen.insert(normalized.to_string()) {
                continue;
            }
            snapshot.push(normalized.to_string());
        }
        cache.visible_window_toggle_snapshot = snapshot;
        cache.updated_at = now;
    })
}

pub fn clear_visible_window_toggle_snapshot(app: &tauri::AppHandle) -> Result<(), String> {
    mutate_cache(app, |cache| {
        let now = timestamp_now();
        cache.visible_window_toggle_snapshot.clear();
        cache.updated_at = now;
    })
}

fn apply_upsert_window_state(
    cache: &mut WindowStateCache,
    state: CachedWindowState,
    options: &UpdateWindowStateOptions,
    now: &str,
) {
    let mut next_state = CachedWindowState {
        updated_at: if state.updated_at.trim().is_empty() {
            now.to_string()
        } else {
            state.updated_at.trim().to_string()
        },
        opacity: state.opacity.clamp(NOTE_OPACITY_MIN, NOTE_OPACITY_MAX),
        scroll_top: state.scroll_top.max(NOTE_SCROLL_TOP_MIN),
        bounds: WindowBounds {
            width: state.bounds.width.max(1.0),
            height: state.bounds.height.max(1.0),
            ..state.bounds
        },
        window_id: state.window_id.trim().to_string(),
        note_id: state.note_id.trim().to_string(),
        note_path: state.note_path.trim().to_string(),
        visibility: state.visibility,
        always_on_top: state.always_on_top,
        read_only: state.read_only,
    };
    if next_state.window_id.is_empty()
        || next_state.note_id.is_empty()
        || next_state.note_path.is_empty()
        || RESERVED_WINDOW_IDS.contains(&next_state.window_id.as_str())
    {
        return;
    }
    let cache_key = build_note_cache_key(&next_state.note_path);
    if options.preserve_hidden_visibility.unwrap_or(false)
        && next_state.visibility == WindowVisibility::Visible
        && cache
            .windows
            .get(&cache_key)
            .is_some_and(|existing| existing.visibility == WindowVisibility::Hidden)
    {
        next_state.visibility = WindowVisibility::Hidden;
    }
    cache.windows.insert(cache_key.clone(), next_state.clone());
    set_window_order(cache, &cache_key);
    if next_state.visibility == WindowVisibility::Hidden {
        set_hidden_stack(
            cache,
            &cache_key,
            options.push_hidden_to_top.unwrap_or(false),
        );
    } else {
        clear_hidden_stack(cache, &cache_key);
    }
    cache.updated_at = now.to_string();
}

pub fn register_window(
    app: &tauri::AppHandle,
    previous: Option<&CachedWindowState>,
    state: CachedWindowState,
) -> Result<(), String> {
    mutate_cache(app, |cache| {
        if let Some(previous) = previous {
            let old_key = build_note_cache_key(&previous.note_path);
            let new_key = build_note_cache_key(&state.note_path);
            if old_key != new_key {
                cache.windows.remove(&old_key);
                for keys in [&mut cache.window_order, &mut cache.hidden_stack] {
                    for key in keys.iter_mut() {
                        if *key == old_key {
                            *key = new_key.clone();
                        }
                    }
                    let mut seen = HashSet::new();
                    keys.retain(|key| seen.insert(key.clone()));
                }
            }
            for label in &mut cache.visible_window_toggle_snapshot {
                if *label == previous.window_id {
                    *label = state.window_id.clone();
                }
            }
            let mut seen = HashSet::new();
            cache
                .visible_window_toggle_snapshot
                .retain(|label| seen.insert(label.clone()));
        }
        apply_upsert_window_state(
            cache,
            state,
            &UpdateWindowStateOptions::default(),
            &timestamp_now(),
        );
    })
}

pub fn upsert_window_state(
    app: &tauri::AppHandle,
    state: CachedWindowState,
    options: UpdateWindowStateOptions,
) -> Result<(), String> {
    mutate_cache(app, |cache| {
        let now = timestamp_now();
        apply_upsert_window_state(cache, state, &options, &now);
    })
}

pub fn set_window_bounds(
    app: &tauri::AppHandle,
    window_id: &str,
    bounds: WindowBounds,
) -> Result<(), String> {
    mutate_cache(app, |cache| {
        let Some(cache_key) = resolve_cache_key_by_window_id(cache, window_id) else {
            return;
        };
        let now = timestamp_now();
        {
            let Some(state) = cache.windows.get_mut(&cache_key) else {
                return;
            };
            state.bounds = WindowBounds {
                width: bounds.width.max(1.0),
                height: bounds.height.max(1.0),
                ..bounds
            };
            state.updated_at = now.clone();
        }
        cache.updated_at = now;
    })
}

pub fn set_window_visibility(
    app: &tauri::AppHandle,
    window_id: &str,
    visibility: WindowVisibility,
    options: UpdateWindowStateOptions,
) -> Result<(), String> {
    mutate_cache(app, |cache| {
        let Some(cache_key) = resolve_cache_key_by_window_id(cache, window_id) else {
            return;
        };
        let now = timestamp_now();
        {
            let Some(state) = cache.windows.get_mut(&cache_key) else {
                return;
            };
            state.visibility = visibility;
            state.updated_at = now.clone();
        }
        if visibility == WindowVisibility::Hidden {
            set_hidden_stack(
                cache,
                &cache_key,
                options.push_hidden_to_top.unwrap_or(false),
            );
        } else {
            clear_hidden_stack(cache, &cache_key);
        }
        cache.updated_at = now;
    })
}

pub fn set_window_visibility_by_labels(
    app: &tauri::AppHandle,
    window_labels: &[String],
    visibility: WindowVisibility,
    options: UpdateWindowStateOptions,
) -> Result<(), String> {
    if window_labels.is_empty() {
        return Ok(());
    }
    mutate_cache(app, |cache| {
        let now = timestamp_now();
        for window_label in window_labels {
            let Some(cache_key) = resolve_cache_key_by_window_id(cache, window_label) else {
                continue;
            };
            {
                let Some(state) = cache.windows.get_mut(&cache_key) else {
                    continue;
                };
                state.visibility = visibility;
                state.updated_at = now.clone();
            }
            if visibility == WindowVisibility::Hidden {
                set_hidden_stack(
                    cache,
                    &cache_key,
                    options.push_hidden_to_top.unwrap_or(false),
                );
            } else {
                clear_hidden_stack(cache, &cache_key);
            }
        }
        cache.updated_at = now;
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_state(visibility: WindowVisibility) -> CachedWindowState {
        CachedWindowState {
            window_id: String::from("note-test"),
            note_id: String::from("test-note"),
            note_path: String::from("C:\\notes\\test.md"),
            visibility,
            always_on_top: false,
            read_only: false,
            opacity: 1.0,
            scroll_top: 0.0,
            bounds: WindowBounds {
                x: 10,
                y: 20,
                width: 300.0,
                height: 400.0,
                monitor: None,
            },
            updated_at: String::new(),
        }
    }

    fn monitor(name: &str, x: i32, width: u32, height: u32, scale_factor: f64) -> MonitorArea {
        MonitorArea {
            name: String::from(name),
            x,
            y: 0,
            width,
            height,
            scale_factor,
        }
    }

    fn bounds_on(monitor: &MonitorArea, x: i32, y: i32) -> WindowBounds {
        WindowBounds {
            x,
            y,
            width: 200.0,
            height: 100.0,
            monitor: Some(monitor.clone()),
        }
    }

    fn placed(bounds: WindowBounds) -> (i32, i32, f64, f64) {
        (bounds.x, bounds.y, bounds.width, bounds.height)
    }

    #[test]
    fn unchanged_monitor_keeps_the_exact_bounds() {
        let laptop = monitor("DISPLAY1", 0, 2560, 1400, 1.25);
        let bounds = bounds_on(&laptop, 37, 51);
        assert_eq!(
            placed(restore_bounds(
                &bounds,
                std::slice::from_ref(&laptop),
                Some(&laptop)
            )),
            (37, 51, 200.0, 100.0)
        );
    }

    #[test]
    fn centered_window_keeps_its_share_of_another_monitor() {
        let external = monitor("DISPLAY2", 2560, 3840, 2400, 2.0);
        let laptop = monitor("DISPLAY1", 0, 2560, 1600, 1.25);
        let bounds = bounds_on(&external, 2560 + 1920 - 200, 1200 - 100);
        assert_eq!(
            placed(restore_bounds(
                &bounds,
                std::slice::from_ref(&laptop),
                Some(&laptop)
            )),
            (1147, 733, 200.0 * 2048.0 / 1920.0, 100.0 * 2048.0 / 1920.0)
        );
    }

    #[test]
    fn edge_window_stays_inside_a_smaller_monitor() {
        let external = monitor("DISPLAY2", 2560, 3840, 2000, 1.0);
        let laptop = monitor("DISPLAY1", 0, 1920, 1000, 1.0);
        let bounds = bounds_on(&external, 2560 + 3840 - 200, 2000 - 100);
        assert_eq!(
            placed(restore_bounds(
                &bounds,
                std::slice::from_ref(&laptop),
                Some(&laptop)
            )),
            (1820, 950, 100.0, 50.0)
        );
    }

    #[test]
    fn switching_back_restores_the_original_size() {
        let external = monitor("DISPLAY1", 0, 2560, 1380, 1.25);
        let laptop = monitor("DISPLAY1", 0, 2880, 1704, 2.0);
        let original = bounds_on(&external, 1700, 480);
        let on_laptop = WindowBounds {
            monitor: Some(laptop.clone()),
            ..restore_bounds(&original, std::slice::from_ref(&laptop), Some(&laptop))
        };
        let back = restore_bounds(&on_laptop, std::slice::from_ref(&external), Some(&external));
        assert!((back.width - original.width).abs() < 1e-9);
        assert!((back.height - original.height).abs() < 1e-9);
        assert!((back.x - original.x).abs() <= 1);
        assert!((back.y - original.y).abs() <= 1);
    }

    #[test]
    fn resized_monitor_with_the_same_name_is_reused() {
        let before = monitor("DISPLAY2", 1920, 1920, 1000, 1.0);
        let after = monitor("DISPLAY2", 1920, 3840, 2000, 1.0);
        let laptop = monitor("DISPLAY1", 0, 1920, 1000, 1.0);
        let bounds = bounds_on(&before, 1920 + 860, 450);
        assert_eq!(
            placed(restore_bounds(
                &bounds,
                &[laptop.clone(), after],
                Some(&laptop)
            )),
            (1920 + 1720, 900, 400.0, 200.0)
        );
    }

    #[test]
    fn physical_sizes_are_converted_with_the_monitor_under_the_window() {
        let directory = crate::storage::test_directory();
        let path = directory.path().join("windows.json");
        let original = br#"{"version":1,"windows":{"entry":{"windowId":"note-test","noteId":"test-note","notePath":"C:\\notes\\test.md","bounds":{"x":2700,"y":100,"width":600,"height":800}},"other":{"windowId":"note-other","noteId":"other-note","notePath":"C:\\notes\\other.md","bounds":{"x":-5000,"y":100,"width":500,"height":250}}}}"#;
        fs::write(&path, original).unwrap();
        let laptop = monitor("DISPLAY1", 0, 2048, 1100, 1.25);
        let external = monitor("DISPLAY2", 2048, 3840, 2100, 2.0);
        let store = WindowStateStore::new(path.clone());
        assert!(
            store
                .migrate_physical_sizes(&[laptop.clone(), external.clone()], Some(&laptop))
                .unwrap()
        );
        assert!(
            !store
                .migrate_physical_sizes(&[laptop.clone(), external.clone()], Some(&laptop))
                .unwrap()
        );
        let cache = store.read().unwrap();
        let entry = &cache.windows[&build_note_cache_key("C:\\notes\\test.md")].bounds;
        assert_eq!((entry.x, entry.width, entry.height), (2700, 300.0, 400.0));
        assert_eq!(entry.monitor.as_ref(), Some(&external));
        let other = &cache.windows[&build_note_cache_key("C:\\notes\\other.md")].bounds;
        assert_eq!((other.width, other.height), (400.0, 200.0));
        assert_eq!(other.monitor.as_ref(), Some(&laptop));
    }

    #[test]
    fn invalid_entries_preserve_the_original_cache() {
        let directory = crate::storage::test_directory();
        let path = directory.path().join("windows.json");
        let original = br#"{"version":2,"windows":{"entry":{"windowId":"note-test"}}}"#;
        fs::write(&path, original).unwrap();
        let store = WindowStateStore::new(path.clone());
        assert!(store.read().is_err());
        assert!(store.remove_windows(&["note-test".into()]).is_err());
        assert_eq!(fs::read(path).unwrap(), original);
    }

    #[test]
    fn implicit_visible_upsert_preserves_existing_hidden_visibility() {
        let mut cache = build_empty_cache();
        let cache_key = build_note_cache_key("C:\\notes\\test.md");

        apply_upsert_window_state(
            &mut cache,
            test_state(WindowVisibility::Hidden),
            &UpdateWindowStateOptions {
                push_hidden_to_top: Some(true),
                preserve_hidden_visibility: None,
            },
            "1",
        );
        apply_upsert_window_state(
            &mut cache,
            test_state(WindowVisibility::Visible),
            &UpdateWindowStateOptions {
                push_hidden_to_top: None,
                preserve_hidden_visibility: Some(true),
            },
            "2",
        );

        let state = cache.windows.get(&cache_key).expect("state should exist");
        assert_eq!(state.visibility, WindowVisibility::Hidden);
        assert_eq!(cache.hidden_stack, vec![cache_key]);
    }

    #[test]
    fn explicit_visible_upsert_clears_existing_hidden_visibility() {
        let mut cache = build_empty_cache();
        let cache_key = build_note_cache_key("C:\\notes\\test.md");

        apply_upsert_window_state(
            &mut cache,
            test_state(WindowVisibility::Hidden),
            &UpdateWindowStateOptions {
                push_hidden_to_top: Some(true),
                preserve_hidden_visibility: None,
            },
            "1",
        );
        apply_upsert_window_state(
            &mut cache,
            test_state(WindowVisibility::Visible),
            &UpdateWindowStateOptions::default(),
            "2",
        );

        let state = cache.windows.get(&cache_key).expect("state should exist");
        assert_eq!(state.visibility, WindowVisibility::Visible);
        assert!(cache.hidden_stack.is_empty());
    }
}
