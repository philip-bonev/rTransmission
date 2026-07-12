use std::path::{self, PathBuf};
use std::sync::Mutex;
use tauri::Manager;
use tauri::State;

pub(crate) struct AppState {
    pub file_path: Option<PathBuf>,
    pub cli_file: Option<String>,
}

#[tauri::command]
fn exit_app(app: tauri::AppHandle) -> Result<(), String> {
    app.exit(0);
    Ok(())
}

#[tauri::command]
fn open_torrent_file(path: String, state: State<'_, Mutex<AppState>>) -> Result<(), String> {
    let path = path::Path::new(&path);
    if !path.exists() {
        return Err("File does not exist".to_string());
    }
    if let Some(ext) = path.extension() {
        let ext = ext.to_string_lossy().to_lowercase();
        if !matches!(ext.as_ref(), "torrent" | "magnet") {
            return Err("File is not a torrent or magnet link".to_string());
        }
    } else {
        return Err("File has no extension".to_string());
    }

    let mut state = state.lock().unwrap();
    state.file_path = Some(path.to_path_buf());
    Ok(())
}

#[tauri::command]
fn get_cli_file(state: State<'_, Mutex<AppState>>) -> Option<String> {
    let mut state = state.lock().unwrap();
    state.cli_file.take()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let cli_file = find_file_in_args(std::env::args().skip(1));

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            use tauri::Emitter;
            use tauri::Manager;
            if let Some(path) = find_file_in_args(argv.iter().cloned()) {
                let state = app.state::<Mutex<AppState>>();
                let mut state = state.inner().lock().unwrap();
                state.cli_file = Some(path.clone());
                let _ = app.emit("file-opened", path);
            }
        }))
        .manage(Mutex::new(AppState {
            file_path: None,
            cli_file,
        }))
        .invoke_handler(tauri::generate_handler![
            open_torrent_file,
            exit_app,
            get_cli_file,
        ])
        .setup(|app| {
            // Only automatically open DevTools during debug builds
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
        #[cfg(any(target_os = "macos", target_os = "ios", target_os = "android"))]
        if let tauri::RunEvent::Opened { urls } = event {
            use tauri::Emitter;
            use tauri::Manager;
            for url in urls {
                if url.scheme() == "file" {
                    if let Ok(path) = url.to_file_path() {
                        if let Some(ext) = path.extension() {
                            let ext = ext.to_string_lossy().to_lowercase();
                            if matches!(ext.as_ref(), "torrent" | "magnet") {
                                let path_str = path.to_string_lossy().to_string();
                                let state = app_handle.state::<Mutex<AppState>>();
                                let mut state = state.inner().lock().unwrap();
                                state.cli_file = Some(path_str.clone());
                                let _ = app_handle.emit("file-opened", path_str);
                            }
                        }
                    }
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
        if arg.starts_with("-") {
            continue;
        }
        let path = std::path::Path::new(&arg);
        if let Some(ext) = path.extension() {
            let ext = ext.to_string_lossy().to_lowercase();
            // TODO fix magnet links
            if matches!(ext.as_ref(), "torrent" | "magnet") {
                let decoded = percent_encoding::percent_decode_str(&arg).decode_utf8_lossy();
                return Some(
                    decoded
                        .strip_prefix("file://")
                        .unwrap_or(&decoded)
                        .to_string(),
                );
            }
        }
    }
    None
}
