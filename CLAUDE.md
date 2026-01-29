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

**目录结构**：
```
src/
├── components/          # UI 组件
│   ├── index.ts         # 组件导出
│   ├── ContextMenu.tsx  # 右键菜单
│   ├── ReminderToast.tsx # 提醒通知
│   ├── RecordPanel.tsx  # 记录面板
│   ├── SettingsPanel.tsx # 设置面板
│   └── PapaSpacePanel.tsx # Papa Space 面板
├── hooks/               # 自定义 Hooks
│   ├── index.ts
│   ├── useLlmSettings.ts # LLM 设置状态
│   ├── useReminder.ts   # 提醒状态
│   ├── usePapaSpace.ts  # Papa Space 状态
│   └── useRecordPanel.ts # 记录面板状态
├── services/
│   └── api.ts           # Tauri 命令封装
├── types/
│   └── index.ts         # TypeScript 类型定义
├── constants/
│   └── index.ts         # 常量和配置
├── utils/
│   └── helpers.ts       # 工具函数
├── styles/
│   └── app.css          # 样式文件
└── App.tsx              # 主组件（~2300 行）
```

**主组件**: `src/App.tsx`
- 模块化架构，状态和 UI 组件已拆分
- 使用自定义 Hooks 管理复杂状态（useLlmSettings, useReminder, usePapaSpace, useRecordPanel）
- Animation libraries: `animejs` for eye tracking, `gsap` with MorphSVGPlugin for complex mouth animations

**Key State Systems**:
1. **Pet State Machine**: Manages 15+ emotional states (`idle_breathe`, `eat_chomp`, `thinking`, `happy`, `tired`, `excited`, etc.)
2. **Global Mouse Tracking**: Pupils follow cursor across all applications/windows via Rust backend events
3. **Behavior Analysis**: Monitors typing speed, mouse activity, idle time to infer user mood
4. **File/Text Drop System**: Drag-and-drop workflow with animated responses (supports both files and text)
5. **LLM Integration**: Optional OpenAI/Anthropic API calls for processing files (see USE_MOCK constant in constants/index.ts)

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

**Tauri Commands** (invoke from frontend, 封装在 `src/services/api.ts`):
- `process_drop_paths_command`: Process dropped files, return record ID
- `save_dropped_file`: Save file content from DOM drop events (for text/file drag support)
- `save_mock_result`: Save summarization/action/memory results to DB
- `set_window_size`: Resize window while maintaining position
- `hide_for`: Temporarily hide window for specified milliseconds
- `call_llm_api`: Make LLM API requests (OpenAI/Anthropic)
- `read_file_content`: Read file content (max 1MB)
- `create_drop_event`: Create timeline event from file drop
- `create_text_event`: Create timeline event from text
- `list_events`: List timeline events by date
- `update_event_note`: Update event note
- `delete_event`: Delete timeline event
- `snooze_reminder`: Snooze a reminder
- `dismiss_reminder`: Dismiss a reminder
- `list_pending_reminders`: List pending reminders
- `generate_daily_export`: Generate daily export (MD/HTML)
- `open_export_folder`: Open exports folder in file manager
- `get_setting` / `set_setting`: Settings management

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

**类型定义** (`src/types/index.ts`):
- `PetState`: 宠物状态类型
- `TimelineEvent`, `TimelineEventWithAttachments`: 时间线事件
- `Reminder`, `ReminderDuePayload`: 提醒相关类型
- `LlmSettings`: LLM 配置类型
- `WindowSize`: 窗口尺寸类型

**常量** (`src/constants/index.ts`):
- `USE_MOCK`: 切换 Mock/Real LLM
- `WINDOW_COLLAPSED`, `WINDOW_EXPANDED`: 窗口尺寸配置
- `LLM_MODELS`: 支持的 LLM 模型列表
- `DEFAULT_LLM_SETTINGS`: 默认 LLM 设置
- `MOOD_CHECK_INTERVAL`, `CONVERSATION_COOLDOWN`: 行为检测间隔

