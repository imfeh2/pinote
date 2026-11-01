use log::{error, info};
use std::{thread, time::Duration};
use tauri::{Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindowBuilder};

use crate::window_state::{self, UpdateWindowStateOptions, WindowVisibility};
use crate::{
    NEW_NOTE_WINDOW_HEIGHT, NEW_NOTE_WINDOW_WIDTH, NOTE_WINDOW_HEIGHT, NOTE_WINDOW_MIN_HEIGHT,
    NOTE_WINDOW_MIN_WIDTH, NOTE_WINDOW_WIDTH, OpenNoteWindowOptions, build_note_window_url,
    capture_note_window_state, clamp_note_opacity, clamp_note_scroll_top,
    load_hide_note_windows_from_taskbar, shake_existing_window,
};

const NOTE_WINDOW_PREFIX: &str = "note-";
const NOTE_CONTEXT_MENU_WINDOW_SUFFIX: &str = "-context-menu";
const NOTE_WINDOW_BROUGHT_BACK_EVENT: &str = "note-window-brought-back";
const NOTE_WINDOW_RECOVERY_MARGIN: i64 = 16;
const NOTE_WINDOW_RECOVERY_OFFSET: i64 = 28;
const EXISTING_WINDOW_SHAKE_OFFSETS: [i32; 8] = [0, 14, -12, 10, -8, 6, -4, 0];
const EXISTING_WINDOW_SHAKE_DELAY_MS: u64 = 14;
const STARTUP_UPDATE_WINDOW_LABEL: &str = "startup-update";

#[derive(Clone, Copy)]
struct ScreenRect {
    x: i64,
    y: i64,
    width: i64,
    height: i64,
}

impl ScreenRect {
    fn right(self) -> i64 {
        self.x + self.width
    }

    fn bottom(self) -> i64 {
        self.y + self.height
    }
}

pub fn destroy_note_context_menu<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    note_window_label: &str,
) -> tauri::Result<()> {
    let label = format!("{note_window_label}{NOTE_CONTEXT_MENU_WINDOW_SUFFIX}");
    if let Some(menu) = app.get_webview_window(&label) {
        menu.destroy()?;
    }
    Ok(())
}

fn is_note_window_label(label: &str) -> bool {
    label.starts_with(NOTE_WINDOW_PREFIX) && !label.ends_with(NOTE_CONTEXT_MENU_WINDOW_SUFFIX)
}

fn monitor_work_area(monitor: &tauri::Monitor) -> ScreenRect {
    let area = monitor.work_area();
    ScreenRect {
        x: i64::from(area.position.x),
        y: i64::from(area.position.y),
        width: i64::from(area.size.width),
        height: i64::from(area.size.height),
    }
}

fn available_work_areas(app: &tauri::AppHandle) -> Result<Vec<ScreenRect>, String> {
    let mut areas = app
        .available_monitors()
        .map_err(|error| format!("Failed to read monitors: {error}"))?
        .into_iter()
        .map(|monitor| monitor_work_area(&monitor))
        .filter(|area| area.width > 0 && area.height > 0)
        .collect::<Vec<_>>();
    areas.sort_by_key(|area| (area.x, area.y, area.width, area.height));
    if areas.is_empty() {
        return Err(String::from("No available monitor work area"));
    }
    Ok(areas)
}

fn i64_to_i32(value: i64) -> i32 {
    value.clamp(i64::from(i32::MIN), i64::from(i32::MAX)) as i32
}

fn window_rect(position: PhysicalPosition<i32>, size: PhysicalSize<u32>) -> ScreenRect {
    ScreenRect {
        x: i64::from(position.x),
        y: i64::from(position.y),
        width: i64::from(size.width),
        height: i64::from(size.height),
    }
}

fn rects_intersect(left: ScreenRect, right: ScreenRect) -> bool {
    left.x < right.right()
        && left.right() > right.x
        && left.y < right.bottom()
        && left.bottom() > right.y
}

