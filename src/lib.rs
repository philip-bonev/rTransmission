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

mod menu;
mod models;
mod notifications;
mod poll;
mod raw_rpc;
mod rpc;
mod settings;
mod state;
mod windows;

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

use tauri::Emitter;
use tauri::Manager;
use transmission_rpc::TransClient;

use crate::raw_rpc::RawRpc;
use crate::settings::load_settings;
use crate::state::{AppState, CLI_FILE};
use crate::windows::show_main_window;

fn is_torrent_input(input: &str) -> bool {
    if input.starts_with("magnet:") || input.starts_with("http://") || input.starts_with("https://")
    {
        return true;
    }
    std::path::Path::new(input)
        .extension()
        .map(|ext| {
            let ext = ext.to_string_lossy().to_lowercase();
            matches!(ext.as_ref(), "torrent" | "magnet")
        })
        .unwrap_or(false)
}

#[tauri::command]
fn get_cli_file() -> Option<String> {
    CLI_FILE.lock().unwrap().take()
}

#[tauri::command]
fn validate_torrent_input(input: String) -> Result<(), String> {
    if input.starts_with("magnet:") || input.starts_with("http://") || input.starts_with("https://")
    {
        return Ok(());
    }
    let path = std::path::Path::new(&input);
    if !path.exists() {
        return Err(format!("File does not exist: {}", input));
    }
    let ext = path
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    match ext.as_ref() {
        "magnet" => {
            let content =
                fs::read_to_string(path).map_err(|e| format!("Failed to read file: {}", e))?;
            let magnet = content
                .trim()
                .lines()
                .next()
                .unwrap_or("")
                .trim()
                .to_string();
            if !magnet.starts_with("magnet:") {
                return Err("Magnet file does not contain a magnet link".to_string());
            }
            Ok(())
        }
        "torrent" => Ok(()),
        _ => Err("File is not a torrent, magnet link or URL".to_string()),
    }
}

#[tauri::command]
fn get_about_info() -> serde_json::Value {
    let version = env!("CARGO_PKG_VERSION");
    let date = env!("BUILD_DATE");
    let license = include_str!("../LICENSE");
    serde_json::json!({
        "version": version,
        "build_date": date,
        "license": license,
    })
}

