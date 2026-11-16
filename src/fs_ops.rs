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
use std::time::Duration;

const FS_TIMEOUT: Duration = Duration::from_secs(5);

async fn run_fs_with_timeout<F>(desc: &str, op: F) -> Result<(), String>
where
    F: FnOnce() -> std::io::Result<()> + Send + 'static,
{
    let (tx, rx) = tokio::sync::oneshot::channel();
    std::thread::spawn(move || {
        let _ = tx.send(op());
    });
    tokio::select! {
        result = rx => {
            result.map_err(|_| format!("{}: channel closed", desc))?
                .map_err(|e| format!("{}: {}", desc, e))
        }
        _ = tokio::time::sleep(FS_TIMEOUT) => {
            Err(format!("{}: timed out (possible network mount issue)", desc))
        }
    }
}

#[tauri::command]
pub(crate) async fn file_rename(old_path: String, new_path: String) -> Result<(), String> {
    run_fs_with_timeout("Rename", move || fs::rename(&old_path, &new_path)).await
}

#[tauri::command]
pub(crate) async fn file_delete(path: String) -> Result<(), String> {
    let p = path.clone();
    run_fs_with_timeout("Delete", move || {
        let path = std::path::Path::new(&p);
        if path.is_dir() {
            fs::remove_dir_all(&p)
        } else {
            fs::remove_file(&p)
        }
    })
    .await
}

#[tauri::command]
pub(crate) async fn file_move(source: String, destination: String) -> Result<(), String> {
    run_fs_with_timeout("Move", move || fs::rename(&source, &destination)).await
}
