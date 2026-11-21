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

use std::collections::HashSet;
use std::fs;

use tauri::Emitter;
use tauri::Manager;
use tauri::State;
use transmission_rpc::TransClient;
use transmission_rpc::types::{
    BasicAuth, Id, Priority, Torrent, TorrentAction, TorrentAddArgs, TorrentAddedOrDuplicate,
    TorrentGetField, TorrentSetArgs, TorrentStatus,
};

use crate::models::{
    AltSpeedInfo, ConnectRequest, ConnectionState, SessionSettings, TorrentDetails, TorrentFile,
    TorrentInfo,
};
use crate::raw_rpc::RawRpc;
use crate::settings::base64_encode;
use crate::state::{self, PROPERTIES_ID};

fn status_to_string(status: &TorrentStatus) -> String {
    match status {
        TorrentStatus::Stopped => "Stopped",
        TorrentStatus::QueuedToVerify => "Waiting to check",
        TorrentStatus::QueuedToDownload => "Waiting to download",
        TorrentStatus::Downloading => "Downloading",
        TorrentStatus::QueuedToSeed => "Waiting to seed",
        TorrentStatus::Seeding => "Seeding",
        TorrentStatus::Verifying => "Checking",
    }
    .to_string()
}

pub(crate) fn torrent_fields() -> Vec<TorrentGetField> {
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
        TorrentGetField::MetadataPercentComplete,
    ]
}

fn torrent_details_fields() -> Vec<TorrentGetField> {
    let mut fields = torrent_fields();
    fields.extend([
        TorrentGetField::Files,
        TorrentGetField::FileStats,
        TorrentGetField::UploadedEver,
        TorrentGetField::DownloadedEver,
        TorrentGetField::LeftUntilDone,
        TorrentGetField::ActivityDate,
        TorrentGetField::SizeWhenDone,
    ]);
    fields
}

