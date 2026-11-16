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

use std::collections::HashMap;
use std::sync::Mutex;

use tauri::Emitter;
use tauri::Manager;
use tauri::State;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};

use crate::state::AppState;

fn mark_active(items: &HashMap<String, (tauri::menu::MenuItem<tauri::Wry>, String)>, active: &str) {
    for (key, (item, base)) in items {
        let text = if key == active {
            format!("✓ {}", base)
        } else {
            base.clone()
        };
        let _ = item.set_text(text);
    }
}

#[tauri::command]
pub(crate) fn update_menu_markers(
    state: State<Mutex<AppState>>,
    sort: String,
    sort_dir: String,
    filter: String,
) {
    let state = state.inner().lock().unwrap();
    mark_active(&state.sort_menu_items, &sort);
    mark_active(&state.sort_dir_menu_items, &sort_dir);
    mark_active(&state.filter_menu_items, &filter);
}

pub(crate) fn setup_app_menu(app: &tauri::App) -> tauri::Result<()> {
    let connection_settings = MenuItem::with_id(
        app,
        "connection-settings",
        "Connection Settings…",
        true,
        None::<&str>,
    )?;
    let app_menu = Submenu::with_items(
        app,
        app.package_info().name.clone(),
        true,
        &[
            &MenuItem::with_id(
                app,
                "about",
                "About rTransmission Client",
                true,
                None::<&str>,
            )?,
            &connection_settings,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::services(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::hide(app, None)?,
            &PredefinedMenuItem::hide_others(app, None)?,
            &PredefinedMenuItem::show_all(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::quit(app, None)?,
        ],
    )?;

    let add_url = MenuItem::with_id(app, "add-url", "Add Torrent URL…", true, None::<&str>)?;
    let add_magnet = MenuItem::with_id(app, "add-magnet", "Add Magnet Link…", true, None::<&str>)?;
    let add_file = MenuItem::with_id(app, "add-file", "Add Torrent File…", true, None::<&str>)?;
    let file_menu = Submenu::with_items(app, "File", true, &[&add_url, &add_magnet, &add_file])?;

    let edit_menu = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(app, None)?,
            &PredefinedMenuItem::redo(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
        ],
    )?;

    let play = MenuItem::with_id(app, "play", "Play", true, None::<&str>)?;
    let pause = MenuItem::with_id(app, "pause", "Pause", true, None::<&str>)?;
    let delete = MenuItem::with_id(app, "delete", "Delete", true, None::<&str>)?;
    let verify = MenuItem::with_id(app, "verify", "Verify", true, None::<&str>)?;
    let torrent_menu =
        Submenu::with_items(app, "Torrent", true, &[&play, &pause, &delete, &verify])?;

    let sort_defs = [
        ("sort-date", "Date"),
        ("sort-leechers", "Leechers"),
        ("sort-name", "Name"),
        ("sort-queue", "Queue"),
        ("sort-seeders", "Seeders"),
        ("sort-size", "Size"),
    ];
    let sort_items = sort_defs
        .iter()
        .map(|(id, label)| {
            let item = MenuItem::with_id(app, *id, *label, true, None::<&str>)?;
            Ok(((*id).to_string(), (item, (*label).to_string())))
        })
        .collect::<tauri::Result<HashMap<_, _>>>()?;
    let sort_dir_defs = [
        ("sort-asc", "Sort Ascending"),
        ("sort-desc", "Sort Descending"),
    ];
    let sort_dir_items = sort_dir_defs
        .iter()
        .map(|(id, label)| {
            let item = MenuItem::with_id(app, *id, *label, true, None::<&str>)?;
            Ok(((*id).to_string(), (item, (*label).to_string())))
        })
        .collect::<tauri::Result<HashMap<_, _>>>()?;
    let sort_dir_buttons: Vec<&dyn tauri::menu::IsMenuItem<tauri::Wry>> = sort_dir_items
        .values()
        .map(|(item, _)| item as &dyn tauri::menu::IsMenuItem<tauri::Wry>)
        .collect();

    let mut sort_dir_state_map = HashMap::new();
    for (id, (item, label)) in &sort_dir_items {
        sort_dir_state_map.insert(
            id.trim_start_matches("sort-").to_string(),
            (item.clone(), label.clone()),
        );
    }
    app.state::<Mutex<AppState>>()
        .inner()
        .lock()
        .unwrap()
        .sort_dir_menu_items = sort_dir_state_map;

    let sort_buttons: Vec<&dyn tauri::menu::IsMenuItem<tauri::Wry>> = sort_items
        .values()
        .map(|(item, _)| item as &dyn tauri::menu::IsMenuItem<tauri::Wry>)
        .collect();

    let sort_separator = PredefinedMenuItem::separator(app)?;
    let sort_all_buttons: Vec<&dyn tauri::menu::IsMenuItem<tauri::Wry>> = sort_buttons
        .iter()
        .map(|&b| b as &dyn tauri::menu::IsMenuItem<tauri::Wry>)
        .chain([&sort_separator as &dyn tauri::menu::IsMenuItem<tauri::Wry>])
        .chain(
            sort_dir_buttons
                .iter()
                .map(|&b| b as &dyn tauri::menu::IsMenuItem<tauri::Wry>),
        )
        .collect();
    let sort_menu = Submenu::with_items(app, "Sort", true, &sort_all_buttons)?;

    let filter_defs = [
        ("filter-all", "All"),
        ("filter-downloading", "Downloading"),
        ("filter-finished", "Finished"),
        ("filter-paused", "Paused"),
        ("filter-seeding", "Seeding"),
        ("filter-verifying", "Verifying"),
    ];
    let filter_items = filter_defs
        .iter()
        .map(|(id, label)| {
            let item = MenuItem::with_id(app, *id, *label, true, None::<&str>)?;
            Ok(((*id).to_string(), (item, (*label).to_string())))
        })
        .collect::<tauri::Result<HashMap<_, _>>>()?;
    let filter_buttons: Vec<&dyn tauri::menu::IsMenuItem<tauri::Wry>> = filter_items
        .values()
        .map(|(item, _)| item as &dyn tauri::menu::IsMenuItem<tauri::Wry>)
        .collect();
    let filter_menu = Submenu::with_items(app, "Filter", true, &filter_buttons)?;

    let mut sort_state_map = HashMap::new();
    for (id, (item, label)) in &sort_items {
        sort_state_map.insert(
            id.trim_start_matches("sort-").to_string(),
            (item.clone(), label.clone()),
        );
    }
    app.state::<Mutex<AppState>>()
        .inner()
        .lock()
        .unwrap()
        .sort_menu_items = sort_state_map;
    let mut filter_state_map = HashMap::new();
    for (id, (item, label)) in &filter_items {
        filter_state_map.insert(
            id.trim_start_matches("filter-").to_string(),
            (item.clone(), label.clone()),
        );
    }
    app.state::<Mutex<AppState>>()
        .inner()
        .lock()
        .unwrap()
        .filter_menu_items = filter_state_map;

    let menu = Menu::with_items(
        app,
        &[
            &app_menu,
            &file_menu,
            &edit_menu,
            &torrent_menu,
            &sort_menu,
            &filter_menu,
        ],
    )?;
    app.set_menu(menu)?;

    app.on_menu_event(|app_handle, event| {
        let id = event.id().as_ref();
        match id {
            "about" => {
                let _ = app_handle.emit("menu-about", ());
            }
            "connection-settings" => {
                let _ = app_handle.emit("menu-connection-settings", ());
            }
            "add-url" => {
                let _ = app_handle.emit("menu-add-url", ());
            }
            "add-magnet" => {
                let _ = app_handle.emit("menu-add-magnet", ());
            }
            "add-file" => {
                let _ = app_handle.emit("menu-add-file", ());
            }
            "play" => {
                let _ = app_handle.emit("menu-play", ());
            }
            "pause" => {
                let _ = app_handle.emit("menu-pause", ());
            }
            "delete" => {
                let _ = app_handle.emit("menu-delete", ());
            }
            "verify" => {
                let _ = app_handle.emit("menu-verify", ());
            }
            "sort-queue" | "sort-date" | "sort-size" | "sort-name" | "sort-seeders"
            | "sort-leechers" => {
                let key = id.trim_start_matches("sort-").to_string();
                let state = app_handle.state::<Mutex<AppState>>();
                mark_active(&state.inner().lock().unwrap().sort_menu_items, &key);
                let _ = app_handle.emit("menu-sort", key);
            }
            "sort-asc" | "sort-desc" => {
                let key = id.trim_start_matches("sort-").to_string();
                let state = app_handle.state::<Mutex<AppState>>();
                mark_active(&state.inner().lock().unwrap().sort_dir_menu_items, &key);
                let _ = app_handle.emit("menu-sort-dir", key);
            }
            "filter-all" | "filter-downloading" | "filter-paused" | "filter-seeding"
            | "filter-verifying" | "filter-finished" => {
                let key = id.trim_start_matches("filter-").to_string();
                let state = app_handle.state::<Mutex<AppState>>();
                mark_active(&state.inner().lock().unwrap().filter_menu_items, &key);
                let _ = app_handle.emit("menu-filter", key);
            }
            _ => {}
        }
    });
    Ok(())
}

pub(crate) fn setup_tray(app: &tauri::App) -> tauri::Result<()> {
    let show_i = MenuItem::with_id(app, "tray-show", "Show", true, None::<&str>)?;
    let quit_i = MenuItem::with_id(app, "tray-quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show_i, &quit_i])?;

    let minimize_to_tray = app
        .state::<Mutex<AppState>>()
        .inner()
        .lock()
        .unwrap()
        .settings
        .minimize_to_tray;
    let tray = TrayIconBuilder::with_id("main-tray")
        .icon(app.default_window_icon().unwrap().clone())
        .tooltip("rTransmission Client")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "tray-show" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            "tray-quit" => {
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        })
        .build(app)?;
    tray.set_visible(minimize_to_tray)?;
    Ok(())
}