**自定义 Hooks** (`src/hooks/`):
- `useLlmSettings`: LLM 设置状态管理，带 localStorage 持久化
- `useReminder`: 提醒 Toast 状态（show/hide/snooze/dismiss）
- `usePapaSpace`: Papa Space 面板状态（事件列表、日期选择、编辑、AI 摘要）
- `useRecordPanel`: 记录面板状态（pending files/text、note、remind）

**UI 组件** (`src/components/`):
- `ContextMenu`: 右键菜单（Papa Space、Settings、Sleep/Wake、Hide、Quit）
- `RecordPanel`: 记录面板（文件/文本预览、备注、提醒设置）
- `ReminderToast`: 提醒通知（Done、Snooze 操作）
- `SettingsPanel`: 设置面板（LLM Provider、Model、API Key）
- `PapaSpacePanel`: Papa Space 控制中心（日期选择、时间线、AI 摘要、导出）

**工具函数** (`src/utils/helpers.ts`):
- `formatLocalDate`, `formatTime`, `formatDateTime`: 日期格式化
- `getFileDisplayName`, `isImageFile`, `getFileExtension`: 文件处理
- `truncate`, `clamp`, `lerp`: 通用工具

**API 封装** (`src/services/api.ts`):
- 所有 Tauri invoke 调用的封装函数
- 统一的错误处理和类型定义

**动画相关** (保留在 `App.tsx`):
- `getPupilState`, `setPupilState`, `getPupilOffset`: 眼睛动画辅助函数
- `StreamingText` 组件: 逐字显示文本（22ms/char）
- 状态转换触发动画序列（通过 useEffect hooks）

### Backend Patterns
- **Database access**: Always use `state.lock` to ensure thread safety
- **Event dispatch**: Use `window.emit()` for Tauri events or `dispatch_js_event()` helper for custom events
- **Error handling**: Commands return `Result<T, String>` for frontend error messages

## Key Features to Understand

1. **Cross-window eye tracking**: The pet's eyes follow your cursor even when you're in other applications. This works via a Rust background task polling global mouse position every 16ms.

2. **Mood inference**: The backend monitors typing patterns, mouse movement, and idle time to estimate user mood (focused/tired/excited/confused/relaxed). The pet adjusts its behavior accordingly.

3. **File/Text drop workflow**:
   - Drag file/text over window → state: `waiting_for_drop` (big O-shaped mouth)
   - Drop → state: `eat_chomp` (chewing animation)
   - Show RecordPanel → 用户可添加备注和设置提醒
   - Save → 保存到数据库，state: `success_happy`
   - Cancel → 取消记录，state: `idle_breathe`
   - 注意：使用 DOM 拖拽事件（非 Tauri 原生），支持文本和文件

4. **Window resizing**: When showing the operation panel, the window expands to 720px width while keeping the pet in the same screen position (left-top anchor).

5. **Animation examples**: The `examples/` directory contains standalone HTML demos of swallow animations using both animejs and GSAP.

## Development Notes

- The app uses **transparent windows**, which can behave differently across OS versions. On Windows, ensure GPU acceleration is enabled.
- **Global input monitoring** may require accessibility permissions on macOS.
- The database is stored in the platform-specific app data directory (check `tauri::path::BaseDirectory::AppData`).
- Right-click the pet to access the quick menu (Papa Space, Settings, Sleep/Wake, Hide 10s, Quit).
- **拖拽支持**: 同时支持文件拖拽和文本拖拽，通过 DOM 事件处理（`dragDropEnabled: false` in tauri.conf.json）
- **代码组织**: 前端已模块化，状态逻辑在 hooks 中，UI 在 components 中，业务逻辑在 App.tsx 中
- GSAP's MorphSVGPlugin requires a license for commercial use (currently used for mouth animations).

## Testing & Debugging

- Use the debug mode toggle in the UI to display state information and manual state controls
- Check browser DevTools console for frontend errors
- Rust backend logs are visible in the terminal when running `pnpm tauri dev`
- SQLite database can be inspected at `{AppData}/papa_pet.sqlite`

## Important Constants to Know

所有常量定义在 `src/constants/index.ts`:

