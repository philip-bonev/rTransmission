use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;
use tauri::Emitter;
use tauri::Manager;
use tauri::State;
use transmission_rpc::TransClient;
use transmission_rpc::types::{
    BasicAuth, Id, Torrent, TorrentAction, TorrentAddArgs, TorrentAddedOrDuplicate,
    TorrentGetField, TorrentStatus,
};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub(crate) struct Settings {
    pub rpc_host: String,
    pub rpc_port: u16,
    pub rpc_auth: bool,
    pub rpc_username: String,
    pub rpc_password: String,
    #[serde(default)]
    pub rpc_https: bool,
    #[serde(default)]
    pub rpc_insecure: bool,
    #[serde(default = "default_auto_connect")]
    pub auto_connect: bool,
}

fn default_auto_connect() -> bool {
    true
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            rpc_host: "localhost".to_string(),
            rpc_port: 9091,
            rpc_auth: false,
            rpc_username: String::new(),
            rpc_password: String::new(),
            rpc_https: false,
            rpc_insecure: false,
            auto_connect: true,
        }
    }
}

pub(crate) struct AppState {
    pub cli_file: Option<String>,
    pub settings: Settings,
    pub settings_path: PathBuf,
    pub sort_menu_items: HashMap<String, (tauri::menu::MenuItem<tauri::Wry>, String)>,
    pub sort_dir_menu_items: HashMap<String, (tauri::menu::MenuItem<tauri::Wry>, String)>,
    pub filter_menu_items: HashMap<String, (tauri::menu::MenuItem<tauri::Wry>, String)>,
}

#[derive(Debug, Serialize, Clone)]
pub(crate) struct TorrentInfo {
    pub id: i64,
    pub name: String,
    pub status: String,
    pub percent_done: f64,
    pub time_left: i64,
    pub rate_download: i64,
    pub rate_upload: i64,
    pub seeders: i64,
    pub leechers: i64,
    pub queue_position: i64,
    pub added_date: i64,
    pub total_size: i64,
    pub download_dir: String,
    pub error: bool,
    pub error_string: String,
}

#[derive(Debug, Serialize, Clone)]
pub(crate) struct SessionStatsInfo {
    pub download_speed: i64,
    pub upload_speed: i64,
    pub torrent_count: i64,
    pub active_torrent_count: i64,
    pub paused_torrent_count: i64,
}

#[derive(Debug, Serialize, Clone)]
pub(crate) struct AltSpeedInfo {
    pub enabled: bool,
    pub download_limit: i64,
    pub upload_limit: i64,
}

struct RawRpc {
    url: url::Url,
    auth: Option<BasicAuth>,
    session_id: std::sync::RwLock<Option<String>>,
    client: reqwest::Client,
}

impl RawRpc {
    async fn call(
        &self,
        method: &str,
        args: Option<serde_json::Value>,
    ) -> Result<serde_json::Value, String> {
        let body = serde_json::json!({ "method": method, "arguments": args });
        for _ in 0..5 {
            let mut req = self.client.post(self.url.clone());
            if let Some(auth) = &self.auth {
                req = req.basic_auth(&auth.user, Some(&auth.password));
            }
            if let Some(id) = self.session_id.read().unwrap().as_ref() {
                req = req.header("X-Transmission-Session-Id", id);
            }
            let rsp = req
                .json(&body)
                .send()
                .await
                .map_err(|e| format!("HTTP error: {}", e))?;
            if rsp.status() == reqwest::StatusCode::CONFLICT {
                let id = rsp
                    .headers()
                    .get("X-Transmission-Session-Id")
                    .ok_or_else(|| "No session id received".to_string())?
                    .to_str()
                    .map_err(|e| e.to_string())?
                    .to_string();
                *self.session_id.write().unwrap() = Some(id);
                continue;
            }
            let json: serde_json::Value = rsp
                .json()
                .await
                .map_err(|e| format!("Decode error: {}", e))?;
            return Ok(json);
        }
        Err("Max retries reached".to_string())
    }