fn nearest_work_area(
    position: PhysicalPosition<i32>,
    size: PhysicalSize<u32>,
    areas: &[ScreenRect],
) -> ScreenRect {
    let center_x = i64::from(position.x) + i64::from(size.width) / 2;
    let center_y = i64::from(position.y) + i64::from(size.height) / 2;
    areas
        .iter()
        .copied()
        .min_by_key(|area| {
            let area_center_x = area.x + area.width / 2;
            let area_center_y = area.y + area.height / 2;
            let dx = center_x - area_center_x;
            let dy = center_y - area_center_y;
            dx.saturating_mul(dx) + dy.saturating_mul(dy)
        })
        .unwrap_or(areas[0])
}

fn recovery_position(
    area: ScreenRect,
    size: PhysicalSize<u32>,
    recovery_index: usize,
) -> PhysicalPosition<i32> {
    let width = i64::from(size.width);
    let height = i64::from(size.height);
    let offset = (recovery_index % 8) as i64 * NOTE_WINDOW_RECOVERY_OFFSET;
    let min_x = area.x + NOTE_WINDOW_RECOVERY_MARGIN;
    let max_x = area.right() - width - NOTE_WINDOW_RECOVERY_MARGIN;
    let min_y = area.y + NOTE_WINDOW_RECOVERY_MARGIN;
    let max_y = area.bottom() - height - NOTE_WINDOW_RECOVERY_MARGIN;
    let x = if max_x < min_x {
        min_x
    } else {
        (max_x - offset).clamp(min_x, max_x)
    };
    let y = if max_y < min_y {
        min_y
    } else {
        (min_y + offset).clamp(min_y, max_y)
    };
    PhysicalPosition::new(i64_to_i32(x), i64_to_i32(y))
}

pub fn bring_note_windows_back_on_screen(app: &tauri::AppHandle) -> usize {
    let areas = match available_work_areas(app) {
        Ok(value) => value,
        Err(err) => {
            error!("bring_note_windows_back_failed error={err}");
            return 0;
        }
    };
    let mut windows = app
        .webview_windows()
        .into_iter()
        .filter(|(label, _)| is_note_window_label(label))
        .collect::<Vec<_>>();
    windows.sort_by(|left, right| left.0.cmp(&right.0));
    let mut moved = 0usize;
    for (label, window) in windows {
        let Ok(position) = window.outer_position() else {
            continue;
        };
        let Ok(size) = window.outer_size() else {
            continue;
        };
        let rect = window_rect(position, size);
        if areas.iter().any(|area| rects_intersect(rect, *area)) {
            continue;
        }
        let target_area = nearest_work_area(position, size, &areas);
        let next_position = recovery_position(target_area, size, moved);
        if let Err(err) = window.set_position(next_position) {
            error!("bring_note_window_back_move_failed window_id={label:?} error={err}");
            continue;
        }
        if let Ok(inner_size) = window.inner_size()
            && let Err(err) = window_state::set_window_bounds(
                app,
                &label,
                window_state::WindowBounds {
                    x: next_position.x,
                    y: next_position.y,
                    width: f64::from(inner_size.width),
                    height: f64::from(inner_size.height),
                },
            )
        {
            error!("bring_note_window_back_state_failed window_id={label:?} error={err}");
        }
        let _ = window.emit(NOTE_WINDOW_BROUGHT_BACK_EVENT, ());
        moved += 1;
    }
    if moved > 0 {
        info!("bring_note_windows_back_completed moved={moved}");
    }
    moved
}

fn visible_note_window_labels(app: &tauri::AppHandle) -> Vec<String> {
    let mut labels = app
        .webview_windows()
        .into_iter()
        .filter(|(label, _)| is_note_window_label(label))
        .filter_map(|(label, window)| match window.is_visible() {
            Ok(true) => Some(label),
            _ => None,
        })
        .collect::<Vec<_>>();
    labels.sort();
    labels
}

