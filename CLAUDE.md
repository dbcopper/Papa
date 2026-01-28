# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Claude Code 规则

- 所有回答使用中文
- 不要尝试在 WSL 里运行命令，程序是在 Windows cmd 上运行的
- 不要自动生成摘要 Markdown 文件，如果需要更新文档请更新到 CLAUDE.md

## Project Overview

Papa Pet is a desktop pet application built with Tauri v2 + React + TypeScript. It's a transparent, always-on-top window that accepts OS file drops and processes them with animations and optional LLM integration. The pet tracks global mouse movement, displays various emotional states, and can interact with files through drag-and-drop.

## Development Commands

```bash
# Install dependencies
pnpm install  # or npm install

# Run development server
pnpm tauri dev  # or npm run tauri dev

# Build frontend only
pnpm build

# Build Tauri application for release
pnpm tauri build
```

Note: This project uses both Vite (frontend) and Tauri (desktop wrapper). The `tauri dev` command runs both the Vite dev server and the Rust backend.

## Architecture Overview

### Frontend Architecture (React + TypeScript)

**Main Component**: `src/App.tsx` (~2800 lines)
- Single-file architecture with all state management, event handling, and UI rendering
- Uses React hooks for state management (no external state library)
- Animation libraries: `animejs` for eye tracking, `gsap` with MorphSVGPlugin for complex mouth animations

**Key State Systems**:
1. **Pet State Machine**: Manages 15+ emotional states (`idle_breathe`, `eat_chomp`, `thinking`, `happy`, `tired`, `excited`, etc.)
2. **Global Mouse Tracking**: Pupils follow cursor across all applications/windows via Rust backend events
3. **Behavior Analysis**: Monitors typing speed, mouse activity, idle time to infer user mood
4. **File Drop System**: Drag-and-drop workflow with animated responses
5. **LLM Integration**: Optional OpenAI/Anthropic API calls for processing files (see USE_MOCK constant)

**Animation System**:
- Eye tracking uses animejs with smooth easing
- Mouth morphing uses GSAP MorphSVGPlugin to transition between SVG path shapes
- State-specific animations triggered by pet state changes
- Breathing, blinking, and eating animations with configurable timing

**Window Management**:
- Two window states: collapsed (320×320) and expanded (720×320)
- Position-anchored expansion (left-top stays fixed, expands right)
- Always-on-top, transparent, no window decorations

### Backend Architecture (Rust + Tauri)

**Main File**: `src-tauri/src/main.rs`

**Core Systems**:
1. **SQLite Database** (`papa_pet.sqlite` in app data directory)
   - Schema: `drop_records` table with file path, SHA256 hash, timestamps, and processing results
   - Thread-safe access via Mutex-wrapped state

2. **Global Input Monitoring** (device_query crate)
   - Mouse position polling at 60fps (16ms intervals)
   - Keyboard activity tracking for behavior analysis
   - Emits events: `global-mouse-move`, `global-mouse-button`, `behavior-analysis`

3. **File Processing**
   - Calculates SHA256 hash on file drop
   - Stores metadata in SQLite
   - File content reading limited to 1MB

4. **LLM API Integration** (optional)
   - OpenAI and Anthropic API support
   - Used for file summarization and analysis features
   - Async reqwest-based HTTP calls

**Tauri Commands** (invoke from frontend):
- `process_drop_paths_command`: Process dropped files, return record ID
- `save_mock_result`: Save summarization/action/memory results to DB
- `set_window_size`: Resize window while maintaining position
- `hide_for`: Temporarily hide window for specified milliseconds
- `call_llm_api`: Make LLM API requests (OpenAI/Anthropic)
- `read_file_content`: Read file content (max 1MB)

**Tauri Events** (listen in frontend):
- `global-mouse-move`: Mouse position updates (60fps)
- `global-mouse-button`: Mouse button state changes
- `behavior-analysis`: User activity metrics (every 2 seconds)
- `onDragDropEvent`: Native drag-drop events (hover/drop/leave)

### Configuration

**Tauri Config**: `src-tauri/tauri.conf.json`
- Window: 320×320 default size, transparent, no decorations, always-on-top
- Position: (1200, 680) - adjust per platform/screen
- Dev server: http://localhost:5173 (Vite)

**Build Config**: `src-tauri/Cargo.toml`
- Key dependencies: tauri 2.9.5, rusqlite (bundled), device_query, reqwest, sha2
- Release profile: panic=abort, LTO enabled, single codegen unit for optimization

## Code Organization Patterns

### Frontend Patterns
- **Pupil tracking**: `getPupilState`, `setPupilState`, `getPupilOffset` helper functions for eye animation
- **Mock vs Real LLM**: Toggle with `USE_MOCK` constant (line 71 in App.tsx)
- **Streaming text**: `StreamingText` component for character-by-character display (22ms/char)
- **State transitions**: Pet state changes trigger animation sequences via useEffect hooks

### Backend Patterns
- **Database access**: Always use `state.lock` to ensure thread safety
- **Event dispatch**: Use `window.emit()` for Tauri events or `dispatch_js_event()` helper for custom events
- **Error handling**: Commands return `Result<T, String>` for frontend error messages

## Key Features to Understand

1. **Cross-window eye tracking**: The pet's eyes follow your cursor even when you're in other applications. This works via a Rust background task polling global mouse position every 16ms.

2. **Mood inference**: The backend monitors typing patterns, mouse movement, and idle time to estimate user mood (focused/tired/excited/confused/relaxed). The pet adjusts its behavior accordingly.

3. **File drop workflow**:
   - Drag file over window → state: `waiting_for_drop` (big O-shaped mouth)
   - Drop file → state: `eat_chomp` (chewing animation)
   - Processing → state: `thinking` (animated expression)
   - Complete → state: `success_happy` or `error_confused`

4. **Window resizing**: When showing the operation panel, the window expands to 720px width while keeping the pet in the same screen position (left-top anchor).

5. **Animation examples**: The `examples/` directory contains standalone HTML demos of swallow animations using both animejs and GSAP.

## Development Notes

- The app uses **transparent windows**, which can behave differently across OS versions. On Windows, ensure GPU acceleration is enabled.
- **Global input monitoring** may require accessibility permissions on macOS.
- The database is stored in the platform-specific app data directory (check `tauri::path::BaseDirectory::AppData`).
- Right-click the pet to access the quick menu (sleep/wake, hide temporarily, quit).
- The frontend is a single large component. When making changes, search for the relevant state or animation function.
- GSAP's MorphSVGPlugin requires a license for commercial use (currently used for mouth animations).

## Testing & Debugging

- Use the debug mode toggle in the UI to display state information and manual state controls
- Check browser DevTools console for frontend errors
- Rust backend logs are visible in the terminal when running `pnpm tauri dev`
- SQLite database can be inspected at `{AppData}/papa_pet.sqlite`

## Important Constants to Know

- `BLINK_MIN_MS / BLINK_MAX_MS`: Controls blink frequency (15-30 seconds)
- `MOOD_CHECK_INTERVAL`: How often to analyze user behavior (3 seconds)
- `CONVERSATION_COOLDOWN`: Minimum time between pet conversations (30 seconds)
- `WINDOW_COLLAPSED / WINDOW_EXPANDED`: Window size configurations