    async fn alt_speed(&self) -> Result<AltSpeedInfo, String> {
        let json = self.call("session-get", None).await?;
        let enabled = json["arguments"]["alt-speed-enabled"]
            .as_bool()
            .ok_or_else(|| "alt-speed-enabled missing in response".to_string())?;
        let download_limit =
            (json["arguments"]["alt-speed-down"].as_f64().unwrap_or(0.0) * 1024.0) as i64;
        let upload_limit =
            (json["arguments"]["alt-speed-up"].as_f64().unwrap_or(0.0) * 1024.0) as i64;
        Ok(AltSpeedInfo {
            enabled,
            download_limit,
            upload_limit,
        })
    }

    async fn set_alt_speed_enabled(&self, enabled: bool) -> Result<(), String> {
        self.call(
            "session-set",
            Some(serde_json::json!({ "alt-speed-enabled": enabled })),
        )
        .await?;
        Ok(())
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
fn update_menu_markers(state: State<Mutex<AppState>>, sort: String, sort_dir: String, filter: String) {
    let state = state.inner().lock().unwrap();
    mark_active(&state.sort_menu_items, &sort);
    mark_active(&state.sort_dir_menu_items, &sort_dir);
    mark_active(&state.filter_menu_items, &filter);
}

fn status_to_string(status: &TorrentStatus) -> String {
    match status {
        TorrentStatus::Stopped => "Stopped",
        TorrentStatus::QueuedToVerify => "Waiting to check",
        TorrentStatus::QueuedToDownload => "Waiting to download",
        TorrentStatus::Downloading => "Downloading",
        TorrentStatus::QueuedToSeed => "Waiting to seed",
        TorrentStatus::Seeding => "Seeding",
        TorrentStatus::Verifying => "Checking",
        _ => "Unknown",
    }
    .to_string()
}

fn torrent_fields() -> Vec<TorrentGetField> {
    vec![
        TorrentGetField::Id,
        TorrentGetField::Name,
        TorrentGetField::Status,
        TorrentGetField::PercentDone,
        TorrentGetField::Eta,
        TorrentGetField::RateDownload,
        TorrentGetField::RateUpload,
        TorrentGetField::PeersSendingToUs,
        TorrentGetField::PeersGettingFromUs,
        TorrentGetField::QueuePosition,
        TorrentGetField::AddedDate,
        TorrentGetField::TotalSize,
        TorrentGetField::DownloadDir,
        TorrentGetField::Error,
        TorrentGetField::ErrorString,
    ]
}

fn map_torrents(torrents: &[Torrent]) -> Vec<TorrentInfo> {
    torrents
        .iter()
        .map(|t| TorrentInfo {
            id: t.id.unwrap_or(0),
            name: t.name.clone().unwrap_or_default(),
            status: t.status.as_ref().map(status_to_string).unwrap_or_default(),
            percent_done: t.percent_done.unwrap_or(0.0) as f64,
            time_left: t.eta.unwrap_or(-1),
            rate_download: t.rate_download.unwrap_or(0),
            rate_upload: t.rate_upload.unwrap_or(0),
            seeders: t.peers_sending_to_us.unwrap_or(0),
            leechers: t.peers_getting_from_us.unwrap_or(0),
            queue_position: t.queue_position.unwrap_or(0) as i64,
            added_date: t.added_date.map(|d| d.timestamp()).unwrap_or(0),
            total_size: t.total_size.unwrap_or(0),
            download_dir: t.download_dir.clone().unwrap_or_default(),
            error: t.error_string.is_some() && !t.error_string.as_ref().unwrap().is_empty(),
            error_string: t.error_string.clone().unwrap_or_default(),
        })
        .collect()
}

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

const BASE64_CHARS: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

fn base64_encode(data: &[u8]) -> String {
    let mut out = String::with_capacity(data.len().div_ceil(3) * 4);
    for chunk in data.chunks(3) {
        let b0 = chunk[0];
        let b1 = *chunk.get(1).unwrap_or(&0);
        let b2 = *chunk.get(2).unwrap_or(&0);
        let n = (u32::from(b0) << 16) | (u32::from(b1) << 8) | u32::from(b2);
        out.push(BASE64_CHARS[(n >> 18) as usize & 0x3f] as char);
        out.push(BASE64_CHARS[(n >> 12) as usize & 0x3f] as char);
        out.push(if chunk.len() > 1 {
            BASE64_CHARS[(n >> 6) as usize & 0x3f] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            BASE64_CHARS[n as usize & 0x3f] as char
        } else {
            '='
        });
    }
    out
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
async fn rpc_add_torrent(
    input: String,
    download_dir: Option<String>,
    client_state: State<'_, tokio::sync::Mutex<Option<TransClient>>>,
) -> Result<String, String> {
    let mut guard = client_state.lock().await;
    let client = guard.as_mut().ok_or("Not connected")?;

    let add = if input.starts_with("magnet:")
        || input.starts_with("http://")
        || input.starts_with("https://")
    {
        TorrentAddArgs {
            filename: Some(input),
            download_dir,
            ..TorrentAddArgs::default()
        }
    } else {
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
                TorrentAddArgs {
                    filename: Some(magnet),
                    download_dir,
                    ..TorrentAddArgs::default()
                }
            }
            "torrent" => {
                let bytes = fs::read(path).map_err(|e| format!("Failed to read file: {}", e))?;
                TorrentAddArgs {
                    metainfo: Some(base64_encode(&bytes)),
                    download_dir,
                    ..TorrentAddArgs::default()
                }
            }
            _ => return Err("File is not a torrent, magnet link or URL".to_string()),
        }
    };

    let response = client
        .torrent_add(add)
        .await
        .map_err(|e| format!("Failed to add torrent: {}", e))?;
    if !response.is_ok() {
        return Err(format!(
            "Transmission rejected the request: {}",
            response.result
        ));
    }
    match response.arguments {
        TorrentAddedOrDuplicate::TorrentAdded(t) => {
            Ok(format!("Added torrent: {}", t.name.unwrap_or_default()))
        }
        TorrentAddedOrDuplicate::TorrentDuplicate(t) => Ok(format!(
            "Torrent already exists: {}",
            t.name.unwrap_or_default()
        )),
        TorrentAddedOrDuplicate::Error => {
            Err("Transmission reported an error while adding the torrent".to_string())
        }
    }
}

#[tauri::command]
async fn rpc_torrent_action(
    action: String,
    ids: Vec<i64>,
    client_state: State<'_, tokio::sync::Mutex<Option<TransClient>>>,
) -> Result<(), String> {
    let mut guard = client_state.lock().await;
    let client = guard.as_mut().ok_or("Not connected")?;
    let action = match action.as_str() {
        "start" => TorrentAction::Start,
        "pause" => TorrentAction::Stop,
        "verify" => TorrentAction::Verify,
        _ => return Err(format!("Unknown action: {}", action)),
    };
    let ids: Vec<Id> = ids.into_iter().map(Id::Id).collect();
    let response = client
        .torrent_action(action, ids)
        .await
        .map_err(|e| format!("RPC error: {}", e))?;
    if !response.is_ok() {
        return Err(format!(
            "Transmission rejected the request: {}",
            response.result
        ));
    }
    Ok(())
}

#[tauri::command]
async fn rpc_queue_move(
    action: String,
    ids: Vec<i64>,
    raw_state: State<'_, tokio::sync::Mutex<Option<RawRpc>>>,
) -> Result<(), String> {
    let method = match action.as_str() {
        "top" => "queue-move-top",
        "up" => "queue-move-up",
        "down" => "queue-move-down",
        "bottom" => "queue-move-bottom",
        _ => return Err(format!("Unknown queue action: {}", action)),
    };
    let guard = raw_state.lock().await;
    let raw = guard.as_ref().ok_or("Not connected")?;
    let json = raw
        .call(method, Some(serde_json::json!({ "ids": ids })))
        .await?;
    if json["result"].as_str() != Some("success") {
        return Err(format!(
            "Transmission rejected the request: {}",
            json["result"].as_str().unwrap_or("unknown")
        ));
    }
    Ok(())
}

#[tauri::command]
async fn rpc_torrent_remove(
    ids: Vec<i64>,
    delete_data: bool,
    client_state: State<'_, tokio::sync::Mutex<Option<TransClient>>>,
) -> Result<(), String> {
    let mut guard = client_state.lock().await;
    let client = guard.as_mut().ok_or("Not connected")?;
    let ids: Vec<Id> = ids.into_iter().map(Id::Id).collect();
    let response = client
        .torrent_remove(ids, delete_data)
        .await
        .map_err(|e| format!("RPC error: {}", e))?;
    if !response.is_ok() {
        return Err(format!(
            "Transmission rejected the request: {}",
            response.result
        ));
    }
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ConnectRequest {
    pub host: String,
    pub port: u16,
    pub auth: bool,
    pub username: String,
    pub password: String,
    pub https: bool,
    pub insecure: bool,
}

#[tauri::command]
async fn rpc_connect(
    args: ConnectRequest,
    client_state: State<'_, tokio::sync::Mutex<Option<TransClient>>>,
    raw_state: State<'_, tokio::sync::Mutex<Option<RawRpc>>>,
) -> Result<(), String> {
    let scheme = if args.https { "https" } else { "http" };
    let url_str = format!("{}://{}:{}/transmission/rpc", scheme, args.host, args.port);
    let url = url::Url::parse(&url_str).map_err(|e| format!("Invalid URL: {}", e))?;

    let mut builder = reqwest::Client::builder();
    if args.insecure {
        builder = builder.danger_accept_invalid_certs(true);
    }
    let http_client = builder
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {}", e))?;

    let mut client = TransClient::new_with_client(url.clone(), http_client.clone());
    if args.auth {
        client.set_auth(BasicAuth {
            user: args.username.clone(),
            password: args.password.clone(),
        });
    }
    client
        .session_get()
        .await
        .map_err(|e| format!("Connection failed: {}", e))?;

    let raw = RawRpc {
        url,
        auth: if args.auth {
            Some(BasicAuth {
                user: args.username,
                password: args.password,
            })
        } else {
            None
        },
        session_id: std::sync::RwLock::new(None),
        client: http_client,
    };
    *client_state.lock().await = Some(client);
    *raw_state.lock().await = Some(raw);
    Ok(())
}

#[tauri::command]
async fn rpc_toggle_alt_speed(
    raw_state: State<'_, tokio::sync::Mutex<Option<RawRpc>>>,
) -> Result<AltSpeedInfo, String> {
    let guard = raw_state.lock().await;
    let raw = guard.as_ref().ok_or("Not connected")?;
    let info = raw.alt_speed().await?;
    let new = !info.enabled;
    raw.set_alt_speed_enabled(new).await?;
    Ok(AltSpeedInfo {
        enabled: new,
        ..info
    })
}

#[tauri::command]
async fn rpc_disconnect(
    client_state: State<'_, tokio::sync::Mutex<Option<TransClient>>>,
    raw_state: State<'_, tokio::sync::Mutex<Option<RawRpc>>>,
) -> Result<(), String> {
    *client_state.lock().await = None;
    *raw_state.lock().await = None;
    Ok(())
}

#[tauri::command]
async fn rpc_get_torrents(
    client_state: State<'_, tokio::sync::Mutex<Option<TransClient>>>,
) -> Result<Vec<TorrentInfo>, String> {
    let mut guard = client_state.lock().await;
    let client = guard.as_mut().ok_or("Not connected")?;
    let response = client
        .torrent_get(Some(torrent_fields()), None)
        .await
        .map_err(|e| format!("RPC error: {}", e))?;
    Ok(map_torrents(&response.arguments.torrents))
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
            get_cli_file,
            get_settings,
            set_settings,
            rpc_connect,
            rpc_disconnect,
            rpc_toggle_alt_speed,
            rpc_add_torrent,
            rpc_get_torrents,
            rpc_torrent_action,
            rpc_torrent_remove,
            rpc_queue_move,
            update_menu_markers,
        ])
        .setup(|app| {
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
            app.manage(Mutex::new(AppState {
                cli_file,
                settings,
                settings_path,
                sort_menu_items: HashMap::new(),
                sort_dir_menu_items: HashMap::new(),
                filter_menu_items: HashMap::new(),
            }));
            app.manage(tokio::sync::Mutex::new(None::<TransClient>));
            app.manage(tokio::sync::Mutex::new(None::<RawRpc>));

            {
                use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};

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
                        &PredefinedMenuItem::about(app, None, None)?,
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

                let add_url =
                    MenuItem::with_id(app, "add-url", "Add Torrent URL…", true, None::<&str>)?;
                let add_magnet =
                    MenuItem::with_id(app, "add-magnet", "Add Magnet Link…", true, None::<&str>)?;
                let add_file =
                    MenuItem::with_id(app, "add-file", "Add Torrent File…", true, None::<&str>)?;
                let file_menu =
                    Submenu::with_items(app, "File", true, &[&add_url, &add_magnet, &add_file])?;

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
                let sort_dir_buttons: Vec<&dyn tauri::menu::IsMenuItem<tauri::Wry>> =
                    sort_dir_items
                        .values()
                        .map(|(item, _)| item as &dyn tauri::menu::IsMenuItem<tauri::Wry>)
                        .collect();

                let mut sort_dir_state_map = std::collections::HashMap::new();
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
                    .chain(
                        [&sort_separator as &dyn tauri::menu::IsMenuItem<tauri::Wry>]
                            .into_iter(),
                    )
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

                let mut sort_state_map = std::collections::HashMap::new();
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
                let mut filter_state_map = std::collections::HashMap::new();
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
                        &torrent_menu,
                        &sort_menu,
                        &filter_menu,
                    ],
                )?;
                app.set_menu(menu)?;

