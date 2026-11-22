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

#[cfg(target_os = "linux")]
use crate::windows::show_main_window;

#[tauri::command]
pub(crate) async fn send_notification(
    app: tauri::AppHandle,
    title: String,
    body: String,
    duration: u32,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || show_notification(app, title, body, duration))
        .await
        .map_err(|e| format!("Notification task failed: {e}"))?
}

fn show_notification(
    app: tauri::AppHandle,
    title: String,
    body: String,
    duration: u32,
) -> Result<(), String> {
    let _ = &app;
    #[cfg(target_os = "macos")]
    {
        let _ = duration;
        let script = format!(
            "display notification \"{}\" with title \"{}\"",
            body.replace('\\', "\\\\").replace('"', "\\\""),
            title.replace('\\', "\\\\").replace('"', "\\\""),
        );
        std::process::Command::new("osascript")
            .args(["-e", &script])
            .output()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        let timeout = if duration > 0 {
            i32::try_from(duration.saturating_mul(1000)).unwrap_or(i32::MAX)
        } else {
            -1
        };
        std::thread::spawn(move || {
            let notification = notify_rust::Notification::new()
                .appname("rTransmission")
                .summary(&title)
                .body(&body)
                .action("default", "Open")
                .timeout(timeout)
                .show();

            match notification {
                Ok(handle) => handle.wait_for_action(|action| {
                    if action == "default" {
                        show_main_window(&app);
                    }
                }),
                Err(error) => log::warn!("Failed to show notification: {error}"),
            }
        });
    }
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        let expiration = if duration > 0 {
            format!(
                "$toast.ExpirationTime = [DateTimeOffset]::Now.AddSeconds({});",
                duration
            )
        } else {
            String::new()
        };
        let script = format!(
            "[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null; \
             $template = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02); \
             $textNodes = $template.GetElementsByTagName('text'); \
             $textNodes.Item(0).AppendChild($template.CreateTextNode('{}')) > $null; \
             $textNodes.Item(1).AppendChild($template.CreateTextNode('{}')) > $null; \
             $toast = [Windows.UI.Notifications.ToastNotification]::new($template); \
             {} \
             $signal = [System.Threading.AutoResetEvent]::new($false); \
             $null = $toast.add_Activated({{ Start-Process 'rtransmission://notification'; [void]$signal.Set() }}); \
             $null = $toast.add_Dismissed({{ [void]$signal.Set() }}); \
             [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('rTransmission').Show($toast); \
             [void]$signal.WaitOne({})",
            title.replace('\'', "''"),
            body.replace('\'', "''"),
            expiration,
            if duration > 0 {
                duration.saturating_mul(1000) as i32
            } else {
                60_000
            },
        );
        std::process::Command::new("powershell")
            .args(["-WindowStyle", "Hidden", "-Command", &script])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}
