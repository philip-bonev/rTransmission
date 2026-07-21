use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{self, PathBuf};
use std::sync::Mutex;
use std::time::Duration;
use tauri::Emitter;
use tauri::Manager;
use tauri::State;
use transmission_rpc::TransClient;
use transmission_rpc::types::{BasicAuth, TorrentGetField, TorrentStatus};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub(crate) struct Settings {
    pub theme: String,
    pub rpc_host: String,
    pub rpc_port: u16,
    pub rpc_auth: bool,
    pub rpc_username: String,
    pub rpc_password: String,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            theme: "dark".to_string(),
            rpc_host: "localhost".to_string(),
            rpc_port: 9091,
            rpc_auth: false,
            rpc_username: String::new(),
            rpc_password: String::new(),
        }
    }
}

pub(crate) struct AppState {
    pub file_path: Option<PathBuf>,
    pub cli_file: Option<String>,
    pub settings: Settings,
    pub settings_path: PathBuf,
}

#[derive(Debug, Serialize, Clone)]
pub(crate) struct TorrentInfo {
    pub id: i64,
    pub name: String,
    pub status: String,
    pub rate_download: i64,
    pub rate_upload: i64,
    pub upload_ratio: f64,
    pub downloaded_ever: u64,
    pub total_size: i64,
    pub percent_done: f64,
    pub error: bool,
    pub error_string: String,
}

fn status_to_string(status: &TorrentStatus) -> String {
    match status {
        TorrentStatus::Stopped => "Stopped",
        TorrentStatus::QueuedToVerify => "Waiting to check",
        TorrentStatus::QueuedToDownload => "Waiting to download",
        TorrentStatus::Downloading => "Downloading",
        TorrentStatus::QueuedToSeed => "Waiting to seed",
        TorrentStatus::Seeding => "Seeding",
        _ => "Unknown",
    }
    .to_string()
}

fn load_settings(path: &PathBuf) -> Settings {
    fs::read_to_string(path)
        .ok()
        .and_then(|content| serde_json::from_str(&content).ok())
        .unwrap_or_default()
}

