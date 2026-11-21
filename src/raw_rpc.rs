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

use serde_json::Value;
use transmission_rpc::types::BasicAuth;

use crate::models::{AltSpeedInfo, SessionSettings};

fn field<'a>(args: &'a Value, key: &str) -> Result<&'a Value, String> {
    args.get(key)
        .ok_or_else(|| format!("Transmission response is missing '{key}'"))
}

fn req_i64(args: &Value, key: &str) -> Result<i64, String> {
    field(args, key)?
        .as_i64()
        .ok_or_else(|| format!("'{key}' is not an integer"))
}

fn req_i32(args: &Value, key: &str) -> Result<i32, String> {
    i32::try_from(req_i64(args, key)?).map_err(|_| format!("'{key}' is out of range"))
}

fn req_f64(args: &Value, key: &str) -> Result<f64, String> {
    field(args, key)?
        .as_f64()
        .ok_or_else(|| format!("'{key}' is not a number"))
}

fn req_bool(args: &Value, key: &str) -> Result<bool, String> {
    field(args, key)?
        .as_bool()
        .ok_or_else(|| format!("'{key}' is not a boolean"))
}

pub(crate) struct RawRpc {
    pub url: url::Url,
    pub auth: Option<BasicAuth>,
    pub session_id: std::sync::RwLock<Option<String>>,
    pub client: reqwest::Client,
}

impl RawRpc {
    pub(crate) async fn call(
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
            let status = rsp.status();
            if status == reqwest::StatusCode::CONFLICT {
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
            if !status.is_success() {
                return Err(format!("Transmission returned HTTP {}", status.as_u16()));
            }
            let json: serde_json::Value = rsp
                .json()
                .await
                .map_err(|e| format!("Decode error: {}", e))?;
            return match json.get("result").and_then(Value::as_str) {
                Some("success") => Ok(json),
                Some(other) => Err(format!("Transmission error: {other}")),
                None => Err("Transmission returned a malformed response".to_string()),
            };
        }
        Err("Max retries reached".to_string())
    }

    pub(crate) async fn alt_speed(&self) -> Result<AltSpeedInfo, String> {
        let json = self.call("session-get", None).await?;
        let args = field(&json, "arguments")?;
        let enabled = req_bool(args, "alt-speed-enabled")?;
        let download_limit = (req_f64(args, "alt-speed-down")? * 1024.0).round() as i64;
        let upload_limit = (req_f64(args, "alt-speed-up")? * 1024.0).round() as i64;
        Ok(AltSpeedInfo {
            enabled,
            download_limit,
            upload_limit,
        })
    }

    pub(crate) async fn set_alt_speed_enabled(&self, enabled: bool) -> Result<(), String> {
        self.call(
            "session-set",
            Some(serde_json::json!({ "alt-speed-enabled": enabled })),
        )
        .await?;
        Ok(())
    }

    pub(crate) async fn get_session_settings(&self) -> Result<SessionSettings, String> {
        let json = self.call("session-get", None).await?;
        let args = field(&json, "arguments")?;
        Ok(SessionSettings {
            download_queue_size: req_i32(args, "download-queue-size")?,
            download_queue_enabled: req_bool(args, "download-queue-enabled")?,
            seed_ratio_limit: req_f64(args, "seed-ratio-limit")?,
            seed_ratio_limited: req_bool(args, "seed-ratio-limited")?,
            idle_seeding_limit: req_i32(args, "idle-seeding-limit")?,
            idle_seeding_limit_enabled: req_bool(args, "idle-seeding-limit-enabled")?,
            speed_limit_down: req_i32(args, "speed-limit-down")?,
            speed_limit_down_enabled: req_bool(args, "speed-limit-down-enabled")?,
            speed_limit_up: req_i32(args, "speed-limit-up")?,
            speed_limit_up_enabled: req_bool(args, "speed-limit-up-enabled")?,
            alt_speed_down: req_i32(args, "alt-speed-down")?,
            alt_speed_up: req_i32(args, "alt-speed-up")?,
        })
    }

    pub(crate) async fn set_session_settings(
        &self,
        settings: &SessionSettings,
    ) -> Result<(), String> {
        for (key, value) in [
            (
                "download-queue-size",
                i64::from(settings.download_queue_size),
            ),
            ("idle-seeding-limit", i64::from(settings.idle_seeding_limit)),
            ("speed-limit-down", i64::from(settings.speed_limit_down)),
            ("speed-limit-up", i64::from(settings.speed_limit_up)),
            ("alt-speed-down", i64::from(settings.alt_speed_down)),
            ("alt-speed-up", i64::from(settings.alt_speed_up)),
        ] {
            if value < 0 {
                return Err(format!("'{key}' must not be negative"));
            }
        }
        if !settings.seed_ratio_limit.is_finite() || settings.seed_ratio_limit < 0.0 {
            return Err("'seed-ratio-limit' must be a non-negative number".to_string());
        }

        self.call(
            "session-set",
            Some(serde_json::json!({
                "download-queue-size": settings.download_queue_size,
                "download-queue-enabled": settings.download_queue_enabled,
                "seed-ratio-limit": settings.seed_ratio_limit,
                "seed-ratio-limited": settings.seed_ratio_limited,
                "idle-seeding-limit": settings.idle_seeding_limit,
                "idle-seeding-limit-enabled": settings.idle_seeding_limit_enabled,
                "speed-limit-down": settings.speed_limit_down,
                "speed-limit-down-enabled": settings.speed_limit_down_enabled,
                "speed-limit-up": settings.speed_limit_up,
                "speed-limit-up-enabled": settings.speed_limit_up_enabled,
                "alt-speed-down": settings.alt_speed_down,
                "alt-speed-up": settings.alt_speed_up,
            })),
        )
        .await?;
        Ok(())
    }
}