- `USE_MOCK`: 是否使用 Mock LLM 响应（开发时设为 true）
- `BLINK_MIN_MS / BLINK_MAX_MS`: Controls blink frequency (15-30 seconds)
- `MOOD_CHECK_INTERVAL`: How often to analyze user behavior (3 seconds)
- `CONVERSATION_COOLDOWN`: Minimum time between pet conversations (30 seconds)
- `WINDOW_COLLAPSED`: { width: 320, height: 320 }
- `WINDOW_EXPANDED`: { width: 720, height: 320 }
- `LLM_MODELS`: 支持的模型列表 { openai: [...], anthropic: [...] }
- `DEFAULT_LLM_SETTINGS`: 默认 LLM 配置

---

# Papa Pet 开发档案（Development Dossier）

## 1. 项目概述

### 1.1 产品目标

构建一个桌面常驻、低打扰的个人工作/生活记录器：

- **白天**：用户把"文字/截图/文件/想法"喂给 Papa → 可靠记录（不依赖 LLM）
- **任意时刻**：可在记录时附加 **提醒指令**（如"3 天后提醒我跟进"）
- **晚上**：自动或一键生成 **当日文档输出**（含时间点/日期/附件索引）
- **早上**：问候 + 基于近期日志的轻提醒（可选 LLM 增强）
- 支持"情境状态"（Morning/Focus/Evening/Idle）驱动行为
- 右键进入 **Papa Space**（控制中心）：设置、日志查看、导出管理

### 1.2 非目标（MVP 明确不做）

- 不做通用聊天机器人入口（聊天仅作为"对记录的解释/摘要增强"）
- 不做复杂的自动执行（发邮件/改文件/操作系统自动化）
- 不做跨设备云同步（先本地优先）
- 不做重度任务管理（提醒挂靠记录项即可）

## 2. 用户流程与关键路径

### 2.1 白天记录（核心路径）

1. 用户拖入文件/截图到 Papa 主窗口
2. 弹出 Bubble Panel（记录面板）
3. 用户可选：填写备注（note）/添加提醒（remind_at 或 after）
4. 保存 → 生成 `timeline_event`（+ attachments）+ optional reminder
5. 面板收起，窗口恢复 320x320

**成功标准**： 3 秒内完成一次记录（拖入→保存→回到桌面不打扰）

### 2.2 晚上输出（高光路径）

1. 到达设定时间（如 18:10）或用户手动触发"生成今日文档"
2. 系统读取当日 `timeline_events`
3. 生成 Markdown（或 HTML）并落盘
4. 用户在 Papa Space 中可查看、复制、导出 PDF（可后置）

**成功标准**： 输出内容结构稳定，可回顾、可复制发送

### 2.3 提醒触发（粘性路径）

1. `reminder` 到期（pending 且 remind_at <= now）
2. Papa 弹出提醒气泡
3. 用户选择：完成/稍后/忽略
4. 更新 reminder 状态与日志记录

**成功标准**： 提醒准确、轻、可延后

### 2.4 早上问候（陪伴路径）

1. 第一次唤醒或到达 morning 时间（如 9:00）
2. Papa 显示"早安 + 昨日回顾（短）+ 今日提醒（轻）"
3. 用户可一键打开 Papa Space 查看详情

## 3. 信息架构与模块划分

### 3.1 模块总览

| 模块 | 职责 |
|------|------|
| **Desktop Pet Shell**（主窗） | 透明置顶、宠物动画、状态指示 |
| **Bubble Panel**（记录/提醒/聊天） | 轻交互面板 |
| **Papa Space**（控制中心） | 日志列表、详情、导出、设置 |
| **Data Layer**（SQLite） | 时间线、附件、提醒、导出记录 |
| **Scheduler**（提醒调度） | 定时扫描 reminders |
| **Exporter**（文档生成） | 日更 markdown / html / pdf（后置） |
| **Optional AI Layer** | 摘要/回顾/自然语言时间解析（可插拔） |

## 4. 数据模型（SQLite Schema）

升级为"时间线优先"的结构：事件、附件、提醒、导出。

### 4.1 表：timeline_events

