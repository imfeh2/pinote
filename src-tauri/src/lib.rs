mod locale;
mod note_history;
mod shortcut;
mod tray;
mod window;
mod window_state;

use log::{Level, LevelFilter, error, info};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    fs::File,
    io::Write,
    path::{Path, PathBuf},
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{Manager, PhysicalPosition, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tauri_plugin_log::{RotationStrategy, Target, TargetKind};
use uuid::Uuid;
#[cfg(target_os = "windows")]
use winreg::{
    RegKey,
    enums::{HKEY_CURRENT_USER, KEY_READ, KEY_WRITE},
};
use zip::{CompressionMethod, ZipWriter, write::SimpleFileOptions};

const NOTE_WINDOW_PREFIX: &str = "note-";
const NOTE_WINDOW_WIDTH: f64 = 400.0;
const NOTE_WINDOW_HEIGHT: f64 = 500.0;
const NEW_NOTE_WINDOW_WIDTH: f64 = 360.0;
const NEW_NOTE_WINDOW_HEIGHT: f64 = 440.0;
const NOTE_WINDOW_MIN_WIDTH: f64 = 1.0;
const NOTE_WINDOW_MIN_HEIGHT: f64 = 1.0;
const EXISTING_WINDOW_SHAKE_OFFSETS: [i32; 8] = [0, 14, -12, 10, -8, 6, -4, 0];
const EXISTING_WINDOW_SHAKE_DELAY_MS: u64 = 14;
const SETTINGS_FILE_NAME: &str = "settings.json";
const DEFAULT_NOTE_DIRECTORY_NAME: &str = "notes";
const DEFAULT_HIDE_NOTE_WINDOWS_FROM_TASKBAR: bool = true;
const LOGS_DIRECTORY_NAME: &str = "logs";
const LOG_FILE_NAME: &str = "pinote";
#[cfg(target_os = "windows")]
const OPEN_WITH_PINOTE_MENU_KEY: &str = "OpenWithPinote";
#[cfg(target_os = "windows")]
const OPEN_WITH_PINOTE_EXTENSIONS: [&str; 2] = [".md", ".markdown"];
#[cfg(target_os = "windows")]
const PINOTE_MARKDOWN_PROG_ID: &str = "Pinote.Markdown";

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CliOpenNoteRequest {
    note_path: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DiagnosticReportExport {
    destination_path: String,
    log_file_count: usize,
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct StoredSettings {
    language: Option<String>,
    hide_note_windows_from_taskbar: Option<bool>,
    new_note_directory: Option<String>,
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct OpenNoteWindowOptions {
    window_id: Option<String>,
    note_path: Option<String>,
    visibility: Option<window_state::WindowVisibility>,
    focus: Option<bool>,
    always_on_top: Option<bool>,
    read_only: Option<bool>,
    opacity: Option<f64>,
    scroll_top: Option<f64>,
    bounds: Option<window_state::WindowBounds>,
    skip_taskbar: Option<bool>,
    center_on_create: Option<bool>,
}

fn is_markdown_file_path(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| {
            extension.eq_ignore_ascii_case("md") || extension.eq_ignore_ascii_case("markdown")
        })
}

#[cfg(target_os = "windows")]
fn normalize_windows_cli_note_path(path: PathBuf) -> PathBuf {
    use std::path::{Component, Prefix};
    let mut components = path.components();
    let Some(Component::Prefix(prefix_component)) = components.next() else {
        return path;
    };
    match prefix_component.kind() {
        Prefix::VerbatimDisk(letter) => {
            let mut normalized = PathBuf::from(format!("{}:\\", char::from(letter)));
            for component in components {
                if matches!(component, Component::RootDir) {
                    continue;
                }
                normalized.push(component.as_os_str());
            }
            normalized
        }
        Prefix::VerbatimUNC(server, share) => {
            let mut normalized = PathBuf::from(r"\\");
            normalized.push(server);
            normalized.push(share);
            for component in components {
                if matches!(component, Component::RootDir) {
                    continue;
                }
                normalized.push(component.as_os_str());
            }
            normalized
        }
        _ => path,
    }
}

#[cfg(not(target_os = "windows"))]
fn normalize_windows_cli_note_path(path: PathBuf) -> PathBuf {
    path
}

fn resolve_cli_note_path(raw_path: &str, cwd: Option<&Path>) -> Option<String> {
    let trimmed = raw_path.trim();
    if trimmed.is_empty() {
        return None;
    }
    if trimmed.starts_with('-') {
        return None;
    }
    let path = PathBuf::from(trimmed);
    if !is_markdown_file_path(&path) {
        return None;
    }
    let resolved = if path.is_absolute() {
        path
    } else if let Some(base) = cwd {
        base.join(path)
    } else {
        path
    };
    let normalized = match resolved.canonicalize() {
        Ok(path) => path,
        Err(_) => resolved,
    };
    let normalized = normalize_windows_cli_note_path(normalized);
    Some(normalized.to_string_lossy().into_owned())
}

fn parse_cli_open_note_requests(argv: &[String], cwd: Option<&str>) -> Vec<CliOpenNoteRequest> {
    let cwd_path = cwd.and_then(|value| {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(PathBuf::from(trimmed))
        }
    });
    let mut seen = HashSet::new();
    let mut requests = Vec::new();
    for arg in argv {
        let Some(note_path) = resolve_cli_note_path(arg, cwd_path.as_deref()) else {
            continue;
        };
        let dedupe_key = note_path.to_lowercase();
        if !seen.insert(dedupe_key) {
            continue;
        }
        requests.push(CliOpenNoteRequest { note_path });
    }
    requests
}

fn hash_fnv1a_utf16(value: &str) -> String {
    let mut hash: u32 = 0x811c9dc5;
    for code_unit in value.encode_utf16() {
        hash ^= code_unit as u32;
        hash = hash.wrapping_mul(0x01000193);
    }
    format!("{hash:08x}")
}

fn build_note_window_id(note_path: &str) -> String {
    let normalized = note_path.trim().to_lowercase();
    format!("{NOTE_WINDOW_PREFIX}{}", hash_fnv1a_utf16(&normalized))
}

fn extract_note_id_from_path(note_path: &str) -> String {
    Path::new(note_path)
        .file_stem()
        .and_then(|value| value.to_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| Uuid::new_v4().to_string())
}

fn encode_query_component(value: &str) -> String {
    let mut encoded = String::new();
    for byte in value.bytes() {
        let is_unreserved =
            byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'~');
        if is_unreserved {
            encoded.push(char::from(byte));
            continue;
        }
        encoded.push('%');
        encoded.push_str(&format!("{byte:02X}"));
    }
    encoded
}

fn build_note_window_url(
    window_id: &str,
    note_id: Option<&str>,
    note_path: &str,
    note_opacity: Option<f64>,
) -> String {
    let encoded_window_id = encode_query_component(window_id);
    let encoded_note_path = encode_query_component(note_path);
    let mut url =
        format!("index.html?view=note&windowId={encoded_window_id}&notePath={encoded_note_path}");
    if let Some(note_id) = note_id.map(str::trim).filter(|value| !value.is_empty()) {
        let encoded_note_id = encode_query_component(note_id);
        url.push_str("&noteId=");
        url.push_str(&encoded_note_id);
    }
    if let Some(opacity) = note_opacity
        && opacity.is_finite()
    {
        let opacity_value = opacity.clamp(0.0, 1.0);
        let encoded_note_opacity = encode_query_component(&opacity_value.to_string());
        url.push_str("&noteOpacity=");
        url.push_str(&encoded_note_opacity);
    }
    url
}

fn clamp_note_opacity(value: Option<f64>) -> f64 {
    value.unwrap_or(1.0).clamp(0.0, 1.0)
}

fn clamp_note_scroll_top(value: Option<f64>) -> f64 {
    value.unwrap_or(0.0).max(0.0)
}

fn capture_note_window_state(
    window: &WebviewWindow,
    note_id: &str,
    note_path: &str,
    read_only: bool,
    opacity: f64,
    scroll_top: f64,
) -> Result<window_state::CachedWindowState, String> {
    let position = window
        .outer_position()
        .map_err(|error| format!("Failed to read window position: {error}"))?;
    let size = window
        .inner_size()
        .map_err(|error| format!("Failed to read window size: {error}"))?;
    let always_on_top = window
        .is_always_on_top()
        .map_err(|error| format!("Failed to read always-on-top state: {error}"))?;
    let visible = window
        .is_visible()
        .map_err(|error| format!("Failed to read window visibility: {error}"))?;
    Ok(window_state::CachedWindowState {
        window_id: window.label().to_string(),
        note_id: note_id.to_string(),
        note_path: note_path.to_string(),
        visibility: if visible {
            window_state::WindowVisibility::Visible
        } else {
            window_state::WindowVisibility::Hidden
        },
        always_on_top,
        read_only,
        opacity,
        scroll_top,
        bounds: window_state::WindowBounds {
            x: position.x,
            y: position.y,
            width: f64::from(size.width),
            height: f64::from(size.height),
        },
        updated_at: String::new(),
    })
}

fn level_allowed_for_filter(level: Level, minimum: LevelFilter) -> bool {
    match minimum {
        LevelFilter::Off => false,
        LevelFilter::Error => matches!(level, Level::Error),
        LevelFilter::Warn => matches!(level, Level::Error | Level::Warn),
        LevelFilter::Info => matches!(level, Level::Error | Level::Warn | Level::Info),
        LevelFilter::Debug => {
            matches!(
                level,
                Level::Error | Level::Warn | Level::Info | Level::Debug
            )
        }
        LevelFilter::Trace => true,
    }
}

fn collect_system_environment(app: &tauri::AppHandle) -> serde_json::Value {
    let monitors = app
        .available_monitors()
        .map(|monitors| {
            monitors
                .iter()
                .map(|monitor| {
                    serde_json::json!({
                        "name": monitor.name(),
                        "position": [monitor.position().x, monitor.position().y],
                        "size": [monitor.size().width, monitor.size().height],
                        "scaleFactor": monitor.scale_factor(),
                    })
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let primary_monitor = app.primary_monitor().ok().flatten().map(|monitor| {
        serde_json::json!({
            "name": monitor.name(),
            "position": [monitor.position().x, monitor.position().y],
            "size": [monitor.size().width, monitor.size().height],
            "scaleFactor": monitor.scale_factor(),
        })
    });
    serde_json::json!({
        "osVersion": tauri_plugin_os::version().to_string(),
        "webview2Version": tauri::webview_version().unwrap_or_else(|_| String::from("unknown")),
        "monitors": monitors,
        "primaryMonitor": primary_monitor,
    })
}

fn current_unix_timestamp_seconds() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or_default()
}

fn list_diagnostic_log_files(logs_dir: &Path) -> Result<Vec<PathBuf>, String> {
    if !logs_dir.exists() {
        return Ok(Vec::new());
    }
    let mut log_files = Vec::new();
    let entries = std::fs::read_dir(logs_dir)
        .map_err(|error| format!("Could not read diagnostic files: {error}"))?;
    for entry in entries {
        let entry = entry.map_err(|error| format!("Could not read diagnostic file: {error}"))?;
        let file_type = entry
            .file_type()
            .map_err(|error| format!("Could not inspect diagnostic file: {error}"))?;
        if file_type.is_file() {
            log_files.push(entry.path());
        }
    }
    log_files.sort_by(|a, b| a.file_name().cmp(&b.file_name()));
    Ok(log_files)
}

fn zip_file_name(path: &Path) -> Option<String> {
    path.file_name()
        .map(|file_name| format!("logs/{}", file_name.to_string_lossy()))
}

fn add_bytes_to_diagnostic_zip(
    zip: &mut ZipWriter<File>,
    entry_name: &str,
    bytes: &[u8],
    options: SimpleFileOptions,
) -> Result<(), String> {
    zip.start_file(entry_name, options)
        .map_err(|error| format!("Could not write diagnostic report entry: {error}"))?;
    zip.write_all(bytes)
        .map_err(|error| format!("Could not write diagnostic report entry: {error}"))
}

fn add_file_to_diagnostic_zip(
    zip: &mut ZipWriter<File>,
    source_path: &Path,
    entry_name: &str,
    options: SimpleFileOptions,
) -> Result<(), String> {
    zip.start_file(entry_name, options)
        .map_err(|error| format!("Could not write diagnostic report entry: {error}"))?;
    let mut source = File::open(source_path)
        .map_err(|error| format!("Could not read diagnostic file: {error}"))?;
    std::io::copy(&mut source, zip)
        .map_err(|error| format!("Could not write diagnostic file: {error}"))?;
    Ok(())
}

fn export_diagnostic_report_to_path(
    app: &tauri::AppHandle,
    destination_path: &Path,
) -> Result<DiagnosticReportExport, String> {
    if destination_path.as_os_str().is_empty() {
        return Err(String::from("Choose where to save the report."));
    }
    if let Some(parent) = destination_path.parent()
        && !parent.as_os_str().is_empty()
    {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("Could not prepare the report location: {error}"))?;
    }
    let logs_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Could not locate diagnostic files: {error}"))?
        .join(LOGS_DIRECTORY_NAME);
    let log_files = list_diagnostic_log_files(&logs_dir)?;
    let destination = File::create(destination_path)
        .map_err(|error| format!("Could not create diagnostic report: {error}"))?;
    let mut zip = ZipWriter::new(destination);
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
    let system_environment = collect_system_environment(app);
    let metadata = serde_json::json!({
        "schemaVersion": 2,
        "appName": "Pinote",
        "appVersion": app.package_info().version.to_string(),
        "platform": std::env::consts::OS,
        "arch": std::env::consts::ARCH,
        "osVersion": system_environment["osVersion"],
        "webview2Version": system_environment["webview2Version"],
        "monitors": system_environment["monitors"],
        "primaryMonitor": system_environment["primaryMonitor"],
        "generatedAtUnixSeconds": current_unix_timestamp_seconds(),
        "logFileCount": log_files.len(),
    });
    let metadata_bytes = serde_json::to_vec_pretty(&metadata)
        .map_err(|error| format!("Could not prepare diagnostic metadata: {error}"))?;
    add_bytes_to_diagnostic_zip(&mut zip, "metadata.json", &metadata_bytes, options)?;
    if log_files.is_empty() {
        add_bytes_to_diagnostic_zip(
            &mut zip,
            "logs/README.txt",
            b"No log files were found.\n",
            options,
        )?;
    } else {
        for log_file in &log_files {
            if let Some(entry_name) = zip_file_name(log_file) {
                add_file_to_diagnostic_zip(&mut zip, log_file, &entry_name, options)?;
            }
        }
    }
    zip.finish()
        .map_err(|error| format!("Could not finish diagnostic report: {error}"))?;
    Ok(DiagnosticReportExport {
        destination_path: destination_path.to_string_lossy().into_owned(),
        log_file_count: log_files.len(),
    })
}

fn load_stored_settings(app: &tauri::AppHandle) -> StoredSettings {
    let path = match app.path().app_data_dir() {
        Ok(dir) => dir.join(SETTINGS_FILE_NAME),
        Err(_) => return StoredSettings::default(),
    };
    let content = match std::fs::read_to_string(path) {
        Ok(value) => value,
        Err(_) => return StoredSettings::default(),
    };
    serde_json::from_str(&content).unwrap_or_default()
}

fn load_hide_note_windows_from_taskbar(app: &tauri::AppHandle) -> bool {
    load_stored_settings(app)
        .hide_note_windows_from_taskbar
        .unwrap_or(DEFAULT_HIDE_NOTE_WINDOWS_FROM_TASKBAR)
}

fn resolve_managed_notes_directory(app: &tauri::AppHandle) -> Option<PathBuf> {
    let settings = load_stored_settings(app);
    if let Some(custom) = settings.new_note_directory {
        let trimmed = custom.trim();
        if !trimmed.is_empty() {
            return Some(PathBuf::from(trimmed));
        }
    }
    app.path()
        .app_data_dir()
        .ok()
        .map(|dir| dir.join(DEFAULT_NOTE_DIRECTORY_NAME))
}

fn create_startup_note_file(app: &tauri::AppHandle) -> Option<String> {
    let notes_dir = resolve_managed_notes_directory(app)?;
    if std::fs::create_dir_all(&notes_dir).is_err() {
        return None;
    }
    let note_id = Uuid::new_v4().to_string();
    let note_path = notes_dir.join(format!("{note_id}.md"));
    if !note_path.exists() && std::fs::write(&note_path, "").is_err() {
        return None;
    }
    Some(note_path.to_string_lossy().into_owned())
}

fn load_cached_windows_for_startup(app: &tauri::AppHandle) -> Vec<window_state::CachedWindowState> {
    window_state::load_windows_for_startup(app).unwrap_or_default()
}

fn restore_cached_note_windows(app: &tauri::AppHandle, skip_taskbar: bool) -> usize {
    let cached_windows = load_cached_windows_for_startup(app);
    if cached_windows.is_empty() {
        return 0;
    }
    let mut restored = 0usize;
    let mut last_visible_window: Option<WebviewWindow> = None;
    for cached in cached_windows {
        let window_id = cached.window_id.trim();
        let note_path = cached.note_path.trim();
        if window_id.is_empty() || note_path.is_empty() {
            continue;
        }
        let width = cached.bounds.width.max(NOTE_WINDOW_MIN_WIDTH).round();
        let height = cached.bounds.height.max(NOTE_WINDOW_MIN_HEIGHT).round();
        let position_x = cached.bounds.x;
        let position_y = cached.bounds.y;
        let visible = cached.visibility != window_state::WindowVisibility::Hidden;

        if let Some(existing) = app.get_webview_window(window_id) {
            let _ = existing.set_skip_taskbar(skip_taskbar);
            let _ = existing.set_always_on_top(cached.always_on_top);
            let _ = existing.set_size(tauri::Size::Physical(tauri::PhysicalSize::new(
                width as u32,
                height as u32,
            )));
            let _ = existing.set_position(PhysicalPosition::new(position_x, position_y));
            if visible {
                let _ = existing.show();
                last_visible_window = Some(existing);
            } else {
                let _ = existing.hide();
            }
            restored += 1;
            continue;
        }

        let url = build_note_window_url(
            window_id,
            Some(&cached.note_id),
            note_path,
            Some(cached.opacity),
        );
        let window = match WebviewWindowBuilder::new(app, window_id, WebviewUrl::App(url.into()))
            .title("Pinote")
            .inner_size(NOTE_WINDOW_WIDTH, NOTE_WINDOW_HEIGHT)
            .min_inner_size(NOTE_WINDOW_MIN_WIDTH, NOTE_WINDOW_MIN_HEIGHT)
            .decorations(false)
            .transparent(true)
            .resizable(true)
            .always_on_top(cached.always_on_top)
            .skip_taskbar(skip_taskbar)
            .visible(false)
            .build()
        {
            Ok(value) => value,
            Err(err) => {
                error!("restore_cached_window_failed window_id={window_id:?} error={err}");
                continue;
            }
        };
        let _ = window.set_size(tauri::Size::Physical(tauri::PhysicalSize::new(
            width as u32,
            height as u32,
        )));
        let _ = window.set_position(PhysicalPosition::new(position_x, position_y));
        if visible {
            let _ = window.show();
            last_visible_window = Some(window);
        } else {
            let _ = window.hide();
        }
        restored += 1;
    }
    if let Some(window) = last_visible_window {
        let _ = window.set_focus();
    }
    restored
}

fn open_cli_note_windows_on_main_thread(app: &tauri::AppHandle, requests: &[CliOpenNoteRequest]) {
    if requests.is_empty() {
        return;
    }
    let skip_taskbar = load_hide_note_windows_from_taskbar(app);
    let last_index = requests.len() - 1;
    for (index, request) in requests.iter().enumerate() {
        let note_path = request.note_path.trim();
        if note_path.is_empty() {
            continue;
        }
        let should_focus = index == last_index;
        let window_id = build_note_window_id(note_path);
        if let Some(existing) = app.get_webview_window(&window_id) {
            if let Err(err) = existing.show() {
                error!("cli_open_existing_window_show_failed window_id={window_id:?} error={err}");
                continue;
            }
            if let Err(err) = existing.set_skip_taskbar(skip_taskbar) {
                error!(
                    "cli_open_existing_window_skip_taskbar_failed window_id={window_id:?} error={err}"
                );
            }
            if should_focus {
                if let Err(err) = existing.set_focus() {
                    error!(
                        "cli_open_existing_window_focus_failed window_id={window_id:?} error={err}"
                    );
                } else {
                    shake_existing_window(&existing);
                }
            }
            continue;
        }
        let url = build_note_window_url(&window_id, None, note_path, None);
        let window = match WebviewWindowBuilder::new(app, &window_id, WebviewUrl::App(url.into()))
            .title("Pinote")
            .inner_size(NOTE_WINDOW_WIDTH, NOTE_WINDOW_HEIGHT)
            .min_inner_size(NOTE_WINDOW_MIN_WIDTH, NOTE_WINDOW_MIN_HEIGHT)
            .decorations(false)
            .transparent(true)
            .resizable(true)
            .always_on_top(false)
            .skip_taskbar(skip_taskbar)
            .visible(true)
            .build()
        {
            Ok(window) => window,
            Err(err) => {
                error!("cli_open_new_window_failed window_id={window_id:?} error={err}");
                continue;
            }
        };
        if should_focus && let Err(err) = window.set_focus() {
            error!("cli_open_new_window_focus_failed window_id={window_id:?} error={err}");
        }
    }
    let _ = window::bring_note_windows_back_on_screen(app);
}

fn shake_existing_window(window: &WebviewWindow) {
    let Ok(position) = window.outer_position() else {
        return;
    };
    let base_x = position.x;
    let base_y = position.y;
    for offset in EXISTING_WINDOW_SHAKE_OFFSETS {
        let _ = window.set_position(PhysicalPosition::new(base_x + offset, base_y));
        thread::sleep(Duration::from_millis(EXISTING_WINDOW_SHAKE_DELAY_MS));
    }
}

fn open_cli_note_windows(app: &tauri::AppHandle, requests: Vec<CliOpenNoteRequest>) {
    if requests.is_empty() {
        return;
    }
    let handle = app.clone();
    if let Err(err) = app.run_on_main_thread(move || {
        open_cli_note_windows_on_main_thread(&handle, &requests);
    }) {
        error!("cli_dispatch_main_thread_failed error={err}");
    }
}

pub(crate) fn open_new_note_window(app: &tauri::AppHandle) {
    let handle = app.clone();
    std::thread::spawn(move || {
        if let Some(note_path) = create_startup_note_file(&handle) {
            let _ = window::open_note_window(
                handle.clone(),
                extract_note_id_from_path(&note_path),
                Some(OpenNoteWindowOptions {
                    note_path: Some(note_path),
                    visibility: Some(window_state::WindowVisibility::Visible),
                    focus: Some(true),
                    always_on_top: Some(false),
                    skip_taskbar: Some(load_hide_note_windows_from_taskbar(&handle)),
                    center_on_create: Some(true),
                    ..OpenNoteWindowOptions::default()
                }),
            );
        }
    });
}

#[cfg(target_os = "windows")]
fn open_with_pinote_shell_key_path(extension: &str) -> String {
    format!(
        r"Software\Classes\SystemFileAssociations\{extension}\shell\{OPEN_WITH_PINOTE_MENU_KEY}"
    )
}

#[cfg(target_os = "windows")]
fn open_with_pinote_command(executable_path: &Path) -> String {
    let executable = executable_path.to_string_lossy().replace('"', "\\\"");
    format!("\"{executable}\" \"%1\"")
}

#[cfg(target_os = "windows")]
fn open_with_pinote_icon(executable_path: &Path) -> String {
    let executable = executable_path.to_string_lossy().replace('"', "\\\"");
    format!("\"{executable}\",0")
}

#[cfg(target_os = "windows")]
fn is_open_with_pinote_enabled() -> bool {
    let classes = RegKey::predef(HKEY_CURRENT_USER);
    OPEN_WITH_PINOTE_EXTENSIONS.iter().all(|extension| {
        let path = open_with_pinote_shell_key_path(extension);
        classes.open_subkey(path).is_ok()
    })
}

#[cfg(target_os = "windows")]
fn set_open_with_pinote_enabled_windows(
    app: &tauri::AppHandle,
    enabled: bool,
) -> Result<(), String> {
    let classes = RegKey::predef(HKEY_CURRENT_USER);
    if !enabled {
        for extension in OPEN_WITH_PINOTE_EXTENSIONS {
            let path = open_with_pinote_shell_key_path(extension);
            let _ = classes.delete_subkey_all(path);
        }
        info!("open_with_pinote_disabled");
        return Ok(());
    }

    let executable_path = std::env::current_exe()
        .map_err(|error| format!("Failed to resolve executable path: {error}"))?;
    let command = open_with_pinote_command(&executable_path);
    let icon = open_with_pinote_icon(&executable_path);
    let menu_title = locale::current_text(app).open_with_pinote;
    for extension in OPEN_WITH_PINOTE_EXTENSIONS {
        let path = open_with_pinote_shell_key_path(extension);
        let (shell_key, _) = classes
            .create_subkey(&path)
            .map_err(|error| format!("Failed to create registry key `{path}`: {error}"))?;
        shell_key
            .set_value("", &menu_title)
            .map_err(|error| format!("Failed to write registry value for `{path}`: {error}"))?;
        shell_key
            .set_value("Icon", &icon)
            .map_err(|error| format!("Failed to write icon value for `{path}`: {error}"))?;
        let (command_key, _) = shell_key
            .create_subkey("command")
            .map_err(|error| format!("Failed to create command key for `{path}`: {error}"))?;
        command_key
            .set_value("", &command)
            .map_err(|error| format!("Failed to write command value for `{path}`: {error}"))?;
    }
    info!("open_with_pinote_enabled");
    Ok(())
}

#[cfg(target_os = "windows")]
fn markdown_default_extension_key_path(extension: &str) -> String {
    format!(r"Software\Classes\{extension}")
}

#[cfg(target_os = "windows")]
fn markdown_default_prog_id_key_path() -> String {
    format!(r"Software\Classes\{PINOTE_MARKDOWN_PROG_ID}")
}

#[cfg(target_os = "windows")]
fn is_default_markdown_open_enabled_windows() -> bool {
    let classes = RegKey::predef(HKEY_CURRENT_USER);
    let prog_id_path = markdown_default_prog_id_key_path();
    if classes.open_subkey(prog_id_path).is_err() {
        return false;
    }
    OPEN_WITH_PINOTE_EXTENSIONS.iter().all(|extension| {
        let key_path = markdown_default_extension_key_path(extension);
        let Ok(extension_key) = classes.open_subkey(key_path) else {
            return false;
        };
        let prog_id = extension_key.get_value::<String, _>("").unwrap_or_default();
        prog_id.eq_ignore_ascii_case(PINOTE_MARKDOWN_PROG_ID)
    })
}

#[cfg(target_os = "windows")]
fn set_default_markdown_open_enabled_windows(
    app: &tauri::AppHandle,
    enabled: bool,
) -> Result<(), String> {
    let classes = RegKey::predef(HKEY_CURRENT_USER);
    let prog_id_path = markdown_default_prog_id_key_path();
    if !enabled {
        for extension in OPEN_WITH_PINOTE_EXTENSIONS {
            let extension_path = markdown_default_extension_key_path(extension);
            if let Ok(extension_key) =
                classes.open_subkey_with_flags(&extension_path, KEY_READ | KEY_WRITE)
            {
                let current_prog_id = extension_key.get_value::<String, _>("").unwrap_or_default();
                if current_prog_id.eq_ignore_ascii_case(PINOTE_MARKDOWN_PROG_ID) {
                    let _ = extension_key.delete_value("");
                }
                if let Ok(open_with_key) =
                    extension_key.open_subkey_with_flags("OpenWithProgids", KEY_READ | KEY_WRITE)
                {
                    let _ = open_with_key.delete_value(PINOTE_MARKDOWN_PROG_ID);
                }
            }
        }
        let _ = classes.delete_subkey_all(&prog_id_path);
        info!("default_markdown_open_disabled");
        return Ok(());
    }

    let executable_path = std::env::current_exe()
        .map_err(|error| format!("Failed to resolve executable path: {error}"))?;
    let command = open_with_pinote_command(&executable_path);
    let icon = open_with_pinote_icon(&executable_path);
    let file_type = locale::current_text(app).markdown_file_type;

    let (prog_id_key, _) = classes
        .create_subkey(&prog_id_path)
        .map_err(|error| format!("Failed to create registry key `{prog_id_path}`: {error}"))?;
    prog_id_key
        .set_value("", &file_type)
        .map_err(|error| format!("Failed to write registry value for `{prog_id_path}`: {error}"))?;
    let (icon_key, _) = prog_id_key
        .create_subkey("DefaultIcon")
        .map_err(|error| format!("Failed to create icon key for `{prog_id_path}`: {error}"))?;
    icon_key
        .set_value("", &icon)
        .map_err(|error| format!("Failed to write icon value for `{prog_id_path}`: {error}"))?;
    let (command_key, _) = prog_id_key
        .create_subkey(r"shell\open\command")
        .map_err(|error| format!("Failed to create command key for `{prog_id_path}`: {error}"))?;
    command_key
        .set_value("", &command)
        .map_err(|error| format!("Failed to write command value for `{prog_id_path}`: {error}"))?;

    for extension in OPEN_WITH_PINOTE_EXTENSIONS {
        let extension_path = markdown_default_extension_key_path(extension);
        let (extension_key, _) = classes.create_subkey(&extension_path).map_err(|error| {
            format!("Failed to create registry key `{extension_path}`: {error}")
        })?;
        extension_key
            .set_value("", &PINOTE_MARKDOWN_PROG_ID)
            .map_err(|error| {
                format!("Failed to write registry value for `{extension_path}`: {error}")
            })?;
        let (open_with_key, _) =
            extension_key
                .create_subkey("OpenWithProgids")
                .map_err(|error| {
                    format!("Failed to create OpenWithProgids for `{extension_path}`: {error}")
                })?;
        open_with_key
            .set_value(PINOTE_MARKDOWN_PROG_ID, &"")
            .map_err(|error| {
                format!("Failed to write OpenWithProgids for `{extension_path}`: {error}")
            })?;
    }
    info!("default_markdown_open_enabled");
    Ok(())
}

#[cfg(target_os = "windows")]
fn sync_windows_shell_locale(app: &tauri::AppHandle) -> Result<(), String> {
    if is_open_with_pinote_enabled() {
        set_open_with_pinote_enabled_windows(app, true)?;
    }
    if is_default_markdown_open_enabled_windows() {
        set_default_markdown_open_enabled_windows(app, true)?;
    }
    Ok(())
}

#[tauri::command]
async fn load_window_state_cache(
    app: tauri::AppHandle,
) -> Result<window_state::WindowStateCache, String> {
    window_state::load_window_state_cache(&app)
}

#[tauri::command]
async fn get_window_state(
    app: tauri::AppHandle,
    window_id: String,
) -> Result<Option<window_state::CachedWindowState>, String> {
    window_state::get_window_state(&app, &window_id)
}

#[tauri::command]
async fn get_window_state_by_note_path(
    app: tauri::AppHandle,
    note_path: String,
) -> Result<Option<window_state::CachedWindowState>, String> {
    window_state::get_window_state_by_note_path(&app, &note_path)
}

#[tauri::command]
async fn get_most_recent_hidden_window_state(
    app: tauri::AppHandle,
) -> Result<Option<window_state::CachedWindowState>, String> {
    window_state::get_most_recent_hidden_window_state(&app)
}

#[tauri::command]
async fn list_window_states_in_order(
    app: tauri::AppHandle,
) -> Result<Vec<window_state::CachedWindowState>, String> {
    window_state::list_window_states_in_order(&app)
}

#[tauri::command]
async fn upsert_window_state(
    app: tauri::AppHandle,
    state: window_state::CachedWindowState,
    options: Option<window_state::UpdateWindowStateOptions>,
) -> Result<(), String> {
    window_state::upsert_window_state(&app, state, options.unwrap_or_default())
}

#[tauri::command]
async fn set_window_visibility(
    app: tauri::AppHandle,
    window_id: String,
    visibility: window_state::WindowVisibility,
    options: Option<window_state::UpdateWindowStateOptions>,
) -> Result<(), String> {
    window_state::set_window_visibility(&app, &window_id, visibility, options.unwrap_or_default())
}

#[tauri::command]
async fn remove_window_state(app: tauri::AppHandle, window_id: String) -> Result<(), String> {
    window_state::remove_window_state(&app, &window_id)
}

#[tauri::command]
async fn show_settings_window(
    app: tauri::AppHandle,
    section: Option<String>,
) -> Result<(), String> {
    window::show_settings_window(&app, section).map_err(|error| error.to_string())
}

#[tauri::command]
async fn open_note_window(
    app: tauri::AppHandle,
    note_id: String,
    options: Option<OpenNoteWindowOptions>,
) -> Result<window_state::CachedWindowState, String> {
    window::open_note_window(app, note_id, options)
}

#[tauri::command]
async fn bring_note_windows_back_on_screen(app: tauri::AppHandle) -> Result<usize, String> {
    Ok(window::bring_note_windows_back_on_screen(&app))
}

#[tauri::command]
async fn get_open_with_pinote_enabled() -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    {
        Ok(is_open_with_pinote_enabled())
    }
    #[cfg(not(target_os = "windows"))]
    {
        Ok(false)
    }
}

#[tauri::command]
async fn set_open_with_pinote_enabled(
    app: tauri::AppHandle,
    enabled: bool,
) -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    {
        set_open_with_pinote_enabled_windows(&app, enabled)?;
        Ok(is_open_with_pinote_enabled())
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = app;
        let _ = enabled;
        Err(String::from("Only supported on Windows"))
    }
}

#[tauri::command]
async fn get_default_markdown_open_enabled() -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    {
        Ok(is_default_markdown_open_enabled_windows())
    }
    #[cfg(not(target_os = "windows"))]
    {
        Ok(false)
    }
}