                app.on_menu_event(|app_handle, event| {
                    let id = event.id().as_ref();
                    match id {
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
                        "sort-queue" | "sort-date" | "sort-size" | "sort-name"
                        | "sort-seeders" | "sort-leechers" => {
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
                        "filter-all" | "filter-downloading" | "filter-paused"
                        | "filter-seeding" | "filter-verifying" | "filter-finished" => {
                            let key = id.trim_start_matches("filter-").to_string();
                            let state = app_handle.state::<Mutex<AppState>>();
                            mark_active(&state.inner().lock().unwrap().filter_menu_items, &key);
                            let _ = app_handle.emit("menu-filter", key);
                        }
                        _ => {}
                    }
                });
            }

            let handle = app.handle().clone();
            let fields = torrent_fields();
            tauri::async_runtime::spawn(async move {
                loop {
                    tokio::time::sleep(Duration::from_secs(1)).await;
                    {
                        let state = handle.state::<tokio::sync::Mutex<Option<TransClient>>>();
                        let mut guard = state.lock().await;
                        if let Some(ref mut client) = *guard {
                            match client.torrent_get(Some(fields.clone()), None).await {
                                Ok(response) => {
                                    let torrents = map_torrents(&response.arguments.torrents);
                                    let _ = handle.emit("torrents-update", &torrents);
                                }
                                Err(e) => {
                                    log::error!("RPC poll error: {}", e);
                                }
                            }
                            if let Ok(response) = client.session_stats().await {
                                let stats = response.arguments;
                                let info = SessionStatsInfo {
                                    download_speed: stats.download_speed,
                                    upload_speed: stats.upload_speed,
                                    torrent_count: i64::from(stats.torrent_count),
                                    active_torrent_count: i64::from(stats.active_torrent_count),
                                    paused_torrent_count: i64::from(stats.paused_torrent_count),
                                };
                                let _ = handle.emit("session-stats-update", &info);
                            }
                        }
                    }
                    {
                        let raw_state = handle.state::<tokio::sync::Mutex<Option<RawRpc>>>();
                        let raw_guard = raw_state.lock().await;
                        if let Some(raw) = raw_guard.as_ref()
                            && let Ok(info) = raw.alt_speed().await
                        {
                            let _ = handle.emit("alt-speed-update", &info);
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
                if url.scheme() == "file"
                    && let Ok(path) = url.to_file_path()
                    && is_torrent_input(&path.to_string_lossy())
                {
                    let path_str = path.to_string_lossy().to_string();
                    let state = app_handle.state::<Mutex<AppState>>();
                    let mut state = state.inner().lock().unwrap();
                    state.cli_file = Some(path_str.clone());
                    let _ = app_handle.emit("file-opened", path_str);
                } else if matches!(url.scheme(), "magnet" | "http" | "https") {
                    let url_str = url.to_string();
                    let state = app_handle.state::<Mutex<AppState>>();
                    let mut state = state.inner().lock().unwrap();
                    state.cli_file = Some(url_str.clone());
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