```sql
CREATE TABLE IF NOT EXISTS timeline_events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,                 -- 'file' | 'image' | 'text' | 'thought'
  title TEXT,                         -- 可选：自动生成或用户输入
  note TEXT,                          -- 用户备注（核心）
  text_content TEXT,                  -- 当 type='text' 时存内容
  created_at INTEGER NOT NULL,        -- unix ms
  source TEXT,                        -- 'drop' | 'manual' | 'clipboard' (预留)
  is_deleted INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_timeline_created_at ON timeline_events(created_at);
```

### 4.2 表：attachments（文件/截图/图片）

```sql
CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  kind TEXT NOT NULL,                 -- 'file' | 'image'
  original_path TEXT NOT NULL,
  stored_path TEXT,                   -- 可选：复制到 app data（推荐）
  file_name TEXT,
  mime_type TEXT,
  size_bytes INTEGER,
  sha256 TEXT,
  width INTEGER,                      -- 图片可选
  height INTEGER,                     -- 图片可选
  created_at INTEGER NOT NULL,
  FOREIGN KEY(event_id) REFERENCES timeline_events(id)
);
CREATE INDEX IF NOT EXISTS idx_attach_event ON attachments(event_id);
```

### 4.3 表：reminders（挂在事件上的提醒）

```sql
CREATE TABLE IF NOT EXISTS reminders (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  remind_at INTEGER NOT NULL,         -- unix ms
  message TEXT NOT NULL,              -- 提醒内容（默认来自 note 或用户输入）
  status TEXT NOT NULL,               -- 'pending' | 'triggered' | 'dismissed' | 'snoozed'
  triggered_at INTEGER,
  snooze_until INTEGER,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(event_id) REFERENCES timeline_events(id)
);
CREATE INDEX IF NOT EXISTS idx_remind_due ON reminders(status, remind_at);
```

### 4.4 表：daily_exports（每日文档输出记录）

```sql
CREATE TABLE IF NOT EXISTS daily_exports (
  id TEXT PRIMARY KEY,
  date_key TEXT NOT NULL,             -- 'YYYY-MM-DD'（本地时区）
  output_format TEXT NOT NULL,        -- 'md' | 'html' | 'pdf'
  output_path TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_export_date_format ON daily_exports(date_key, output_format);
```

### 4.5 表：settings（简化版 KV）

```sql
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```

## 5. 事件与接口设计（Tauri Commands & Events）

### 5.1 Rust → Frontend 事件（emit）

| 事件名 | 说明 |
|--------|------|
| `drag-over` | 进入可投放区域 |
| `drag-leave` | 离开 |
| `drop-received` | 收到拖放原始信息（paths/mime 等） |
| `drop-processed` | 文件已入库（返回 event_id / attachment_id） |
| `reminder-due` | 提醒到期（payload：reminder + event + attachment preview） |
| `daily-export-ready` | 文档已生成（path/date_key） |

### 5.2 Frontend → Rust Commands（invoke）

#### 记录相关

| Command | 参数 | 说明 |
|---------|------|------|
| `create_text_event` | `note, text_content, remind?: RemindSpec` | 创建文本记录 |
| `create_drop_event` | `files[], note?, remind?` | 创建拖放记录 |
| `delete_event` | `event_id` | 删除事件 |
| `list_events` | `date_range \| page` | 列出事件 |
| `get_event_detail` | `event_id` | 获取事件详情 |

#### 提醒相关

| Command | 参数 | 说明 |
|---------|------|------|
| `create_reminder` | `event_id, remind_at, message` | 创建提醒 |
| `snooze_reminder` | `reminder_id, minutes` | 延后提醒 |
| `dismiss_reminder` | `reminder_id` | 关闭提醒 |
| `list_pending_reminders` | - | 列出待处理提醒 |

#### 导出相关

| Command | 参数 | 说明 |
|---------|------|------|
| `generate_daily_export` | `date_key, format` | 生成每日导出，返回 output_path |
| `list_exports` | `date_range` | 列出导出记录 |

#### 设置相关

