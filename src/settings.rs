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

use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::Emitter;
use tauri::State;

use crate::state::AppState;

#[derive(Debug, Serialize, Deserialize, Clone, Default, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub(crate) enum Theme {
    #[default]
    Auto,
    Light,
    Dark,
}

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
    #[serde(default)]
    pub default_download_dir: Option<String>,
    #[serde(default)]
    pub theme: Theme,
    #[serde(default = "default_true")]
    pub notifications_enabled: bool,
    #[serde(default = "default_notification_duration")]
    pub notification_duration: u32,
    #[serde(default = "default_true")]
    pub minimize_to_tray: bool,
}

fn default_auto_connect() -> bool {
    true
}

fn default_true() -> bool {
    true
}

fn default_notification_duration() -> u32 {
    5
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
            default_download_dir: None,
            theme: Theme::Auto,
            notifications_enabled: true,
            notification_duration: 5,
            minimize_to_tray: true,
        }
    }
}

const BASE64_CHARS: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

pub(crate) fn base64_encode(data: &[u8]) -> String {
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

fn base64_decode(data: &str) -> Option<String> {
    fn val(c: u8) -> Option<u32> {
        match c {
            b'A'..=b'Z' => Some(u32::from(c - b'A')),
            b'a'..=b'z' => Some(u32::from(c - b'a') + 26),
            b'0'..=b'9' => Some(u32::from(c - b'0') + 52),
            b'+' => Some(62),
            b'/' => Some(63),
            _ => None,
        }
    }
    let mut out = Vec::with_capacity(data.len() / 4 * 3);
    let mut group = 0u32;
    let mut n = 0u32;
    for &c in data.trim().as_bytes() {
        if c == b'=' {
            break;
        }
        let v = val(c)?;
        group = (group << 6) | v;
        n += 1;
        if n == 4 {
            out.push((group >> 16) as u8);
            out.push((group >> 8) as u8);
            out.push(group as u8);
            group = 0;
            n = 0;
        }
    }
    if n == 2 {
        out.push((group >> 4) as u8);
    } else if n == 3 {
        out.push((group >> 10) as u8);
        out.push((group >> 2) as u8);
    }
    String::from_utf8(out).ok()
}

pub(crate) fn load_settings(path: &PathBuf) -> Settings {
    let mut settings: Settings = fs::read_to_string(path)
        .ok()
        .and_then(|content| serde_json::from_str(&content).ok())
        .unwrap_or_default();
    if !settings.rpc_password.is_empty() {
        settings.rpc_password =
            base64_decode(&settings.rpc_password).unwrap_or(settings.rpc_password.clone());
    }
    settings
}

pub(crate) fn save_settings(path: &PathBuf, settings: &Settings) -> Result<(), String> {
    let mut disk = settings.clone();
    if !settings.rpc_password.is_empty() {
        disk.rpc_password = base64_encode(settings.rpc_password.as_bytes());
    } else {
        disk.rpc_password = String::new();
    }
    let content = serde_json::to_string_pretty(&disk).map_err(|e| e.to_string())?;
    fs::write(path, content).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub(crate) fn get_settings(state: State<'_, Mutex<AppState>>) -> Result<Settings, String> {
    let state = state.lock().unwrap();
    Ok(state.settings.clone())
}

#[tauri::command]
pub(crate) fn set_settings(
    new_settings: Settings,
    state: State<'_, Mutex<AppState>>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let mut state = state.lock().unwrap();
    save_settings(&state.settings_path, &new_settings)?;
    state.settings = new_settings.clone();

    if let Some(tray) = app.tray_by_id("main-tray")
        && let Err(error) = tray.set_visible(new_settings.minimize_to_tray)
    {
        log::warn!("Failed to update tray icon visibility: {error}");
    }

    let _ = app.emit("settings-changed", ());

    Ok(())
}
