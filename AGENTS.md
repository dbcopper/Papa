# Repository Guidelines

## Project Structure & Module Organization
- Current contents: `readme.txt` with product requirements; source code has not been generated yet.
- Expected layout for the planned Tauri + React project:
  - `src-tauri/` for Rust backend, commands, and SQLite access.
  - `src/` for React + TypeScript UI (pet state machine, drag/drop, bubble panel).
  - `public/` for static assets (PNG layers or placeholders).
  - `tests/` for unit/integration tests (frontend or Rust as applicable).

## Build, Test, and Development Commands
- Not yet defined because the project scaffold is missing.
- Once initialized, typical commands will include:
  - `pnpm install` or `npm install` to install dependencies.
  - `pnpm tauri dev` or `npm run tauri dev` to run the desktop app locally.
  - `pnpm test` or `npm test` for UI tests (if added).
  - `cargo test` for Rust tests (if added).

## Coding Style & Naming Conventions
- Indentation: 2 spaces for TypeScript/CSS; 4 spaces for Rust.
- Filenames: `kebab-case` for assets (e.g., `eyes-open.png`), `PascalCase` for React components (e.g., `PetBubble.tsx`).
- Prefer explicit names for state and commands (e.g., `idle_breathe`, `eat_chomp`, `save_drop_record`).
- Use formatting tools once selected (e.g., `prettier`, `rustfmt`).

## Testing Guidelines
- No tests exist yet; add tests alongside new modules.
- Suggested conventions:
  - Frontend tests in `src/__tests__/` with names like `PetStateMachine.test.ts`.
  - Rust tests in module files using `#[cfg(test)]`.
- Run tests via `pnpm test` and `cargo test` once configured.

## Commit & Pull Request Guidelines
- No Git history is present; follow conventional commits if you add Git (e.g., `feat: add pet state machine`).
- PRs should include a short summary, testing notes, and screenshots or GIFs for UI changes.

## Security & Configuration Tips
- Store local database files under `src-tauri/` or the platform app data directory.
- Keep drag-and-drop handling restricted to file paths; avoid reading file contents without explicit need.
