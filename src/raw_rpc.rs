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

use transmission_rpc::types::BasicAuth;

use crate::models::{AltSpeedInfo, SessionSettings};

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

    pub(crate) async fn alt_speed(&self) -> Result<AltSpeedInfo, String> {
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
        let args = &json["arguments"];
        Ok(SessionSettings {
            download_queue_size: args["download-queue-size"].as_i64().unwrap_or(5) as i32,
            download_queue_enabled: args["download-queue-enabled"].as_bool().unwrap_or(true),
            seed_ratio_limit: args["seed-ratio-limit"].as_f64().unwrap_or(2.0),
            seed_ratio_limited: args["seed-ratio-limited"].as_bool().unwrap_or(false),
            idle_seeding_limit: args["idle-seeding-limit"].as_i64().unwrap_or(30) as i32,
            idle_seeding_limit_enabled: args["idle-seeding-limit-enabled"]
                .as_bool()
                .unwrap_or(false),
            speed_limit_down: args["speed-limit-down"].as_i64().unwrap_or(100) as i32,
            speed_limit_down_enabled: args["speed-limit-down-enabled"].as_bool().unwrap_or(false),
            speed_limit_up: args["speed-limit-up"].as_i64().unwrap_or(100) as i32,
            speed_limit_up_enabled: args["speed-limit-up-enabled"].as_bool().unwrap_or(false),
            alt_speed_down: args["alt-speed-down"].as_i64().unwrap_or(50) as i32,
            alt_speed_up: args["alt-speed-up"].as_i64().unwrap_or(50) as i32,
        })
    }

    pub(crate) async fn set_session_settings(
        &self,
        settings: &SessionSettings,
    ) -> Result<(), String> {
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
