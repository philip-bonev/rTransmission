# Project Context & Rules: rTransmission Client

## 1. System Prompt & Role
- **Role:** Expert software engineer specializing in Rust, Tauri, and frontend development. Provide clean, secure, idiomatic code.
- **Communication Language:** Always respond in Bulgarian unless asked otherwise; explain thought process and summarize code changes.
- **Code Language:** Rust backend in `/src`, vanilla HTML/CSS/JS frontend in `/web` (no framework, no build step).

## 2. Tech Stack & Architecture
- **Framework:** Tauri v2 (Rust backend + WebView frontend). Rust edition 2024.
- **Backend:** `/src/lib.rs` (single file, ~1450 lines). Talks to a Transmission daemon via the `transmission-rpc` crate; low-level HTTP via `reqwest` (rustls). `src/main.rs` just calls `lib::run()`.
- **Frontend:** static files in `/web`, served as `frontendDist: "web"`. There is NO npm/package.json — do not run `npm install`; edit files directly.
- **Windows:** `main` (defined in `tauri.conf.json`) plus a `properties` window created on demand in `open_properties_window` (`src/lib.rs`) pointing at `properties.html`.
- **Config:** `tauri.conf.json`, `capabilities/default.json`, `Cargo.toml`.
- **Plugins:** opener, dialog, fs, window-state, single-instance, deep-link (magnet scheme), log.
- **Platform:** Windows, Linux, macOS. Feature differences handled with `#[cfg(...)]` in Rust.

## 3. Architecture & Data Flow (important)
- **Settings:** stored as JSON at `~/.rtransmission/config.json` (cross-platform via HOME/USERPROFILE). Loaded in `.setup()` into `AppState.settings`. The RPC password is base64-encoded on disk (deliberately NOT keyring — treat as obfuscation, never log it).
- **State (`tauri::State`):** `AppState` (settings + settings_path + menu item maps), `Mutex<Option<TransClient>>` for the RPC client, `Mutex<Option<RawRpc>>` for raw HTTP RPC, `Mutex<HashSet<i64>>` for pause-after-metadata torrents. Static globals: `CLI_FILE`, `PROPERTIES_ID`.
- **Settings fields:** `rpc_host`, `rpc_port`, `rpc_auth`, `rpc_username`, `rpc_password`, `rpc_https`, `rpc_insecure`, `auto_connect`, `default_download_dir`, `theme` (`auto`/`light`/`dark`). New fields MUST have `#[serde(default)]` for backward compatibility.
- **Event flow (Rust emits, JS `listen()`s):** `torrents-update`, `session-stats-update`, `alt-speed-update`, `file-opened`, `properties-data`, `menu-*` (connection-settings, add-url, add-magnet, add-file, play, pause, delete, verify, sort, sort-dir, filter).
- **Tauri commands (in `generate_handler`):** `rpc_*` passthrough commands call the Transmission daemon; `get_settings`/`set_settings` manage config; `rpc_get_session_settings`/`rpc_set_session_settings` for remote daemon settings; `get_cli_file`, `validate_torrent_input`, `open_properties_window`, `get_properties_torrent_id`, `update_menu_markers`.
- **Invoke arg naming:** JS passes camelCase keys (e.g. `newSettings`), Rust receives snake_case (`new_settings`) — Tauri maps automatically.
- **Inputs handled:** HTTP/HTTPS torrent URLs, `magnet:` links, `.torrent`/`.magnet` files (file associations + CLI arg + single-instance re-open + deep-link). All flows go through the add dialog (`openAddDialog`).

## 4. Transmission RPC (important)
- **Typed API limitation:** The `transmission-rpc` crate's `SessionGet` struct only has 7 basic fields — it does NOT include speed limits, queue settings, seed ratio, or idle limits.
- **RawRpc:** Used for `session-get` (reading all session settings) and `session-set` (writing all session settings). Already implemented as `RawRpc::get_session_settings()` / `set_session_settings()` using `serde_json::json!`.
- **Session settings fields:** `download-queue-size`, `download-queue-enabled`, `seed-ratio-limit`, `seed-ratio-limited`, `idle-seeding-limit`, `idle-seeding-limit-enabled`, `speed-limit-down`, `speed-limit-down-enabled`, `speed-limit-up`, `speed-limit-up-enabled`, `alt-speed-down`, `alt-speed-up`.
- **Speed limit convention:** 0 = unlimited. When sending to daemon: `speed_limit_down_enabled: speedDl > 0`, `speed_limit_up_enabled: speedUl > 0`. Queue/seed/idle are always sent as enabled.