#[tauri::command]
async fn set_default_markdown_open_enabled(
    app: tauri::AppHandle,
    enabled: bool,
) -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    {
        set_default_markdown_open_enabled_windows(&app, enabled)?;
        Ok(is_default_markdown_open_enabled_windows())
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = app;
        let _ = enabled;
        Err(String::from("Only supported on Windows"))
    }
}

#[tauri::command]
fn get_runtime_platform() -> &'static str {
    #[cfg(target_os = "windows")]
    {
        "windows"
    }
    #[cfg(target_os = "macos")]
    {
        "macos"
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        "other"
    }
}

#[tauri::command]
async fn export_diagnostic_report(
    app: tauri::AppHandle,
    destination_path: String,
) -> Result<DiagnosticReportExport, String> {
    export_diagnostic_report_to_path(&app, Path::new(destination_path.trim()))
}

#[tauri::command]
async fn set_global_shortcuts(
    app: tauri::AppHandle,
    shortcuts: shortcut::GlobalShortcutConfig,
) -> Result<shortcut::GlobalShortcutRegistrationSnapshot, String> {
    Ok(shortcut::apply_global_shortcuts(&app, &shortcuts))
}

#[tauri::command]
async fn sync_native_locale(
    app: tauri::AppHandle,
    preference: locale::LanguagePreference,
) -> Result<(), String> {
    let resolved = locale::resolve_preference(preference);
    locale::set(&app, resolved);
    tray::sync_locale(&app).map_err(|error| error.to_string())?;
    #[cfg(target_os = "windows")]
    sync_windows_shell_locale(&app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_os::init())
        .manage(window_state::WindowStateStore::default())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
            let requests = parse_cli_open_note_requests(&argv, Some(cwd.as_str()));
            open_cli_note_windows(app, requests);
        }))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            note_history::list_note_history,
            note_history::record_note_history,
            note_history::delete_history_notes,
            note_history::remove_history_records,
            load_window_state_cache,
            get_window_state,
            get_window_state_by_note_path,
            get_most_recent_hidden_window_state,
            list_window_states_in_order,
            upsert_window_state,
            set_window_visibility,
            remove_window_state,
            show_settings_window,
            open_note_window,
            bring_note_windows_back_on_screen,
            get_runtime_platform,
            export_diagnostic_report,
            get_open_with_pinote_enabled,
            set_open_with_pinote_enabled,
            get_default_markdown_open_enabled,
            set_default_markdown_open_enabled,
            set_global_shortcuts,
            sync_native_locale
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            let stdout_level = if cfg!(debug_assertions) {
                LevelFilter::Debug
            } else {
                LevelFilter::Warn
            };
            let file_level = LevelFilter::Debug;
            let logs_path = handle.path().app_data_dir()?.join(LOGS_DIRECTORY_NAME);
            std::fs::create_dir_all(&logs_path)?;
            let log_plugin = tauri_plugin_log::Builder::new()
                .clear_targets()
                .level(LevelFilter::Debug)
                .rotation_strategy(RotationStrategy::KeepSome(5))
                .max_file_size(2_000_000)
                .targets([
                    Target::new(TargetKind::Stdout).filter(move |metadata| {
                        level_allowed_for_filter(metadata.level(), stdout_level)
                    }),
                    Target::new(TargetKind::Folder {
                        path: logs_path,
                        file_name: Some(LOG_FILE_NAME.to_string()),
                    })
                    .filter(move |metadata| level_allowed_for_filter(metadata.level(), file_level)),
                ])
                .build();
            handle.plugin(log_plugin)?;
            handle.manage(note_history::NoteHistoryStore::new(
                handle.path().app_data_dir()?.join("history.json"),
            ));
            let system_environment = collect_system_environment(&handle);
            info!("system_environment {}", system_environment);
            let stored_settings = load_stored_settings(&handle);
            let language = locale::parse_stored_preference(stored_settings.language.as_deref());
            let native_locale = locale::resolve_preference(language);
            handle.manage(locale::NativeLocaleState::new(native_locale));
            tray::setup_tray(&handle)?;
            #[cfg(target_os = "windows")]
            if let Err(err) = sync_windows_shell_locale(&handle) {
                error!("sync_windows_shell_locale_failed error={err}");
            }
            shortcut::setup_shortcuts(&handle)?;
            let skip_taskbar = load_hide_note_windows_from_taskbar(&handle);
            let restored_count = restore_cached_note_windows(&handle, skip_taskbar);
            let _ = window::bring_note_windows_back_on_screen(&handle);
            let startup_args = std::env::args().collect::<Vec<_>>();
            let startup_cwd = std::env::current_dir()
                .ok()
                .map(|path| path.to_string_lossy().into_owned());
            let startup_requests =
                parse_cli_open_note_requests(&startup_args, startup_cwd.as_deref());
            if startup_requests.is_empty() {
                if restored_count == 0
                    && let Some(note_path) = create_startup_note_file(&handle)
                {
                    open_cli_note_windows(&handle, vec![CliOpenNoteRequest { note_path }]);
                }
            } else {
                open_cli_note_windows(&handle, startup_requests);
            }
            window::open_startup_update_window(&handle);

            info!("app_ready");
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