pub(crate) fn map_torrents(torrents: &[Torrent]) -> Vec<TorrentInfo> {
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

fn map_torrent_to_details(t: Torrent, id: i64) -> TorrentDetails {
    let files = t.files.unwrap_or_default();
    let stats = t.file_stats.unwrap_or_default();
    let files: Vec<TorrentFile> = files
        .iter()
        .enumerate()
        .map(|(i, f)| TorrentFile {
            name: f.name.clone(),
            length: f.length,
            bytes_completed: stats
                .get(i)
                .map(|s| s.bytes_completed)
                .unwrap_or(f.bytes_completed),
            wanted: stats.get(i).map(|s| s.wanted).unwrap_or(true),
            priority: match stats.get(i).map(|s| s.priority) {
                Some(Priority::Low) => "low",
                Some(Priority::High) => "high",
                _ => "normal",
            }
            .to_string(),
        })
        .collect();
    TorrentDetails {
        id: t.id.unwrap_or(id),
        name: t.name.clone().unwrap_or_default(),
        status: t.status.as_ref().map(status_to_string).unwrap_or_default(),
        percent_done: t.percent_done.unwrap_or(0.0) as f64,
        time_left: t.eta.unwrap_or(-1),
        seeders: t.peers_sending_to_us.unwrap_or(0),
        leechers: t.peers_getting_from_us.unwrap_or(0),
        queue_position: t.queue_position.unwrap_or(0) as i64,
        added_date: t.added_date.map(|d| d.timestamp()).unwrap_or(0),
        last_activity: t.activity_date.map(|d| d.timestamp()).unwrap_or(0),
        total_size: t.total_size.unwrap_or(0),
        size_when_done: t.size_when_done.unwrap_or(0),
        uploaded_ever: t.uploaded_ever.unwrap_or(0),
        downloaded_ever: t.downloaded_ever.unwrap_or(0) as i64,
        left_until_done: t.left_until_done.unwrap_or(0),
        error: t.error_string.is_some() && !t.error_string.as_ref().unwrap().is_empty(),
        error_string: t.error_string.clone().unwrap_or_default(),
        download_dir: t.download_dir.clone().unwrap_or_default(),
        files,
    }
}

async fn fetch_torrent_details(
    client: &mut TransClient,
    id: i64,
) -> Result<TorrentDetails, String> {
    let response = client
        .torrent_get(Some(torrent_details_fields()), Some(vec![Id::Id(id)]))
        .await
        .map_err(|e| format!("RPC error: {}", e))?;
    let t = response
        .arguments
        .torrents
        .into_iter()
        .next()
        .ok_or("Torrent not found")?;
    Ok(map_torrent_to_details(t, id))
}

pub(crate) async fn pause_after_metadata_poll(
    handle: &tauri::AppHandle,
    client: &mut TransClient,
    torrents: &[Torrent],
) {
    let pending: Vec<i64> = {
        let set = handle.state::<tokio::sync::Mutex<HashSet<i64>>>();
        set.lock().await.iter().cloned().collect()
    };
    if pending.is_empty() {
        return;
    }
    for id in pending {
        let metadata_done = torrents
            .iter()
            .find(|t| t.id == Some(id))
            .map(|t| match t.metadata_percent_complete {
                Some(p) => p >= 1.0,
                None => {
                    t.total_size.unwrap_or(0) > 0
                        || t.files.as_ref().map(|f| !f.is_empty()).unwrap_or(false)
                }
            })
            .unwrap_or(false);
        if metadata_done
            && client
                .torrent_action(TorrentAction::Stop, vec![Id::Id(id)])
                .await
                .is_ok()
        {
            handle
                .state::<tokio::sync::Mutex<HashSet<i64>>>()
                .lock()
                .await
                .remove(&id);
            if *PROPERTIES_ID.lock().unwrap() == Some(id) {
                let _ = handle.emit("properties-data", ());
            }
        }
    }
}

#[tauri::command]
pub(crate) async fn rpc_add_torrent(
    input: String,
    download_dir: Option<String>,
    pause_after_metadata: bool,
    client_state: State<'_, tokio::sync::Mutex<Option<TransClient>>>,
    pause_set_state: State<'_, tokio::sync::Mutex<HashSet<i64>>>,
) -> Result<String, String> {
    let mut guard = client_state.lock().await;
    let client = guard.as_mut().ok_or("Not connected")?;

    let is_magnet = if input.starts_with("magnet:") {
        true
    } else {
        std::path::Path::new(&input)
            .extension()
            .map(|e| e.to_string_lossy().to_lowercase() == "magnet")
            .unwrap_or(false)
    };
    let paused = if pause_after_metadata && !is_magnet {
        Some(true)
    } else {
        None
    };

    let add = if input.starts_with("magnet:")
        || input.starts_with("http://")
        || input.starts_with("https://")
    {
        TorrentAddArgs {
            filename: Some(input),
            download_dir,
            paused,
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
                    paused,
                    ..TorrentAddArgs::default()
                }
            }
            "torrent" => {
                let bytes = fs::read(path).map_err(|e| format!("Failed to read file: {}", e))?;
                TorrentAddArgs {
                    metainfo: Some(base64_encode(&bytes)),
                    download_dir,
                    paused,
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
            if pause_after_metadata
                && is_magnet
                && let Some(id) = t.id
            {
                pause_set_state.lock().await.insert(id);
            }
            Ok(format!("Added torrent: {}", t.name.unwrap_or_default()))
        }
        TorrentAddedOrDuplicate::TorrentDuplicate(t) => Err(format!(
            "Torrent already exists: {}",
            t.name.unwrap_or_default()
        )),
        TorrentAddedOrDuplicate::Error => {
            Err("Transmission reported an error while adding the torrent".to_string())
        }
    }
}

#[tauri::command]
pub(crate) async fn rpc_torrent_action(
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
pub(crate) async fn rpc_queue_move(
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
pub(crate) async fn rpc_get_free_space(
    path: String,
    raw_state: State<'_, tokio::sync::Mutex<Option<RawRpc>>>,
) -> Result<i64, String> {
    let guard = raw_state.lock().await;
    let raw = guard.as_ref().ok_or("Not connected")?;
    let json = raw
        .call("free-space", Some(serde_json::json!({ "path": path })))
        .await?;
    json["arguments"]["size-bytes"]
        .as_i64()
        .ok_or_else(|| "size-bytes missing in response".to_string())
}

#[tauri::command]
pub(crate) async fn rpc_torrent_rename_path(
    id: i64,
    path: String,
    name: String,
    raw_state: State<'_, tokio::sync::Mutex<Option<RawRpc>>>,
) -> Result<(), String> {
    let name = name.trim();
    if name.is_empty()
        || name == "."
        || name == ".."
        || name.contains('/')
        || name.contains('\\')
        || name.contains('\0')
    {
        return Err("The new name must be a non-empty file or directory name".to_string());
    }
    if path.is_empty() || path.starts_with('/') || path.starts_with('\\') {
        return Err("Invalid torrent-relative path".to_string());
    }

    let guard = raw_state.lock().await;
    let raw = guard.as_ref().ok_or("Not connected")?;
    raw.call(
        "torrent-rename-path",
        Some(serde_json::json!({ "ids": [id], "path": path, "name": name })),
    )
    .await?;
    Ok(())
}

#[tauri::command]
pub(crate) async fn rpc_torrent_remove(
    ids: Vec<i64>,
    delete_data: bool,
    epoch: Option<u64>,
    client_state: State<'_, tokio::sync::Mutex<Option<TransClient>>>,
) -> Result<(), String> {
    if let Some(expected) = epoch
        && state::connection_epoch() != expected
    {
        return Err("The connection changed, so the torrents were not removed".to_string());
    }
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
pub(crate) async fn rpc_connect(
    app: tauri::AppHandle,
    args: ConnectRequest,
    client_state: State<'_, tokio::sync::Mutex<Option<TransClient>>>,
    raw_state: State<'_, tokio::sync::Mutex<Option<RawRpc>>>,
    pause_set_state: State<'_, tokio::sync::Mutex<HashSet<i64>>>,
) -> Result<(), String> {
    let scheme = if args.https { "https" } else { "http" };
    let url_str = format!("{}://{}:{}/transmission/rpc", scheme, args.host, args.port);
    let url = url::Url::parse(&url_str).map_err(|e| format!("Invalid URL: {}", e))?;

    let mut builder = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(10))
        .timeout(std::time::Duration::from_secs(30));
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

    let generation = state::connection_epoch();
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
    let _guard = state::CONNECT_GUARD.lock().await;
    if state::connection_epoch() != generation {
        return Err("Connection attempt was cancelled".to_string());
    }
    pause_set_state.lock().await.clear();
    {
        let mut client_guard = client_state.lock().await;
        let mut raw_guard = raw_state.lock().await;
        *client_guard = Some(client);
        *raw_guard = Some(raw);
    }
    let epoch = state::bump_connection_epoch();
    state::set_connection_alive(true);
    let _ = app.emit(
        "connection-changed",
        ConnectionState {
            connected: true,
            epoch,
        },
    );
    Ok(())
}

#[tauri::command]
pub(crate) async fn rpc_toggle_alt_speed(
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
pub(crate) async fn rpc_get_session_settings(
    raw_state: State<'_, tokio::sync::Mutex<Option<RawRpc>>>,
) -> Result<SessionSettings, String> {
    let guard = raw_state.lock().await;
    let raw = guard.as_ref().ok_or("Not connected")?;
    raw.get_session_settings().await
}

#[tauri::command]
pub(crate) async fn rpc_set_session_settings(
    settings: SessionSettings,
    raw_state: State<'_, tokio::sync::Mutex<Option<RawRpc>>>,
) -> Result<(), String> {
    let guard = raw_state.lock().await;
    let raw = guard.as_ref().ok_or("Not connected")?;
    raw.set_session_settings(&settings).await
}

#[tauri::command]
pub(crate) async fn rpc_disconnect(
    app: tauri::AppHandle,
    client_state: State<'_, tokio::sync::Mutex<Option<TransClient>>>,
    raw_state: State<'_, tokio::sync::Mutex<Option<RawRpc>>>,
    pause_set_state: State<'_, tokio::sync::Mutex<HashSet<i64>>>,
) -> Result<(), String> {
    let _guard = state::CONNECT_GUARD.lock().await;
    let epoch = state::bump_connection_epoch();
    state::set_connection_alive(false);
    *client_state.lock().await = None;
    *raw_state.lock().await = None;
    pause_set_state.lock().await.clear();
    let _ = app.emit(
        "connection-changed",
        ConnectionState {
            connected: false,
            epoch,
        },
    );
    Ok(())
}

#[tauri::command]
pub(crate) async fn rpc_get_torrents(
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

#[tauri::command]
pub(crate) async fn rpc_get_torrent_details(
    id: i64,
    client_state: State<'_, tokio::sync::Mutex<Option<TransClient>>>,
) -> Result<TorrentDetails, String> {
    let mut guard = client_state.lock().await;
    let client = guard.as_mut().ok_or("Not connected")?;
    fetch_torrent_details(client, id).await
}

#[tauri::command]
pub(crate) async fn rpc_set_files_wanted(
    client_state: State<'_, tokio::sync::Mutex<Option<TransClient>>>,
    id: i64,
    wanted: Vec<usize>,
    unwanted: Vec<usize>,
) -> Result<(), String> {
    let mut guard = client_state.lock().await;
    let client = guard.as_mut().ok_or("Not connected")?;
    let mut args = TorrentSetArgs::new();
    if !wanted.is_empty() {
        args = args.files_wanted(wanted);
    }
    if !unwanted.is_empty() {
        args = args.files_unwanted(unwanted);
    }
    let response = client
        .torrent_set(args, Some(vec![Id::Id(id)]))
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
pub(crate) async fn rpc_set_files_priority(
    client_state: State<'_, tokio::sync::Mutex<Option<TransClient>>>,
    id: i64,
    indices: Vec<usize>,
    priority: String,
) -> Result<(), String> {
    if indices.is_empty() {
        return Ok(());
    }
    let args = match priority.as_str() {
        "low" => TorrentSetArgs::new().priority_low(indices),
        "normal" => TorrentSetArgs::new().priority_normal(indices),
        "high" => TorrentSetArgs::new().priority_high(indices),
        _ => return Err(format!("Unknown file priority: {}", priority)),
    };
    let mut guard = client_state.lock().await;
    let client = guard.as_mut().ok_or("Not connected")?;
    let response = client
        .torrent_set(args, Some(vec![Id::Id(id)]))
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
pub(crate) async fn is_connected(
    client_state: State<'_, tokio::sync::Mutex<Option<TransClient>>>,
) -> Result<bool, String> {
    let has_client = client_state.lock().await.is_some();
    Ok(has_client && state::connection_alive())
}

#[tauri::command]
pub(crate) async fn get_connection_state(
    client_state: State<'_, tokio::sync::Mutex<Option<TransClient>>>,
) -> Result<ConnectionState, String> {
    let has_client = client_state.lock().await.is_some();
    Ok(ConnectionState {
        connected: has_client && state::connection_alive(),
        epoch: state::connection_epoch(),
    })
}