fn shake_visible_note_windows_simultaneously(app: &tauri::AppHandle) {
    let labels = visible_note_window_labels(app);
    let mut windows = Vec::new();
    for label in labels {
        let Some(window) = app.get_webview_window(&label) else {
            continue;
        };
        let Ok(position) = window.outer_position() else {
            continue;
        };
        windows.push((window, position.x, position.y));
    }
    if windows.is_empty() {
        return;
    }
    for offset in EXISTING_WINDOW_SHAKE_OFFSETS {
        for (window, base_x, base_y) in &windows {
            let _ = window.set_position(PhysicalPosition::new(*base_x + offset, *base_y));
        }
        thread::sleep(Duration::from_millis(EXISTING_WINDOW_SHAKE_DELAY_MS));
    }
}

fn bring_visible_note_windows_to_front(app: &tauri::AppHandle) {
    let labels = visible_note_window_labels(app);
    for label in labels {
        let Some(window) = app.get_webview_window(&label) else {
            continue;
        };
        if window.is_minimized().unwrap_or(false) {
            let _ = window.unminimize();
        }
        let was_always_on_top = window.is_always_on_top().unwrap_or(false);
        let _ = window.show();
        let _ = window.set_focus();
        if !was_always_on_top {
            let _ = window.set_always_on_top(true);
            let _ = window.set_always_on_top(false);
        }
    }
}

pub fn toggle_visible_note_windows(app: &tauri::AppHandle) {
    let visible_labels = visible_note_window_labels(app);
    if !visible_labels.is_empty() {
        info!(
            "toggle_visible_note_windows_hide_requested count={} labels={visible_labels:?}",
            visible_labels.len()
        );
        if let Err(err) = window_state::set_visible_window_toggle_snapshot(app, &visible_labels) {
            error!("toggle_visible_note_windows_snapshot_store_failed error={err}");
        }
        if let Err(err) = window_state::set_window_visibility_by_labels(
            app,
            &visible_labels,
            WindowVisibility::Hidden,
            UpdateWindowStateOptions {
                push_hidden_to_top: Some(true),
                preserve_hidden_visibility: None,
            },
        ) {
            error!("toggle_visible_note_windows_hide_state_failed error={err}");
        }
        for label in visible_labels {
            let Some(window) = app.get_webview_window(&label) else {
                continue;
            };
            let _ = window.hide();
        }
        info!("toggle_visible_note_windows_hide_completed");
        return;
    }
    let labels_to_restore = match window_state::list_visible_window_toggle_snapshot(app) {
        Ok(value) => value,
        Err(err) => {
            error!("toggle_visible_note_windows_snapshot_load_failed error={err}");
            Vec::new()
        }
    };
    if labels_to_restore.is_empty() {
        info!("toggle_visible_note_windows_restore_skipped reason=no_snapshot");
        return;
    }
    info!(
        "toggle_visible_note_windows_restore_requested count={} labels={labels_to_restore:?}",
        labels_to_restore.len()
    );
    if let Err(err) = window_state::clear_visible_window_toggle_snapshot(app) {
        error!("toggle_visible_note_windows_snapshot_clear_failed error={err}");
    }
    if let Err(err) = window_state::set_window_visibility_by_labels(
        app,
        &labels_to_restore,
        WindowVisibility::Visible,
        UpdateWindowStateOptions::default(),
    ) {
        error!("toggle_visible_note_windows_restore_state_failed error={err}");
    }
    let mut restored = 0usize;
    let mut missing = Vec::new();
    let mut last_restored_window = None;
    for label in labels_to_restore {
        let Some(window) = app.get_webview_window(&label) else {
            missing.push(label);
            continue;
        };
        let _ = window.show();
        restored += 1;
        last_restored_window = Some(window);
    }
    if let Some(window) = last_restored_window {
        let _ = window.set_focus();
    }
    let _ = bring_note_windows_back_on_screen(app);
    info!(
        "toggle_visible_note_windows_restore_completed restored={restored} missing={}",
        missing.len()
    );
    if !missing.is_empty() {
        info!("toggle_visible_note_windows_restore_missing labels={missing:?}");
    }
}