## 5. Project Commands
- **Run Dev Mode:** `cargo tauri dev`
- **Build Production:** `cargo tauri build` (bundle appears under `target/release/bundle/`). Do NOT set SDKROOT or DEVELOPER_DIR — breaks macOS DMG bundler (Set-File dialog). Just use `export PATH=/usr/bin:/bin:/usr/sbin:/sbin:$HOME/.cargo/bin`.
- **Lint Rust:** `cargo clippy`
- **Format Rust:** `cargo fmt`
- **macOS install after build:** `ditto "target/release/bundle/macos/rTransmission Client.app" "/Applications/rTransmission Client.app"`
- **Verify JS:** `node --check web/<file>.js`
- **Version:** bump BOTH `Cargo.toml` and `tauri.conf.json` `version`.

## 6. Coding Conventions & Safety
- **Tauri commands:** return `Result<T, String>` with human-readable errors so the frontend can `alert()`/display them. RPC commands are `async` and take `State<'_, tokio::sync::Mutex<Option<TransClient>>>`; never block the UI thread.
- **Style:** spaces only, 4 spaces = 1 tab. Match surrounding code; no decorative comments.
- **WebKit Bug (macOS):** WKWebView can fire spurious `click` events, e.g. when a drag-select ends on a different element. Use `mousedown` for dismiss/tab/single-press UI (overlay backdrops, properties tabs) and avoid relying on `click` for anything near selectable text. Checkboxes use `change`.
- **Settings dialog layout:** Use a scroll wrapper div (`#settings-scroll`) inside the dialog — NOT overflow on the form element (forms fight flex). Dialog: `height: 90vh`, flex column. Scroll wrapper: `flex: 1 1 0; overflow-y: auto`. Header and button panel: `flex-shrink: 0`.
- **Remote settings pattern:** Fields disabled when not connected; fetched from daemon on dialog open; sent to daemon on Save only if connected.
- **Properties file tree:** rebuild from fetched data each load; disable checkboxes (files AND dirs) once fully downloaded (`done >= size`); guard updates with `fileSelectionUpdating` to prevent races.
- **Properties tabs:** Use `mousedown` (not `click`) for tab switching; `user-select: none` on tab buttons.
- **No new Rust crates or JS packages** unless explicitly requested.
- **Security:** never hardcode or log credentials; password must never be written in plaintext to config (base64 only).
- **Theme:** `Theme` enum in Rust (Auto/Light/Dark), stored in Settings. Frontend `applyTheme(theme)` in main.js and properties.js. Auto follows `prefers-color-scheme`. Apply on dialog save and on startup.

## 7. i18n (Internationalization)
- **System:** `web/i18n.js` provides `t(key)` for translations and `applyTranslations()` to update DOM.
- **Languages:** English (default) and Bulgarian (`bg`). Detection via `navigator.language.startsWith('bg')`.
- **Static text:** Use `data-i18n="key"` on HTML elements for textContent, `data-i18n-title` for title attrs, `data-i18n-placeholder` for placeholder attrs.
- **Dynamic text:** Call `t('key')` in JS. For parameterized strings, use `t('key', param)` — the dict value is a function `(p) => ...`.
- **On load:** Call `applyTranslations()` after DOM is ready (in `DOMContentLoaded` for main.js, in `load()` for properties.js).
- **Context menu:** `data-label` attributes on context items use translation keys (e.g. `data-label="sort.date"`); `updateContextMenuChecks()` uses `t(el.dataset.label)`.
- **Adding new strings:** Add key to both `en` and `bg` dicts in i18n.js. Keep keys hierarchical: `toolbar.connect`, `add.title_url`, `prop.size`, `btn.save`, etc.
- Frontend logic/UI in `/web`, system/RPC logic in `/src`. Do not mix concerns.
- Frontend logic/UI in `/web`, system/RPC logic in `/src`. Do not mix concerns.