| Command | 参数 | 说明 |
|---------|------|------|
| `get_setting` | `key` | 获取设置 |
| `set_setting` | `key, value` | 保存设置 |
| `list_settings` | - | 列出所有设置 |

## 6. 前端 UI/UX 规范

### 6.1 主窗（Pet Window）

- **默认**：320x320，透明置顶，无边框
- **仅显示**：宠物 + 状态小指示（点/表情）
- **右键菜单**：
  - Open Papa Space
  - Focus Mode（切换）
  - Hide 10s
  - Quit

### 6.2 Bubble Panel（记录面板）

**触发**：拖入/快捷键（可后置）/手动记录

**字段**：
- **标题/预览**：文件名 / 图片缩略图 / 文本片段
- **note 输入框**（1～3 行默认）
- **提醒开关**：⏰ 提醒我
  - 选项 A（MVP 推荐）：时间选择器（绝对时间）
  - 选项 B：快捷按钮（10min / 1h / 明天上午 / 3天后）
- **保存 / 取消**

### 6.3 Reminder Toast（提醒气泡）

- **文案**：你之前让我提醒你：{message}
- **关联**：显示附件缩略或文件名
- **操作**：
  - ✅ Done（dismiss）
  - ⏰ Snooze（10min / 1h 自选）
  - 📝 Open（打开事件详情）

### 6.4 Papa Space（控制中心）

- **左侧**：日期列表（最近 14 天）
- **右侧**：当天详情（时间线）
  - 每条 event：时间 + 类型图标 + note + 附件
  - 事件详情页：附件列表、提醒列表、编辑 note
- **顶部**：导出按钮（MD/HTML；PDF 后置）
- **设置页**：
  - `morning_time`（默认 09:00）
  - `evening_export_time`（默认 18:10）
  - `reminder_scan_interval`（默认 60s）
  - `storage_policy`（copy to appdata / keep original ref）
  - LLM provider/model/key（可选）

## 7. 开发迭代计划

### Phase 1: 数据层重构 ✅ 已完成

1. ✅ 创建新的 SQLite 表结构（timeline_events, attachments, reminders, daily_exports, settings）
2. ✅ 迁移现有 drop_records 数据到新结构
3. ✅ 实现基础 CRUD Tauri Commands

### Phase 2: Bubble Panel 记录流程 ✅ 已完成

1. ✅ 实现拖放后弹出 Bubble Panel（RecordPanel 组件）
2. ✅ 实现 note 输入 + 保存逻辑
3. ✅ 实现提醒时间选择（快捷按钮：10min / 1h / Tomorrow / 3 days）
4. ✅ 支持文本拖拽（除了文件拖拽）

### Phase 3: 提醒系统 ✅ 已完成

1. ✅ 实现 Rust 后台提醒扫描器（每 60s 检查到期 reminders）
2. ✅ 实现 reminder-due 事件推送
3. ✅ 实现前端 Reminder Toast 及交互（ReminderToast 组件）

### Phase 4: Papa Space 控制中心 ✅ 已完成

1. ✅ 实现面板（PapaSpacePanel 组件）
2. ✅ 实现日期列表 + 时间线视图
3. ✅ 实现事件详情编辑
4. ✅ 实现 AI 摘要功能

### Phase 5: 每日导出 ✅ 已完成

1. ✅ 实现 Markdown 导出生成器
2. ✅ 实现 HTML 导出生成器
3. ✅ 实现手动触发导出
4. ✅ 实现打开导出文件夹功能

### Phase 6: 代码重构 ✅ 已完成

1. ✅ 拆分类型定义到 `src/types/`
2. ✅ 拆分常量到 `src/constants/`
3. ✅ 拆分 API 调用到 `src/services/`
4. ✅ 拆分工具函数到 `src/utils/`
5. ✅ 拆分自定义 Hooks 到 `src/hooks/`
6. ✅ 拆分 UI 组件到 `src/components/`

### Phase 7: 早间问候（待开发）

1. 实现情境状态检测（Morning/Focus/Evening/Idle）
2. 实现早间问候 UI
3. 可选：接入 LLM 生成回顾摘要