fn save_settings(path: &PathBuf, settings: &Settings) -> Result<(), String> {
    let content = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    fs::write(path, content).map_err(|e| e.to_string())?;
    Ok(())
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

#[tauri::command]
fn get_settings(state: State<'_, Mutex<AppState>>) -> Result<Settings, String> {
    let state = state.lock().unwrap();
    Ok(state.settings.clone())
}

#[tauri::command]
fn set_settings(new_settings: Settings, state: State<'_, Mutex<AppState>>) -> Result<(), String> {
    let mut state = state.lock().unwrap();
    state.settings = new_settings.clone();
    save_settings(&state.settings_path, &new_settings)
}

#[tauri::command]
async fn rpc_connect(
    host: String,
    port: u16,
    auth: bool,
    username: String,
    password: String,
    client_state: State<'_, tokio::sync::Mutex<Option<TransClient>>>,
) -> Result<(), String> {
    let url_str = format!("http://{}:{}", host, port);
    let url = url::Url::parse(&url_str).map_err(|e| format!("Invalid URL: {}", e))?;
    let mut client = if auth {
        let basic_auth = BasicAuth {
            user: username,
            password,
        };
        TransClient::with_auth(url, basic_auth)
    } else {
        TransClient::new(url)
    };
    client
        .session_get()
        .await
        .map_err(|e| format!("Connection failed: {}", e))?;
    let mut guard = client_state.lock().await;
    *guard = Some(client);
    Ok(())
}

#[tauri::command]
async fn rpc_disconnect(
    client_state: State<'_, tokio::sync::Mutex<Option<TransClient>>>,
) -> Result<(), String> {
    let mut guard = client_state.lock().await;
    *guard = None;
    Ok(())
}

#[tauri::command]
async fn rpc_get_torrents(
    client_state: State<'_, tokio::sync::Mutex<Option<TransClient>>>,
) -> Result<Vec<TorrentInfo>, String> {
    let mut guard = client_state.lock().await;
    let client = guard.as_mut().ok_or("Not connected")?;
    let fields = vec![
        TorrentGetField::Id,
        TorrentGetField::Name,
        TorrentGetField::Status,
        TorrentGetField::RateDownload,
        TorrentGetField::RateUpload,
        TorrentGetField::UploadRatio,
        TorrentGetField::DownloadedEver,
        TorrentGetField::TotalSize,
        TorrentGetField::PercentDone,
        TorrentGetField::Error,
        TorrentGetField::ErrorString,
    ];
    let response = client
        .torrent_get(Some(fields), None)
        .await
        .map_err(|e| format!("RPC error: {}", e))?;
    let torrents: Vec<TorrentInfo> = response
        .arguments
        .torrents
        .iter()
        .map(|t| TorrentInfo {
            id: t.id.unwrap_or(0),
            name: t.name.clone().unwrap_or_default(),
            status: t.status.as_ref().map(status_to_string).unwrap_or_default(),
            rate_download: t.rate_download.unwrap_or(0),
            rate_upload: t.rate_upload.unwrap_or(0),
            upload_ratio: t.upload_ratio.unwrap_or(0.0) as f64,
            downloaded_ever: t.downloaded_ever.unwrap_or(0),
            total_size: t.total_size.unwrap_or(0),
            percent_done: t.percent_done.unwrap_or(0.0) as f64,
            error: t.error_string.is_some() && !t.error_string.as_ref().unwrap().is_empty(),
            error_string: t.error_string.clone().unwrap_or_default(),
        })
        .collect();
    Ok(torrents)
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
        .invoke_handler(tauri::generate_handler![
            open_torrent_file,
            exit_app,
            get_cli_file,
            get_settings,
            set_settings,
            rpc_connect,
            rpc_disconnect,
            rpc_get_torrents,
        ])
        .setup(|app| {
            let home = std::env::var("HOME")
                .or_else(|_| std::env::var("USERPROFILE"))
                .expect("failed to get home directory");
            let config_dir = PathBuf::from(home).join(".rtransmission");
            fs::create_dir_all(&config_dir).expect("failed to create config dir");
            let settings_path = config_dir.join("config.json");
            let settings = load_settings(&settings_path);
            app.manage(Mutex::new(AppState {
                file_path: None,
                cli_file,
                settings,
                settings_path,
            }));
            app.manage(tokio::sync::Mutex::new(None::<TransClient>));

            let handle = app.handle().clone();
            let fields = vec![
                TorrentGetField::Id,
                TorrentGetField::Name,
                TorrentGetField::Status,
                TorrentGetField::RateDownload,
                TorrentGetField::RateUpload,
                TorrentGetField::UploadRatio,
                TorrentGetField::DownloadedEver,
                TorrentGetField::TotalSize,
                TorrentGetField::PercentDone,
                TorrentGetField::Error,
                TorrentGetField::ErrorString,
            ];
            tauri::async_runtime::spawn(async move {
                loop {
                    tokio::time::sleep(Duration::from_secs(1)).await;
                    let state = handle.state::<tokio::sync::Mutex<Option<TransClient>>>();
                    let mut guard = state.lock().await;
                    if let Some(ref mut client) = *guard {
                        match client.torrent_get(Some(fields.clone()), None).await {
                            Ok(response) => {
                                let torrents: Vec<TorrentInfo> = response
                                    .arguments
                                    .torrents
                                    .iter()
                                    .map(|t| TorrentInfo {
                                        id: t.id.unwrap_or(0),
                                        name: t.name.clone().unwrap_or_default(),
                                        status: t
                                            .status
                                            .as_ref()
                                            .map(status_to_string)
                                            .unwrap_or_default(),
                                        rate_download: t.rate_download.unwrap_or(0),
                                        rate_upload: t.rate_upload.unwrap_or(0),
                                        upload_ratio: t.upload_ratio.unwrap_or(0.0) as f64,
                                        downloaded_ever: t.downloaded_ever.unwrap_or(0),
                                        total_size: t.total_size.unwrap_or(0),
                                        percent_done: t.percent_done.unwrap_or(0.0) as f64,
                                        error: t.error_string.is_some()
                                            && !t.error_string.as_ref().unwrap().is_empty(),
                                        error_string: t.error_string.clone().unwrap_or_default(),
                                    })
                                    .collect();
                                let _ = handle.emit("torrents-update", &torrents);
                            }
                            Err(e) => {
                                log::error!("RPC poll error: {}", e);
                            }
                        }
                    }
                }
            });

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
