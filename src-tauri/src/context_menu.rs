use log::error;
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{Emitter, Manager, PhysicalPosition, WebviewUrl, WebviewWindowBuilder, window::Color};

const CONTEXT_MENU_WINDOW_LABEL: &str = "context-menu";
const CONTEXT_MENU_SYNC_EVENT: &str = "note-context-menu-sync";
const CONTEXT_MENU_WIDTH: f64 = 224.0;
const CONTEXT_MENU_HEIGHT: f64 = 180.0;
const CONTEXT_MENU_GAP: i64 = 8;

#[derive(Default)]
pub struct ContextMenuTarget(Mutex<Option<String>>);

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenContextMenuRequest {
    target_window_label: String,
    note_id: String,
    note_path: String,
    screen_x: f64,
    screen_y: f64,
    note_opacity: Option<f64>,
    note_read_only: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ContextMenuContext {
    target_window_label: String,
    note_id: String,
    note_path: String,
    note_opacity: f64,
    note_read_only: bool,
    maximized: bool,
    always_on_top: bool,
}

#[derive(Clone, Copy)]
struct Area {
    x: i64,
    y: i64,
    width: i64,
    height: i64,
}

fn menu_position(pointer: (i64, i64), size: (i64, i64), area: Option<Area>) -> (i64, i64) {
    let Some(area) = area else {
        return pointer;
    };
    let (pointer_x, pointer_y) = pointer;
    let (width, height) = size;
    let min_x = area.x + CONTEXT_MENU_GAP;
    let min_y = area.y + CONTEXT_MENU_GAP;
    let max_x = min_x.max(area.x + area.width - width - CONTEXT_MENU_GAP);
    let max_y = min_y.max(area.y + area.height - height - CONTEXT_MENU_GAP);
    let right_space = area.x + area.width - pointer_x - CONTEXT_MENU_GAP;
    let left_space = pointer_x - area.x - CONTEXT_MENU_GAP;
    let bottom_space = area.y + area.height - pointer_y - CONTEXT_MENU_GAP;
    let top_space = pointer_y - area.y - CONTEXT_MENU_GAP;
    let x = if right_space < width && left_space >= width {
        pointer_x - width
    } else {
        pointer_x
    };
    let y = if bottom_space < height && top_space >= height {
        pointer_y - height
    } else {
        pointer_y
    };
    (x.clamp(min_x, max_x), y.clamp(min_y, max_y))
}

pub fn create_context_menu_window(app: &tauri::AppHandle) -> tauri::Result<()> {
    let window = WebviewWindowBuilder::new(
        app,
        CONTEXT_MENU_WINDOW_LABEL,
        WebviewUrl::App("index.html?view=context-menu".into()),
    )
    .title("Pinote Menu")
    .inner_size(CONTEXT_MENU_WIDTH, CONTEXT_MENU_HEIGHT)
    .decorations(false)
    .transparent(true)
    .background_color(Color(0, 0, 0, 0))
    .resizable(false)
    .always_on_top(true)
    .shadow(false)
    .skip_taskbar(true)
    .focused(false)
    .visible(false)
    .build()?;
    let menu = window.clone();
    window.on_window_event(move |event| {
        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            if let Err(error) = menu.hide() {
                error!("context_menu_hide_failed error={error}");
            }
        }
    });
    Ok(())
}

pub fn hide_context_menu_for<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    note_window_label: &str,
) -> Result<(), String> {
    let target = app
        .state::<ContextMenuTarget>()
        .0
        .lock()
        .map_err(|error| format!("context menu target is unavailable: {error}"))?
        .clone();
    if target.as_deref() != Some(note_window_label) {
        return Ok(());
    }
    let Some(menu) = app.get_webview_window(CONTEXT_MENU_WINDOW_LABEL) else {
        return Ok(());
    };
    menu.hide()
        .map_err(|error| format!("failed to hide context menu: {error}"))
}