pub fn run() {
    let cli_file = find_file_in_args(std::env::args().skip(1));

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            if argv
                .iter()
                .any(|arg| arg.starts_with("rtransmission://notification"))
            {
                show_main_window(app);
            }
            if let Some(path) = find_file_in_args(argv.iter().cloned()) {
                *CLI_FILE.lock().unwrap() = Some(path.clone());
                let _ = app.emit("file-opened", path);
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_denylist(&[
                    "properties",
                    "settings",
                    "connection-settings",
                    "add",
                    "delete",
                    "about",
                ])
                .build(),
        )
        .plugin(tauri_plugin_deep_link::init())
        .on_window_event(|window, event| {
            if window.label() == "main"
                && let tauri::WindowEvent::CloseRequested { api, .. } = event
            {
                let handle = window.app_handle();
                if let Some(state) = handle.try_state::<Mutex<AppState>>() {
                    let settings = state.inner().lock().unwrap().settings.clone();
                    if settings.minimize_to_tray {
                        let _ = window.hide();
                        api.prevent_close();
                    } else {
                        handle.exit(0);
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_cli_file,
            settings::get_settings,
            settings::set_settings,
            rpc::rpc_connect,
            rpc::rpc_disconnect,
            rpc::rpc_toggle_alt_speed,
            rpc::rpc_get_session_settings,
            rpc::rpc_set_session_settings,
            rpc::rpc_add_torrent,
            validate_torrent_input,
            rpc::rpc_get_torrents,
            rpc::rpc_torrent_action,
            rpc::rpc_torrent_remove,
            rpc::rpc_queue_move,
            rpc::rpc_get_free_space,
            rpc::rpc_torrent_rename_path,
            windows::open_properties_window,
            windows::get_properties_torrent_id,
            windows::open_settings_window,
            windows::open_connection_settings_window,
            windows::open_about_window,
            windows::open_add_window,
            windows::get_add_payload,
            windows::open_delete_window,
            windows::get_delete_ids,
            windows::close_dialog_window,
            rpc::is_connected,
            rpc::rpc_get_torrent_details,
            rpc::rpc_set_files_wanted,
            rpc::rpc_set_files_priority,
            menu::update_menu_markers,
            get_about_info,
            notifications::send_notification,
        ])
        .setup(|app| {
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                let app_handle = app.handle().clone();
                app.deep_link().on_open_url(move |event| {
                    if event
                        .urls()
                        .iter()
                        .any(|url| url.scheme() == "rtransmission")
                    {
                        show_main_window(&app_handle);
                    }
                });
            }

            let home = std::env::var("HOME")
                .or_else(|_| std::env::var("USERPROFILE"))
                .ok()
                .filter(|s| !s.is_empty())
                .or_else(|| {
                    let drive = std::env::var("HOMEDRIVE").ok().filter(|s| !s.is_empty());
                    let path = std::env::var("HOMEPATH").ok().filter(|s| !s.is_empty());
                    match (drive, path) {
                        (Some(d), Some(p)) => Some(format!("{}{}", d, p)),
                        _ => None,
                    }
                })
                .unwrap_or_else(|| std::env::temp_dir().to_string_lossy().to_string());
            let config_dir = PathBuf::from(home).join(".rtransmission");
            fs::create_dir_all(&config_dir).expect("failed to create config dir");
            let settings_path = config_dir.join("config.json");
            let settings = load_settings(&settings_path);
            if CLI_FILE.lock().unwrap().is_none() {
                *CLI_FILE.lock().unwrap() = cli_file;
            }
            app.manage(Mutex::new(AppState {
                settings,
                settings_path,
                sort_menu_items: HashMap::new(),
                sort_dir_menu_items: HashMap::new(),
                filter_menu_items: HashMap::new(),
            }));
            app.manage(tokio::sync::Mutex::new(None::<TransClient>));
            app.manage(tokio::sync::Mutex::new(None::<RawRpc>));
            app.manage(tokio::sync::Mutex::new(HashSet::<i64>::new()));

            menu::setup_app_menu(app)?;
            menu::setup_tray(app)?;

            poll::spawn_poll_loop(app.handle().clone());

            #[cfg(debug_assertions)]
            if let Some(window) = app.get_webview_window("main") {
                window.open_devtools();
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    #[allow(unused_variables)]
    app.run(|app_handle, event| {
        // Closing the last window must not kill the app when minimize-to-tray is
        // active. Programmatic exits (tray quit / app.exit) carry code: Some and
        // always proceed. Menu Quit on macOS uses NSApplication terminate and
        // never reaches this handler.
        if let tauri::RunEvent::ExitRequested {
            code: None, api, ..
        } = &event
            && let Some(state) = app_handle.try_state::<Mutex<AppState>>()
            && state.lock().unwrap().settings.minimize_to_tray
        {
            api.prevent_exit();
            return;
        }

        // macOS dock click on an already-running instance (applicationShouldHandleReopen).
        // Without this the window stays hidden after minimize-to-tray.
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Reopen { .. } = &event
            && let Some(window) = app_handle.get_webview_window("main")
        {
            let _ = window.show();
            let _ = window.unminimize();
            let _ = window.set_focus();
        }

        #[cfg(any(target_os = "macos", target_os = "ios", target_os = "android"))]
        if let tauri::RunEvent::Opened { urls } = event {
            for url in urls {
                if url.scheme() == "file"
                    && let Ok(path) = url.to_file_path()
                    && is_torrent_input(&path.to_string_lossy())
                {
                    let path_str = path.to_string_lossy().to_string();
                    *CLI_FILE.lock().unwrap() = Some(path_str.clone());
                    let _ = app_handle.emit("file-opened", path_str);
                } else if matches!(url.scheme(), "magnet" | "http" | "https") {
                    let url_str = url.to_string();
                    *CLI_FILE.lock().unwrap() = Some(url_str.clone());
                    let _ = app_handle.emit("file-opened", url_str);
                }
            }
        }
    });
}

fn find_file_in_args(args: impl Iterator<Item = String>) -> Option<String> {
    for arg in args {
        #[cfg(target_os = "macos")]
        if arg.starts_with("-psn_") {
            continue;
        }
        if is_torrent_input(&arg) {
            if arg.starts_with("file://")
                && let Ok(url) = url::Url::parse(&arg)
                && let Ok(path) = url.to_file_path()
            {
                return Some(path.to_string_lossy().to_string());
            }
            return Some(arg);
        }
    }
    None
}
