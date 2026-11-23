// Copyright 2026 Philip Bonev
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://apache.org
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

use tauri::Emitter;
use tauri::Manager;

use crate::state::{ADD_PAYLOAD, DELETE_IDS, PROPERTIES_ID};

pub(crate) fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Show the main window if it is hidden (e.g. minimized to tray) so dialog
/// windows are always centered on a visible parent. Does not steal focus —
/// the dialog being opened takes focus afterwards.
pub(crate) fn ensure_main_visible(app: &tauri::AppHandle) {
    if let Some(main) = app.get_webview_window("main")
        && !main.is_visible().unwrap_or(true)
    {
        let _ = main.show();
    }
}

fn center_on_main(app: &tauri::AppHandle, window: &tauri::WebviewWindow) {
    ensure_main_visible(app);
    let Some(main) = app.get_webview_window("main") else {
        return;
    };
    let (Ok(main_pos), Ok(main_size), Ok(window_size)) = (
        main.outer_position(),
        main.outer_size(),
        window.outer_size(),
    ) else {
        return;
    };
    let x = main_pos.x + (main_size.width as i32 - window_size.width as i32) / 2;
    let y = main_pos.y + (main_size.height as i32 - window_size.height as i32) / 2;
    let _ = window.set_position(tauri::Position::Physical(tauri::PhysicalPosition { x, y }));
}

struct DialogWindowSpec<'a> {
    label: &'a str,
    url: &'a str,
    title: &'a str,
    size: (f64, f64),
    min_size: (f64, f64),
}

fn open_dialog_window(
    app: &tauri::AppHandle,
    spec: &DialogWindowSpec,
) -> Result<tauri::WebviewWindow, String> {
    let (w, h) = spec.size;
    let (min_w, min_h) = spec.min_size;
    if let Some(window) = app.get_webview_window(spec.label) {
        center_on_main(app, &window);
        window.set_focus().map_err(|e| e.to_string())?;
        return Ok(window);
    }
    let window =
        tauri::WebviewWindowBuilder::new(app, spec.label, tauri::WebviewUrl::App(spec.url.into()))
            .title(spec.title)
            .inner_size(w, h)
            .min_inner_size(min_w, min_h)
            .build()
            .map_err(|e| e.to_string())?;
    center_on_main(app, &window);
    window.set_focus().map_err(|e| e.to_string())?;
    Ok(window)
}

#[tauri::command]
pub(crate) fn close_dialog_window(window: tauri::WebviewWindow) -> Result<(), String> {
    if window.label() == "main" {
        return Err("Refusing to close the main window".to_string());
    }
    window.destroy().map_err(|e| e.to_string())
}

#[tauri::command]
pub(crate) fn open_settings_window(app: tauri::AppHandle) -> Result<(), String> {
    open_dialog_window(
        &app,
        &DialogWindowSpec {
            label: "settings",
            url: "settings.html",
            title: "Settings",
            size: (560.0, 680.0),
            min_size: (400.0, 480.0),
        },
    )
    .map(|_| ())
}

#[tauri::command]
pub(crate) fn open_connection_settings_window(app: tauri::AppHandle) -> Result<(), String> {
    open_dialog_window(
        &app,
        &DialogWindowSpec {
            label: "connection-settings",
            url: "connection-settings.html",
            title: "Connection Settings",
            size: (440.0, 560.0),
            min_size: (380.0, 480.0),
        },
    )
    .map(|_| ())
}

#[tauri::command]
pub(crate) fn open_about_window(app: tauri::AppHandle) -> Result<(), String> {
    open_dialog_window(
        &app,
        &DialogWindowSpec {
            label: "about",
            url: "about.html",
            title: "About rTransmission Client",
            size: (440.0, 320.0),
            min_size: (360.0, 280.0),
        },
    )
    .map(|_| ())
}

#[tauri::command]
pub(crate) fn open_add_window(
    app: tauri::AppHandle,
    mode: String,
    prefill: String,
    dirs: Vec<String>,
    connected: bool,
) -> Result<(), String> {
    let payload = serde_json::json!({ "mode": mode, "prefill": prefill, "dirs": dirs, "connected": connected });
    *ADD_PAYLOAD.lock().unwrap() = Some(payload.clone());
    if let Some(window) = app.get_webview_window("add") {
        let _ = window.emit("add-data", payload);
        center_on_main(&app, &window);
        window.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }
    open_dialog_window(
        &app,
        &DialogWindowSpec {
            label: "add",
            url: "add.html",
            title: "Add Torrent",
            size: (520.0, 420.0),
            min_size: (420.0, 360.0),
        },
    )
    .map(|_| ())
}

#[tauri::command]
pub(crate) fn get_add_payload() -> Option<serde_json::Value> {
    ADD_PAYLOAD.lock().unwrap().clone()
}

#[tauri::command]
pub(crate) fn open_delete_window(app: tauri::AppHandle, ids: Vec<i64>) -> Result<(), String> {
    *DELETE_IDS.lock().unwrap() = Some(ids.clone());
    if let Some(window) = app.get_webview_window("delete") {
        let _ = window.emit("delete-data", ids);
        center_on_main(&app, &window);
        window.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }
    open_dialog_window(
        &app,
        &DialogWindowSpec {
            label: "delete",
            url: "delete.html",
            title: "Remove Torrents",
            size: (400.0, 240.0),
            min_size: (320.0, 200.0),
        },
    )
    .map(|_| ())
}

#[tauri::command]
pub(crate) fn get_delete_ids() -> Option<Vec<i64>> {
    DELETE_IDS.lock().unwrap().clone()
}

#[tauri::command]
pub(crate) fn open_properties_window(app: tauri::AppHandle, id: i64) -> Result<(), String> {
    *PROPERTIES_ID.lock().unwrap() = Some(id);

    if let Some(window) = app.get_webview_window("properties") {
        let _ = window.emit("properties-data", ());
        center_on_main(&app, &window);
        window.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }
    open_dialog_window(
        &app,
        &DialogWindowSpec {
            label: "properties",
            url: "properties.html",
            title: "Torrent Properties",
            size: (760.0, 680.0),
            min_size: (480.0, 420.0),
        },
    )
    .map(|_| ())
}

#[tauri::command]
pub(crate) fn get_properties_torrent_id() -> Option<i64> {
    *PROPERTIES_ID.lock().unwrap()
}