#[tauri::command]
pub fn open_context_menu(
    app: tauri::AppHandle,
    request: OpenContextMenuRequest,
) -> Result<(), String> {
    let target = app
        .get_webview_window(&request.target_window_label)
        .ok_or_else(|| format!("note window {:?} not found", request.target_window_label))?;
    let menu = app
        .get_webview_window(CONTEXT_MENU_WINDOW_LABEL)
        .ok_or("context menu window not found")?;
    let fail = |error: tauri::Error| format!("failed to open context menu: {error}");
    let maximized = target.is_maximized().map_err(fail)?;
    let always_on_top = target.is_always_on_top().map_err(fail)?;
    let note_scale = target.scale_factor().map_err(fail)?;
    let pointer = (
        (request.screen_x * note_scale).round() as i64,
        (request.screen_y * note_scale).round() as i64,
    );
    let monitor = app
        .monitor_from_point(pointer.0 as f64, pointer.1 as f64)
        .map_err(fail)?;
    let menu_size = menu
        .outer_size()
        .map_err(fail)?
        .to_logical::<f64>(menu.scale_factor().map_err(fail)?);
    let monitor_scale = monitor
        .as_ref()
        .map_or(note_scale, |monitor| monitor.scale_factor());
    let size = (
        (menu_size.width * monitor_scale).round() as i64,
        (menu_size.height * monitor_scale).round() as i64,
    );
    let area = monitor.as_ref().map(|monitor| {
        let work_area = monitor.work_area();
        Area {
            x: i64::from(work_area.position.x),
            y: i64::from(work_area.position.y),
            width: i64::from(work_area.size.width),
            height: i64::from(work_area.size.height),
        }
    });
    let (x, y) = menu_position(pointer, size, area);
    *app.state::<ContextMenuTarget>()
        .0
        .lock()
        .map_err(|error| format!("context menu target is unavailable: {error}"))? =
        Some(request.target_window_label.clone());
    menu.set_position(PhysicalPosition::new(x as i32, y as i32))
        .map_err(fail)?;
    menu.emit_to(
        CONTEXT_MENU_WINDOW_LABEL,
        CONTEXT_MENU_SYNC_EVENT,
        ContextMenuContext {
            target_window_label: request.target_window_label,
            note_id: request.note_id,
            note_path: request.note_path,
            note_opacity: crate::clamp_note_opacity(request.note_opacity),
            note_read_only: request.note_read_only,
            maximized,
            always_on_top,
        },
    )
    .map_err(fail)
}

#[tauri::command]
pub fn show_context_menu(window: tauri::WebviewWindow) -> Result<(), String> {
    let fail = |error: tauri::Error| format!("failed to show context menu: {error}");
    window.show().map_err(fail)?;
    window.set_focus().map_err(fail)
}

#[tauri::command]
pub fn close_context_menu(
    app: tauri::AppHandle,
    target_window_label: String,
) -> Result<(), String> {
    hide_context_menu_for(&app, &target_window_label)
}

#[cfg(test)]
mod tests {
    use super::*;

    const AREA: Area = Area {
        x: 0,
        y: 0,
        width: 1920,
        height: 1040,
    };

    #[test]
    fn menu_opens_at_the_pointer_when_it_fits() {
        assert_eq!(
            menu_position((100, 200), (224, 300), Some(AREA)),
            (100, 200)
        );
    }

    #[test]
    fn menu_flips_to_the_side_with_room() {
        assert_eq!(
            menu_position((1900, 1000), (224, 300), Some(AREA)),
            (1676, 700)
        );
    }

    #[test]
    fn menu_stays_inside_the_work_area() {
        assert_eq!(menu_position((2, 2), (224, 300), Some(AREA)), (8, 8));
        assert_eq!(menu_position((100, 200), (224, 1200), Some(AREA)), (100, 8));
    }

    #[test]
    fn menu_without_a_monitor_opens_at_the_pointer() {
        assert_eq!(menu_position((-50, 30), (224, 300), None), (-50, 30));
    }
}
