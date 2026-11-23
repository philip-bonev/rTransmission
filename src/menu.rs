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

#[cfg(target_os = "windows")]
#[link(name = "kernel32")]
unsafe extern "system" {
    fn GetUserDefaultLocaleName(lp_locale_name: *mut u16, cch_locale_name: i32) -> i32;
}

#[cfg(target_os = "windows")]
fn windows_locale() -> String {
    let mut buf = [0u16; 85];
    let len = unsafe { GetUserDefaultLocaleName(buf.as_mut_ptr(), buf.len() as i32) };
    if len > 1 {
        String::from_utf16_lossy(&buf[..len as usize - 1])
    } else {
        String::new()
    }
}

#[cfg(target_os = "macos")]
fn apple_languages() -> Option<String> {
    let output = std::process::Command::new("defaults")
        .args(["read", "-g", "AppleLanguages"])
        .output()
        .ok()?;
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .find_map(|line| {
            let line = line
                .trim()
                .trim_matches(|c: char| c == '"' || c == ',' || c == '(' || c == ')');
            (!line.is_empty()).then(|| line.to_string())
        })
}

#[cfg(not(target_os = "windows"))]
fn env_locale() -> String {
    ["LC_ALL", "LC_MESSAGES", "LANG"]
        .into_iter()
        .find_map(|var| std::env::var(var).ok().filter(|value| !value.is_empty()))
        .unwrap_or_default()
}

fn system_locale() -> String {
    #[cfg(target_os = "windows")]
    let locale = windows_locale();
    #[cfg(target_os = "macos")]
    let locale = apple_languages().unwrap_or_else(env_locale);
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    let locale = env_locale();
    locale
}

/// Translate a native menu label. Only English and Bulgarian are supported;
/// any other system locale falls back to English.
fn tr(en: &'static str, bg: &'static str) -> &'static str {
    static LOCALE: std::sync::OnceLock<String> = std::sync::OnceLock::new();
    let locale = LOCALE.get_or_init(system_locale);
    if locale.to_lowercase().starts_with("bg") {
        bg
    } else {
        en
    }
}

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
        tr("Connection Settings…", "Настройки на връзката…"),
        true,
        None::<&str>,
    )?;
    let about = MenuItem::with_id(
        app,
        "about",
        tr("About rTransmission Client", "Относно rTransmission Client"),
        true,
        None::<&str>,
    )?;
    let quit = PredefinedMenuItem::quit(app, None)?;
    let app_separator = PredefinedMenuItem::separator(app)?;
    #[cfg(target_os = "macos")]
    let quit_separator = PredefinedMenuItem::separator(app)?;
    let app_menu = {
        #[cfg(target_os = "macos")]
        {
            let services = PredefinedMenuItem::services(app, None)?;
            let hide = PredefinedMenuItem::hide(app, None)?;
            let hide_others = PredefinedMenuItem::hide_others(app, None)?;
            let show_all = PredefinedMenuItem::show_all(app, None)?;
            let mac_separator = PredefinedMenuItem::separator(app)?;
            Submenu::with_items(
                app,
                app.package_info().name.clone(),
                true,
                &[
                    &about,
                    &connection_settings,
                    &app_separator,
                    &services,
                    &mac_separator,
                    &hide,
                    &hide_others,
                    &show_all,
                    &quit_separator,
                    &quit,
                ],
            )?
        }
        #[cfg(not(target_os = "macos"))]
        {
            Submenu::with_items(
                app,
                app.package_info().name.clone(),
                true,
                &[&about, &connection_settings, &app_separator, &quit],
            )?
        }
    };

    let add_url = MenuItem::with_id(
        app,
        "add-url",
        tr("Add Torrent URL…", "Добави торент по URL…"),
        true,
        None::<&str>,
    )?;
    let add_magnet = MenuItem::with_id(
        app,
        "add-magnet",
        tr("Add Magnet Link…", "Добави магнитна връзка…"),
        true,
        None::<&str>,
    )?;
    let add_file = MenuItem::with_id(
        app,
        "add-file",
        tr("Add Torrent File…", "Добави торент файл…"),
        true,
        None::<&str>,
    )?;
    let file_menu = Submenu::with_items(
        app,
        tr("File", "Файл"),
        true,
        &[&add_url, &add_magnet, &add_file],
    )?;

    let edit_menu = Submenu::with_items(
        app,
        tr("Edit", "Редактиране"),
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

    let play = MenuItem::with_id(app, "play", tr("Play", "Старт"), true, None::<&str>)?;
    let pause = MenuItem::with_id(app, "pause", tr("Pause", "Пауза"), true, None::<&str>)?;
    let delete = MenuItem::with_id(app, "delete", tr("Delete", "Изтриване"), true, None::<&str>)?;
    let verify = MenuItem::with_id(app, "verify", tr("Verify", "Проверка"), true, None::<&str>)?;
    let torrent_menu = Submenu::with_items(
        app,
        tr("Torrent", "Торент"),
        true,
        &[&play, &pause, &delete, &verify],
    )?;

    let sort_defs = [
        ("sort-date", tr("Date", "Дата")),
        ("sort-leechers", tr("Leechers", "Лийчъри")),
        ("sort-name", tr("Name", "Име")),
        ("sort-queue", tr("Queue", "Опашка")),
        ("sort-seeders", tr("Seeders", "Сийдъри")),
        ("sort-size", tr("Size", "Размер")),
    ];
    let sort_items = sort_defs
        .iter()
        .map(|(id, label)| {
            let item = MenuItem::with_id(app, *id, *label, true, None::<&str>)?;
            Ok(((*id).to_string(), (item, (*label).to_string())))
        })
        .collect::<tauri::Result<HashMap<_, _>>>()?;
    let sort_dir_defs = [
        ("sort-asc", tr("Sort Ascending", "Сортиране възходящо")),
        ("sort-desc", tr("Sort Descending", "Сортиране низходящо")),
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
    let sort_menu = Submenu::with_items(app, tr("Sort", "Сортиране"), true, &sort_all_buttons)?;

    let filter_defs = [
        ("filter-all", tr("All", "Всички")),
        ("filter-downloading", tr("Downloading", "Сваляне")),
        ("filter-finished", tr("Finished", "Завършено")),
        ("filter-paused", tr("Paused", "Паузирано")),
        ("filter-seeding", tr("Seeding", "Споделяне")),
        ("filter-verifying", tr("Verifying", "Проверка")),
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
    let filter_menu = Submenu::with_items(app, tr("Filter", "Филтър"), true, &filter_buttons)?;

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
    let show_i = MenuItem::with_id(app, "tray-show", tr("Show", "Покажи"), true, None::<&str>)?;
    let quit_i = MenuItem::with_id(app, "tray-quit", tr("Quit", "Изход"), true, None::<&str>)?;
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
