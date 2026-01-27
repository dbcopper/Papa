# Papa Pet - 功能与接口文档

## 📋 项目概述

Papa Pet 是一个基于 Tauri + React 的桌面宠物应用，可以接收拖放的文件并进行处理。

## 🎨 前端功能

### 1. 宠物状态系统
宠物有 7 种状态，每种状态都有对应的动画和表情：

- **`idle_breathe`** - 空闲呼吸（默认状态）
- **`idle_blink`** - 空闲眨眼（随机触发，15-30秒间隔）
- **`waiting_for_drop`** - 等待拖放（拖拽文件进入窗口时，显示100px大O形嘴巴）
- **`eat_chomp`** - 吃文件（文件放下时，咀嚼动画）
- **`thinking`** - 思考中（处理文件时）
- **`success_happy`** - 成功开心（操作完成）
- **`error_confused`** - 错误困惑（处理失败）

### 2. 交互功能

#### 2.1 全局鼠标跟踪
- **功能**：宠物眼睛会跟随全局鼠标位置（跨窗口、跨应用）
- **实现**：Rust 后端每 16ms 轮询全局鼠标位置并发送事件
- **特点**：即使鼠标移出窗口，眼睛也会继续跟踪

#### 2.2 拖拽文件处理
- **拖拽进入**：检测到拖拽时，宠物进入 `waiting_for_drop` 状态（大O形嘴巴）
- **文件放下**：触发 `eat_chomp` 状态，处理文件并显示操作面板
- **拖拽离开**：恢复 `idle_breathe` 状态

#### 2.3 文件操作面板
文件放下后显示三个操作选项：
- **Summarize** - 总结文件内容
- **Extract action items** - 提取待办事项
- **Remember** - 记住文件（存储元数据）

每个操作会：
1. 触发对应的表情动画
2. 显示流式文本（逐字显示，22ms/字符）
3. 完成后保存结果到数据库

#### 2.4 窗口管理
- **自动调整大小**：
  - 折叠状态：320×320px（空闲时）
  - 展开状态：720×320px（显示操作面板时）
- **位置固定**：窗口大小变化时保持左上角位置不变

#### 2.5 其他功能
- **静音模式**（Sleep/Wake）：禁用所有动画和交互
- **调试控制**：显示状态切换按钮和调试信息
- **右键菜单**：隐藏窗口、退出等功能
- **窗口拖拽**：点击宠物可以拖拽窗口

### 3. 动画系统

使用 `anime.js` 实现流畅动画：

- **眼睛跟随**：平滑跟踪鼠标位置
- **吃动画**：眼睛向下看 → 嘴巴张开 → 咀嚼5次 → 恢复
- **表情动画**：根据操作类型显示不同表情
- **等待动画**：大O形嘴巴轻微开合（呼吸感）

## 🔌 后端接口（Tauri Commands）

### 1. `process_drop_paths_command`
**功能**：处理拖放的文件路径

**参数**：
```typescript
{
  paths: string[]  // 文件路径数组
}
```

**返回**：
```typescript
{
  record: {
    id: number,
    path: string,
    hash: string,
    createdAt: number
  }
}
```

**说明**：
- 计算文件 SHA256 哈希值
- 将文件记录保存到 SQLite 数据库
- 返回文件记录信息

### 2. `save_mock_result`
**功能**：保存操作结果到数据库

**参数**：
```typescript
{
  recordId: number,
  kind: "summarize" | "actions" | "remember",
  content: string
}
```

**返回**：`void`

**说明**：
- 根据 `kind` 更新对应字段（summary/actions/memory）
- 使用数据库锁确保线程安全

### 3. `set_window_size`
**功能**：设置窗口大小

**参数**：
```typescript
{
  width: number,
  height: number
}
```

**返回**：`void`

**说明**：
- 保持窗口左上角位置不变
- 只改变窗口大小

### 4. `hide_for`
**功能**：隐藏窗口指定时间后自动显示

**参数**：
```typescript
{
  ms: number  // 隐藏时长（毫秒）
}
```

**返回**：`void`

**说明**：
- 隐藏窗口
- 指定时间后自动显示并获取焦点

## 📡 后端事件（Tauri Events）

### 1. `global-mouse-move`
**功能**：全局鼠标位置更新

**事件数据**：
```typescript
{
  x: number,        // 屏幕X坐标
  y: number,        // 屏幕Y坐标
  buttonPressed?: boolean  // 鼠标左键是否按下
}
```

**频率**：约 60fps（每 16ms）

**说明**：
- 仅在鼠标位置变化时发送
- 用于眼睛跟随动画

### 2. `global-mouse-button`
**功能**：鼠标按键状态变化

**事件数据**：
```typescript
{
  pressed: boolean  // 鼠标左键是否按下
}
```

**说明**：
- 仅在按键状态变化时发送
- 用于检测拖拽操作

### 3. `onDragDropEvent`
**功能**：Tauri 拖放事件

**事件类型**：
- `"hover"` / `"enter"` - 拖拽进入窗口
- `"leave"` / `"cancelled"` - 拖拽离开窗口
- `"drop"` - 文件放下

**事件数据**（drop 时）：
```typescript
{
  type: "drop",
  paths: string[]  // 文件路径数组
}
```

### 4. `onResized`
**功能**：窗口大小变化事件

**说明**：
- 自动触发，用于同步窗口尺寸状态

## 💾 数据库结构

### 表：`drop_records`

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | INTEGER PRIMARY KEY | 自增ID |
| `path` | TEXT | 文件路径 |
| `hash` | TEXT | SHA256 哈希值 |
| `created_at` | INTEGER | 创建时间戳（Unix秒） |
| `summary` | TEXT | 总结内容（可选） |
| `actions` | TEXT | 待办事项（可选） |
| `memory` | TEXT | 记忆内容（可选） |
| `tags` | TEXT | 标签（可选） |

**索引**：
- `idx_drop_records_hash` - 基于 `hash` 字段的索引

**数据库位置**：
- `{AppData}/papa_pet.sqlite`

## 🎯 核心特性总结

1. ✅ **全局鼠标跟踪** - 跨窗口眼睛跟随
2. ✅ **拖拽文件检测** - 自动进入等待状态
3. ✅ **文件处理流程** - 拖放 → 处理 → 显示结果
4. ✅ **动画系统** - 7种状态，流畅的表情动画
5. ✅ **窗口自适应** - 根据面板显示自动调整大小
6. ✅ **数据持久化** - SQLite 存储文件记录和处理结果
7. ✅ **静音模式** - 可禁用所有动画
8. ✅ **调试工具** - 状态切换和调试信息

## 📝 技术栈

- **前端**：React + TypeScript + anime.js
- **后端**：Rust + Tauri
- **数据库**：SQLite (rusqlite)
- **全局鼠标跟踪**：device_query crate
- **窗口管理**：Tauri Window API
