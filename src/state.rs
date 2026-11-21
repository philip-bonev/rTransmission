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
use std::path::PathBuf;
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};

use crate::settings::Settings;

pub(crate) struct AppState {
    pub settings: Settings,
    pub settings_path: PathBuf,
    pub sort_menu_items: HashMap<String, (tauri::menu::MenuItem<tauri::Wry>, String)>,
    pub sort_dir_menu_items: HashMap<String, (tauri::menu::MenuItem<tauri::Wry>, String)>,
    pub filter_menu_items: HashMap<String, (tauri::menu::MenuItem<tauri::Wry>, String)>,
}

pub(crate) static CLI_FILE: Mutex<Option<String>> = Mutex::new(None);
pub(crate) static PROPERTIES_ID: Mutex<Option<i64>> = Mutex::new(None);
pub(crate) static ADD_PAYLOAD: Mutex<Option<serde_json::Value>> = Mutex::new(None);
pub(crate) static DELETE_IDS: Mutex<Option<Vec<i64>>> = Mutex::new(None);

static CONNECTION_EPOCH: AtomicU64 = AtomicU64::new(0);
static CONNECTION_ALIVE: AtomicBool = AtomicBool::new(false);

pub(crate) static CONNECT_GUARD: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

pub(crate) fn connection_epoch() -> u64 {
    CONNECTION_EPOCH.load(Ordering::SeqCst)
}

pub(crate) fn bump_connection_epoch() -> u64 {
    CONNECTION_EPOCH.fetch_add(1, Ordering::SeqCst) + 1
}

pub(crate) fn connection_alive() -> bool {
    CONNECTION_ALIVE.load(Ordering::SeqCst)
}

pub(crate) fn set_connection_alive(alive: bool) {
    CONNECTION_ALIVE.store(alive, Ordering::SeqCst);
}
