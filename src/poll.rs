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

use crate::models::{ConnectionState, SessionStatsInfo};
use crate::raw_rpc::RawRpc;
use crate::rpc::{map_torrents, pause_after_metadata_poll, torrent_fields};
use crate::state;

const MAX_POLL_FAILURES: u32 = 3;

fn emit_connection_state(handle: &tauri::AppHandle, connected: bool) {
    let _ = handle.emit(
        "connection-changed",
        ConnectionState {
            connected,
            epoch: state::connection_epoch(),
        },
    );
}

pub(crate) fn spawn_poll_loop(handle: tauri::AppHandle) {
    let fields = torrent_fields();
    tauri::async_runtime::spawn(async move {
        let mut failures = 0u32;
        loop {
            tokio::time::sleep(Duration::from_secs(1)).await;
            let epoch = state::connection_epoch();
            let mut polled = false;
            {
                let client_state = handle.state::<tokio::sync::Mutex<Option<TransClient>>>();
                let mut guard = client_state.lock().await;
                if let Some(client) = guard.as_mut() {
                    polled = true;
                    match client.torrent_get(Some(fields.clone()), None).await {
                        Ok(response) => {
                            failures = 0;
                            if state::connection_epoch() == epoch {
                                let torrents = map_torrents(&response.arguments.torrents);
                                let _ = handle.emit("torrents-update", &torrents);
                                pause_after_metadata_poll(
                                    &handle,
                                    client,
                                    &response.arguments.torrents,
                                )
                                .await;
                            }
                        }
                        Err(e) => {
                            failures = failures.saturating_add(1);
                            log::warn!("RPC poll error: {e}");
                        }
                    }
                    if state::connection_epoch() == epoch
                        && let Ok(response) = client.session_stats().await
                    {
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
            if polled {
                let alive = failures < MAX_POLL_FAILURES;
                if alive != state::connection_alive() {
                    state::set_connection_alive(alive);
                    emit_connection_state(&handle, alive);
                }
            }
            {
                let raw_state = handle.state::<tokio::sync::Mutex<Option<RawRpc>>>();
                let raw_guard = raw_state.lock().await;
                if state::connection_epoch() == epoch
                    && let Some(raw) = raw_guard.as_ref()
                    && let Ok(info) = raw.alt_speed().await
                {
                    let _ = handle.emit("alt-speed-update", &info);
                }
            }
        }
    });
}