pub fn restore_latest_hidden_window(app: &tauri::AppHandle) -> bool {
    if let Ok(Some(state)) = window_state::get_most_recent_hidden_window_state(app) {
        info!(
            "restore_latest_hidden_window_requested window_id={:?}",
            state.window_id
        );
        let Some(window) = app.get_webview_window(&state.window_id) else {
            info!(
                "restore_latest_hidden_window_missing_window window_id={:?}",
                state.window_id
            );
            return false;
        };
        let _ = window_state::set_window_visibility(
            app,
            &state.window_id,
            WindowVisibility::Visible,
            UpdateWindowStateOptions::default(),
        );
        let _ = window.show();
        let _ = window.set_focus();
        let _ = bring_note_windows_back_on_screen(app);
        info!(
            "restore_latest_hidden_window_completed window_id={:?}",
            state.window_id
        );
        return true;
    }
    false
}

pub fn restore_hidden_window(app: &tauri::AppHandle) {
    if restore_latest_hidden_window(app) {
        return;
    }
    info!("restore_hidden_window_no_hidden_window");
    let moved = bring_note_windows_back_on_screen(app);
    bring_visible_note_windows_to_front(app);
    if moved == 0 {
        shake_visible_note_windows_simultaneously(app);
    }
}

pub fn show_all_hidden_windows(app: &tauri::AppHandle) {
    let labels_to_restore = match window_state::list_hidden_window_ids(app) {
        Ok(value) => value,
        Err(_) => {
            info!("show_all_hidden_windows_failed_to_load_hidden_stack");
            shake_visible_note_windows_simultaneously(app);
            return;
        }
    };
    if labels_to_restore.is_empty() {
        info!("show_all_hidden_windows_skipped reason=no_hidden_window");
        shake_visible_note_windows_simultaneously(app);
        return;
    }
    info!(
        "show_all_hidden_windows_requested count={} labels={labels_to_restore:?}",
        labels_to_restore.len()
    );
    if let Err(err) = window_state::set_window_visibility_by_labels(
        app,
        &labels_to_restore,
        WindowVisibility::Visible,
        UpdateWindowStateOptions::default(),
    ) {
        error!("show_all_hidden_windows_state_failed error={err}");
    }
    let mut restored = 0usize;
    let mut last_restored_window = None;
    for label in labels_to_restore {
        let Some(window) = app.get_webview_window(&label) else {
            continue;
        };
        let _ = window.show();
        restored += 1;
        last_restored_window = Some(window);
    }
    if let Some(window) = last_restored_window {
        let _ = window.set_focus();
    }
    let _ = bring_note_windows_back_on_screen(app);
    info!("show_all_hidden_windows_completed restored={restored}");
}

pub fn show_settings_window(
    app: &tauri::AppHandle,
    section: Option<String>,
) -> Result<(), tauri::Error> {
    info!("show_settings_window_requested");
    let url = match section.as_deref() {
        Some("about") => "index.html?view=settings&section=about",
        _ => "index.html?view=settings",
    };
    let result = (|| -> Result<(), tauri::Error> {
        if let Some(window) = app.get_webview_window("settings") {
            info!("show_settings_window_reuse_existing");
            let was_always_on_top = window.is_always_on_top().unwrap_or(false);
            if window.is_minimized().unwrap_or(false) {
                let _ = window.unminimize();
            }
            let _ = window.show();
            let _ = window.set_focus();
            if !was_always_on_top {
                let _ = window.set_always_on_top(true);
                let _ = window.set_always_on_top(false);
            }
            return Ok(());
        }

        info!("show_settings_window_create_begin");
        let window = WebviewWindowBuilder::new(app, "settings", WebviewUrl::App(url.into()))
            .title("Pinote")
            .inner_size(920.0, 620.0)
            .center()
            .decorations(true)
            .resizable(true)
            .min_inner_size(760.0, 520.0)
            .build()?;
        info!("show_settings_window_create_built");
        let _ = window.show();
        let _ = window.set_focus();

        let window_clone = window.clone();
        window.on_window_event(move |event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                info!("settings_window_hide");
                let _ = window_clone.hide();
            }
        });

        Ok(())
    })();
    match &result {
        Ok(_) => info!("show_settings_window_finished"),
        Err(err) => error!("show_settings_window_failed error={err}"),
    }
    result
}

