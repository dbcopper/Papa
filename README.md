# Papa Pet MVP

Minimal Tauri v2 + React + TypeScript desktop pet that lives in a transparent always-on-top window. It accepts OS file drops, stores metadata in SQLite, and shows bubble panels for file actions and chat with LLM settings.

## Current Features (Product Overview)
- A tiny always-on-top desktop companion that stays out of the way yet always within reach.
- Drag and drop a file to instantly surface a clean action panel for summaries, action items, and memory.
- One‑click “Chat with Papa” for quick explain/save/reply-email flows in a friendly, focused dialog.
- Built‑in LLM settings (provider/model/API key) so you can connect your preferred model in seconds.
- Lightweight, fast, and visually calm—designed to keep your attention on the task, not the UI.

## Project Structure
- `src/` React UI, pet state machine, bubble panel, mock streaming.
- `src/styles/` UI styles and animations.
- `public/assets/` placeholder PNG assets.
- `src-tauri/` Rust backend, SQLite, drag/drop events, and commands.

## Key Window Config
`src-tauri/tauri.conf.json` sets:
- transparent, no decorations, always-on-top
- base size (320x320) with max bounds (800x500)
- default position near bottom-right (tweak `x/y` per platform)

The frontend expands the window when panels are open (currently 720x460) and collapses when idle.

## Commands
- `pnpm install` (or `npm install`)
- `pnpm tauri dev` (or `npm run tauri dev`) to run the app
- `pnpm build` to build the frontend

## Notes / Pitfalls
- Transparent windows can behave differently across OS versions; on Windows, ensure GPU acceleration is enabled.
- Drag and drop events are handled by Rust and emitted to the frontend (`drag-over`, `drag-leave`, `drop-processed`).
- The DB is stored in the platform app data directory (`papa_pet.sqlite`).
- Right-click to open the quick menu (sleep/wake, hide 10s, quit).

## SQLite Schema
Table `drop_records` stores: file path, hash, timestamp, and mock outputs (summary, actions, memory).
