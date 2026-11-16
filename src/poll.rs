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

use std::time::Duration;

use tauri::Emitter;
use tauri::Manager;
use transmission_rpc::TransClient;

use crate::models::SessionStatsInfo;
use crate::raw_rpc::RawRpc;
use crate::rpc::{map_torrents, pause_after_metadata_poll, torrent_fields};

pub(crate) fn spawn_poll_loop(handle: tauri::AppHandle) {
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
                            pause_after_metadata_poll(
                                &handle,
                                &mut *client,
                                &response.arguments.torrents,
                            )
                            .await;
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
}
