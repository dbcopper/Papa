# Papa Pet MVP

Minimal Tauri v2 + React + TypeScript desktop pet that lives in a transparent always-on-top window. It accepts OS file drops, stores metadata in SQLite, and shows a bubble panel with mock streaming output.

## Project Structure
- `src/` React UI, pet state machine, bubble panel, mock streaming.
- `src/styles/` UI styles and animations.
- `public/assets/` placeholder PNG assets.
- `src-tauri/` Rust backend, SQLite, drag/drop events, and commands.

## Key Window Config
`src-tauri/tauri.conf.json` sets:
- transparent, no decorations, always-on-top
- fixed size (320x320)
- default position near bottom-right (tweak `x/y` per platform)

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
