# Project Context & Rules: rTransmission Client

## 1. System Prompt & Role
- **Role:** Expert software engineer specializing in Rust, Tauri, and frontend development. Provide clean, secure, idiomatic code.
- **Communication Language:** Always respond in Bulgarian unless asked otherwise; explain thought process and summarize code changes.
- **Code Language:** Rust backend in `/src`, vanilla HTML/CSS/JS frontend in `/web` (no framework, no build step).

## 2. Tech Stack & Architecture
- **Framework:** Tauri v2 (Rust backend + WebView frontend). Rust edition 2024.
- **Backend:** `/src/lib.rs` (single file, ~1340 lines). Talks to a Transmission daemon via the `transmission-rpc` crate; low-level HTTP via `reqwest` (rustls). `src/main.rs` just calls `lib::run()`.
- **Frontend:** static files in `/web`, served as `frontendDist: "web"`. There is NO npm/package.json — do not run `npm install`; edit files directly.
- **Windows:** `main` (defined in `tauri.conf.json`) plus a `properties` window created on demand in `open_properties_window` (`src/lib.rs:839`) pointing at `properties.html`.
- **Config:** `tauri.conf.json`, `capabilities/default.json`, `Cargo.toml`.
- **Plugins:** opener, dialog, fs, window-state, single-instance, deep-link (magnet scheme), log.
- **Platform:** Windows, Linux, macOS. Feature differences handled with `#[cfg(...)]` in Rust.

## 3. Architecture & Data Flow (important)
- **Settings:** stored as JSON at `~/.rtransmission/config.json` (cross-platform via HOME/USERPROFILE). Loaded in `.setup()` into `AppState.settings`. The RPC password is base64-encoded on disk (deliberately NOT keyring — treat as obfuscation, never log it).
- **State (`tauri::State`):** `AppState` (settings + settings_path + menu item maps), `Mutex<Option<TransClient>>` for the RPC client, `Mutex<HashSet<i64>>` for pause-after-metadata torrents. Static globals: `CLI_FILE`, `PROPERTIES_ID`.
- **Settings fields:** `rpc_host`, `rpc_port`, `rpc_auth`, `rpc_username`, `rpc_password`, `rpc_https`, `rpc_insecure`, `auto_connect`, `default_download_dir`, `theme` (`auto`/`light`/`dark`). New fields MUST have `#[serde(default)]` for backward compatibility.
- **Event flow (Rust emits, JS `listen()`s):** `torrents-update`, `session-stats-update`, `alt-speed-update`, `file-opened`, `properties-data`, `menu-*` (connection-settings, add-url, add-magnet, add-file, play, pause, delete, verify, sort, sort-dir, filter).
- **Tauri commands (in `generate_handler`):** `rpc_*` passthrough commands call the Transmission daemon; `get_settings`/`set_settings` manage config; `get_cli_file`, `validate_torrent_input`, `open_properties_window`, `get_properties_torrent_id`, `update_menu_markers`.
- **Invoke arg naming:** JS passes camelCase keys (e.g. `newSettings`), Rust receives snake_case (`new_settings`) — Tauri maps automatically.
- **Inputs handled:** HTTP/HTTPS torrent URLs, `magnet:` links, `.torrent`/`.magnet` files (file associations + CLI arg + single-instance re-open + deep-link). All flows go through the add dialog (`openAddDialog`).

## 4. Project Commands
- **Run Dev Mode:** `cargo tauri dev`
- **Build Production:** `cargo tauri build` (bundle appears under `target/release/bundle/`)
- **Lint Rust:** `cargo clippy`
- **Format Rust:** `cargo fmt`
- **macOS install after build:** `ditto "target/release/bundle/macos/rTransmission Client.app" "/Applications/rTransmission Client.app"`
- **Verify JS:** `node --check web/<file>.js`
- **Version:** bump BOTH `Cargo.toml` and `tauri.conf.json` `version`.

## 5. Coding Conventions & Safety
- **Tauri commands:** return `Result<T, String>` with human-readable errors so the frontend can `alert()`/display them. RPC commands are `async` and take `State<'_, tokio::sync::Mutex<Option<TransClient>>>`; never block the UI thread.
- **Style:** spaces only, 4 spaces = 1 tab. Match surrounding code; no decorative comments.
- **WebKit Bug (macOS):** WKWebView can fire spurious `click` events, e.g. when a drag-select ends on a different element. Use `mousedown` for dismiss/tab/single-press UI (overlay backdrops, properties tabs) and avoid relying on `click` for anything near selectable text. Checkboxes use `change`.
- **Properties file tree:** rebuild from fetched data each load; disable checkboxes (files AND dirs) once fully downloaded (`done >= size`); guard updates with `fileSelectionUpdating` to prevent races.
- **No new Rust crates or JS packages** unless explicitly requested.
- **Security:** never hardcode or log credentials; password must never be written in plaintext to config (base64 only).

## 6. i18n Rule (IMPORTANT)
- All UI text (labels, buttons, F-key bar, menu items, modal titles/messages, help text, error messages shown in the UI) MUST go through `web/i18n.js` via `t(key)`/`tp(key, {vars})` or `data-i18n` attributes.
- **When adding or changing any visible element, ALWAYS update BOTH the Bulgarian (`bg`) and English (`en`) dictionaries in `web/i18n.js`.** Never leave a key defined in only one language. Keep translations in sync.
- `LANG` is derived from `navigator.language` (prefix `bg` → Bulgarian, otherwise English). New keys must be added to both objects.

## 7. Scoping
- Frontend logic/UI in `/web`, system/RPC logic in `/src`. Do not mix concerns.
