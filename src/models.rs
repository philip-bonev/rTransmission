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

use serde::{Deserialize, Serialize};

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
    pub is_finished: bool,
}

#[derive(Debug, Serialize, Clone)]
pub(crate) struct TorrentFile {
    pub name: String,
    pub length: i64,
    pub bytes_completed: i64,
    pub wanted: bool,
    pub priority: String,
}

#[derive(Debug, Serialize, Clone)]
pub(crate) struct TorrentDetails {
    pub id: i64,
    pub name: String,
    pub status: String,
    pub percent_done: f64,
    pub time_left: i64,
    pub seeders: i64,
    pub leechers: i64,
    pub queue_position: i64,
    pub added_date: i64,
    pub last_activity: i64,
    pub total_size: i64,
    pub size_when_done: i64,
    pub uploaded_ever: i64,
    pub downloaded_ever: i64,
    pub left_until_done: i64,
    pub error: bool,
    pub error_string: String,
    pub download_dir: String,
    pub files: Vec<TorrentFile>,
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

#[derive(Debug, Serialize, Clone)]
pub(crate) struct ConnectionState {
    pub connected: bool,
    pub epoch: u64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub(crate) struct SessionSettings {
    pub download_queue_size: i32,
    pub download_queue_enabled: bool,
    pub seed_ratio_limit: f64,
    pub seed_ratio_limited: bool,
    pub idle_seeding_limit: i32,
    pub idle_seeding_limit_enabled: bool,
    pub speed_limit_down: i32,
    pub speed_limit_down_enabled: bool,
    pub speed_limit_up: i32,
    pub speed_limit_up_enabled: bool,
    pub alt_speed_down: i32,
    pub alt_speed_up: i32,
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
