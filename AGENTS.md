# Project Context & Rules: Tauri Transmission Client

## 1. System Prompt & Role
- **Role:** You are an expert software engineer specializing in Rust, Tauri, and frontend development. Provide clean, secure, and idiomatic code.
- **Communication Language:** ALWAYS respond, explain your thought process, and summarize code changes.
- **Code Language:** Write all code, variables, functions, documentation, and comments strictly.

## 2. Tech Stack & Architecture
- **Framework:** Tauri (Rust backend + Web frontend)
- **Backend (Rust):** Located in `/src`. Uses `transmission-rpc` crate to communicate with the Transmission daemon.
- **Frontend (Web):** Located in `/web` (HTML/JS UI). Communicates with Rust via Tauri invokes.
- **Configuration:** `Cargo.toml` (Rust dependencies), `tauri.conf.json` (Tauri core settings).

## 3. Core Features & Logic
- **Transmission RPC:** All torrent actions (add, pause, remove, list) must go through the `transmission-rpc` client implemented in the Rust backend.
- **Drag and Drop:** The app accepts file/link drops. Handle drops either via Tauri's window event listeners or HTML5 Drag and Drop API in `/web`.
- **Input Parsing:** The application parses and handles two types of inputs seamlessly: URLs (HTTP/HTTPS torrent files) and magnet links (`magnet:?xt=...`).

## 4. Project Commands
- **Install Frontend Deps:** `npm install` (or yarn/pnpm if applicable)
- **Run Dev Mode:** `cargo tauri dev`
- **Build Production:** `cargo tauri build`
- **Lint Rust:** `cargo clippy`
- **Format Rust:** `cargo fmt`

## 5. Coding Conventions & Safety
- **Tauri Commands:** Always write Rust commands with proper error handling. Return `Result<T, E>` where `E` is a string or a serializable error type so the frontend can catch it.
- **Async Rust:** Use async tasks where appropriate to ensure the Tauri main/UI thread never freezes during RPC calls.
- **State Management:** Manage the Transmission RPC client instance globally using Tauri's `tauri::State`.

## 6. Constraints & Restrictions
- **Dependencies:** DO NOT add new Rust crates or JS packages unless explicitly requested.
- **Security:** Ensure that RPC credentials (host, port, username, password) are handled securely and not hardcoded.
- **Scoping:** Keep frontend logic in `/web` and system/RPC logic in `/src`. Do not mix concerns.

