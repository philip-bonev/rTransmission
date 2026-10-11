# rTransmission Client

A desktop client for [Transmission](https://transmissionbt.com/) daemon, built with **Tauri v2** (Rust backend + vanilla HTML/CSS/JS frontend — no npm, no build step).

The app connects to an already running Transmission daemon over RPC (HTTP/HTTPS) and manages torrents through it — the daemon itself is not bundled.

**License:** Apache 2.0  
**Platforms:** Windows, Linux, macOS

---

## Features

- **Torrent management:** add by URL, magnet link, or `.torrent`/`.magnet` file; start/pause, delete, verify, queue (top/up/down/bottom), sorting and filtering by state.
- **Windows:** separate dialog windows for properties (including a file tree with per-file selection), settings, connection settings, add, delete, and About.
- **Daemon settings:** speed limits, alternate ("slow") limits, queue size, seed ratio / idle limit — read and written via raw RPC.
- **Incoming links:** deep links (`magnet:`, `rtransmission:`), file associations for `.torrent`/`.magnet`, CLI argument, single-instance — all flows go through the Add window.
- **System tray:** minimize-to-tray, tray icon.
- **Notifications:** when torrents finish (configurable + test notification).
- **Themes:** auto/light/dark, following the system preference when set to `auto`.
- **i18n:** English and Bulgarian, auto-detected from the system language.

---

## Tech stack

| Layer | Technology |
|-------|------------|
| Backend | Rust (edition 2024), Tauri v2, `transmission-rpc`, `reqwest` (rustls), `tokio` |
| Frontend | Static HTML/CSS/JS in `web/` — **no** `package.json`/npm |
| Configuration | `tauri.conf.json`, `capabilities/default.json`, `Cargo.toml` |
| Plugins | opener, dialog, fs, window-state, single-instance, deep-link, log |

---

## Build requirements (mandatory)

### Common

1. **Rust toolchain** — the project uses **edition 2024**, which requires **Rust 1.85 or newer**.
   ```bash
   rustc --version   # must be >= 1.85
   ```
2. **Tauri CLI v2** — install via cargo:
   ```bash
   cargo install tauri-cli --version "^2" --locked
   ```
   or via [rustup](https://tauri.app/v2/start/prerequisites/):
   ```bash
   rustup toolchain install stable
   cargo install tauri-cli --locked
   ```
3. **System dependencies for Tauri** — see the [official prerequisites](https://tauri.app/v2/start/prerequisites/) for your OS (main ones below).

### macOS

- **Xcode Command Line Tools** (provides `cc`, `clang`, and the SDK):
  ```bash
  xcode-select --install
  ```
- Nothing else required — the WebView comes from the system WebKit/WKWebView.

### Linux (Debian/Ubuntu example)

```bash
sudo apt update
sudo apt install -y \
  libwebkit2gtk-4.1-dev \
  build-essential \
  curl \
  wget \
  file \
  libxdo-dev \
  libssl-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev
```

### Windows

- **Microsoft Visual Studio Build Tools** with the “Desktop development with C++” workload.
- **WebView2 Runtime** (usually preinstalled on Windows 10/11).
- Rust via [rustup](https://rustup.rs/) (MSVC toolchain, not GNU).

---

## Building

### Development mode (with hot reload)

```bash
cargo tauri dev
```

Starts the backend and opens the WebView window; changes in `web/` reload automatically.

### Production build

```bash
cargo tauri build
```

Bundles are generated under `target/release/bundle/`:

- **macOS:** `.app` / `.dmg` — install with:
  ```bash
  ditto "target/release/bundle/macos/rTransmission Client.app" \
        "/Applications/rTransmission Client.app"
  ```
- **Windows:** `.msi` / `.exe` installer
- **Linux:** `.deb` / `.AppImage`

### Code checks

```bash
cargo clippy   # lint
cargo fmt      # format
node --check web/main.js   # JS syntax check (repeat for other files in web/)
```

> **Note (macOS):** the shell session may lack `/usr/bin` in `$PATH`. If a system tool is not found, run the command in your terminal or prefix with:
> ```bash
> PATH="/opt/homebrew/bin:/opt/homebrew/sbin:$HOME/.cargo/bin:/usr/bin:/usr/sbin:/bin:/sbin:$PATH" cargo tauri build
> ```

---

## Configuration

Settings are stored as JSON at:

```
~/.rtransmission/config.json              # Linux / macOS
%USERPROFILE%\.rtransmission\config.json  # Windows
```

Key fields: `rpc_host`, `rpc_port`, `rpc_auth`, `rpc_username`, `rpc_password` (base64 on disk — obfuscation only, not crypto), `rpc_https`, `rpc_insecure`, `auto_connect`, `default_download_dir`, `theme`.

Defaults (host/port/HTTPS, download dir, notifications, tray, limits) are changed from the Settings / Connection Settings windows inside the app.

---

## Architecture (short)

- `src/lib.rs` — the entire Rust backend: RPC to the daemon, settings, dialog windows, tray, deep links, file associations.
- `src/main.rs` — entry point, calls `lib::run()`.
- `web/` — static frontend (`index.html` + dialog windows), no build step; `i18n.js` provides translations.
- Events: Rust emits `torrents-update`, `session-stats-update`, `alt-speed-update`, `menu-*` etc.; JS listens via Tauri `listen()`.
- Transmission RPC: the typed API is limited — full session settings are read/written via raw RPC (`session-get` / `session-set`).

---

## Icons

Icons are generated with [tauri icon](https://tauri.app/v2/cli#icon) from `icons/rtransmission.svg`. To regenerate:

```bash
cargo tauri icon path/to/icon.png
```