pub fn open_startup_update_window(app: &tauri::AppHandle) {
    if app
        .get_webview_window(STARTUP_UPDATE_WINDOW_LABEL)
        .is_some()
    {
        return;
    }
    let result = WebviewWindowBuilder::new(
        app,
        STARTUP_UPDATE_WINDOW_LABEL,
        WebviewUrl::App("index.html?view=startup-update".into()),
    )
    .title("Pinote")
    .inner_size(1.0, 1.0)
    .visible(false)
    .skip_taskbar(true)
    .build();
    match result {
        Ok(_) => info!("startup_update_window_created"),
        Err(err) => error!("startup_update_window_failed error={err}"),
    }
}

pub fn build_note_window(
    app: tauri::AppHandle,
    note_id: String,
    options: Option<OpenNoteWindowOptions>,
) -> Result<window_state::CachedWindowState, String> {
    let options = options.unwrap_or_default();
    let normalized_note_id = note_id.trim().to_string();
    if normalized_note_id.is_empty() {
        return Err(String::from("noteId is required"));
    }
    let note_path = options
        .note_path
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .ok_or_else(|| String::from("notePath is required"))?;
    let window_id = options
        .window_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .ok_or_else(|| String::from("windowId is required"))?;
    let visibility = options
        .visibility
        .unwrap_or(window_state::WindowVisibility::Visible);
    let should_focus =
        visibility != window_state::WindowVisibility::Hidden && options.focus.unwrap_or(true);
    let read_only = options.read_only.unwrap_or(false);
    let opacity = clamp_note_opacity(options.opacity);
    let scroll_top = clamp_note_scroll_top(options.scroll_top);
    let center_on_create = options.center_on_create.unwrap_or(false);
    let skip_taskbar = options
        .skip_taskbar
        .unwrap_or_else(|| load_hide_note_windows_from_taskbar(&app));
    info!(
        "open_note_window_requested window_id={window_id:?} note_id={normalized_note_id:?} note_path={note_path:?} visibility={visibility:?} focus={should_focus} center_on_create={center_on_create} skip_taskbar={skip_taskbar}"
    );
    let result = (|| -> Result<window_state::CachedWindowState, String> {
        if let Some(existing) = app.get_webview_window(&window_id) {
            info!("open_note_window_reuse_existing window_id={window_id:?}");
            if let Some(bounds) = options.bounds.as_ref() {
                let width = bounds.width.round().max(1.0) as u32;
                let height = bounds.height.round().max(1.0) as u32;
                existing
                    .set_size(tauri::Size::Physical(tauri::PhysicalSize::new(
                        width, height,
                    )))
                    .map_err(|error| format!("Failed to set window size: {error}"))?;
                existing
                    .set_position(PhysicalPosition::new(bounds.x, bounds.y))
                    .map_err(|error| format!("Failed to set window position: {error}"))?;
            }
            if let Some(always_on_top) = options.always_on_top {
                existing
                    .set_always_on_top(always_on_top)
                    .map_err(|error| format!("Failed to set always-on-top: {error}"))?;
            }
            existing
                .set_skip_taskbar(skip_taskbar)
                .map_err(|error| format!("Failed to set skip-taskbar: {error}"))?;
            match visibility {
                window_state::WindowVisibility::Hidden => {
                    existing
                        .hide()
                        .map_err(|error| format!("Failed to hide existing window: {error}"))?;
                }
                window_state::WindowVisibility::Visible => {
                    existing
                        .show()
                        .map_err(|error| format!("Failed to show existing window: {error}"))?;
                    if should_focus {
                        existing
                            .set_focus()
                            .map_err(|error| format!("Failed to focus existing window: {error}"))?;
                        shake_existing_window(&existing);
                    }
                }
            }
            return capture_note_window_state(
                &existing,
                &normalized_note_id,
                &note_path,
                read_only,
                opacity,
                scroll_top,
            );
        }

        let url = build_note_window_url(
            &window_id,
            Some(&normalized_note_id),
            &note_path,
            Some(opacity),
            read_only,
            scroll_top,
        );
        let (initial_width, initial_height) = if center_on_create {
            (NEW_NOTE_WINDOW_WIDTH, NEW_NOTE_WINDOW_HEIGHT)
        } else {
            (NOTE_WINDOW_WIDTH, NOTE_WINDOW_HEIGHT)
        };
        info!(
            "open_note_window_create_begin window_id={window_id:?} width={initial_width} height={initial_height}"
        );
        let mut builder = WebviewWindowBuilder::new(&app, &window_id, WebviewUrl::App(url.into()))
            .title(format!("Pinote - {normalized_note_id}"))
            .inner_size(initial_width, initial_height)
            .min_inner_size(NOTE_WINDOW_MIN_WIDTH, NOTE_WINDOW_MIN_HEIGHT)
            .decorations(false)
            .transparent(true)
            .resizable(true)
            .always_on_top(options.always_on_top.unwrap_or(false))
            .skip_taskbar(skip_taskbar)
            .visible(false);
        if center_on_create && options.bounds.is_none() {
            builder = builder.center();
        }
        let window = builder
            .build()
            .map_err(|error| format!("Failed to create note window: {error}"))?;
        info!("open_note_window_create_built window_id={window_id:?}");
        if let Some(bounds) = options.bounds.as_ref() {
            let width = bounds.width.round().max(1.0) as u32;
            let height = bounds.height.round().max(1.0) as u32;
            window
                .set_size(tauri::Size::Physical(tauri::PhysicalSize::new(
                    width, height,
                )))
                .map_err(|error| format!("Failed to set new window size: {error}"))?;
            window
                .set_position(PhysicalPosition::new(bounds.x, bounds.y))
                .map_err(|error| format!("Failed to set new window position: {error}"))?;
        }
        let mut state = capture_note_window_state(
            &window,
            &normalized_note_id,
            &note_path,
            read_only,
            opacity,
            scroll_top,
        )?;
        state.visibility = visibility;
        Ok(state)
    })();
    match &result {
        Ok(state) => info!(
            "open_note_window_finished window_id={:?} note_id={:?} note_path={:?} visibility={:?}",
            state.window_id, state.note_id, state.note_path, state.visibility
        ),
        Err(err) => error!(
            "open_note_window_failed window_id={window_id:?} note_id={normalized_note_id:?} note_path={note_path:?} error={err}"
        ),
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    };

    #[test]
    fn destroying_a_note_menu_keeps_other_menus_alive() {
        let app = tauri::test::mock_app();
        let note = WebviewWindowBuilder::new(&app, "note-a", Default::default())
            .build()
            .unwrap();
        let menu = WebviewWindowBuilder::new(&app, "note-a-context-menu", Default::default())
            .visible(false)
            .build()
            .unwrap();
        let other = WebviewWindowBuilder::new(&app, "note-b-context-menu", Default::default())
            .build()
            .unwrap();
        destroy_note_context_menu(app.handle(), "note-without-menu").unwrap();
        destroy_note_context_menu(app.handle(), "note-a").unwrap();

        let phase = Arc::new(AtomicUsize::new(0));
        let observed = Arc::new(AtomicUsize::new(usize::MAX));
        let result = observed.clone();
        app.run(move |app, event| match event {
            tauri::RunEvent::Ready => {
                note.destroy().unwrap();
                let first = phase.clone();
                app.run_on_main_thread(move || first.store(1, Ordering::SeqCst))
                    .unwrap();
                other.destroy().unwrap();
                let second = phase.clone();
                app.run_on_main_thread(move || second.store(2, Ordering::SeqCst))
                    .unwrap();
                menu.destroy().unwrap();
            }
            tauri::RunEvent::ExitRequested { .. } => {
                observed.store(phase.load(Ordering::SeqCst), Ordering::SeqCst);
            }
            _ => {}
        });
        assert_eq!(result.load(Ordering::SeqCst), 1);
    }
}
