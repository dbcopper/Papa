use chrono::{DateTime, Local, NaiveDate, TimeZone, Utc};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs::{self, File};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{Emitter, Manager};
use device_query::{DeviceQuery, DeviceState, Keycode};

fn generate_id() -> String {
  let now = SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .unwrap_or_default();
  let nanos = now.as_nanos();
  let random: u32 = rand::random();
  format!("{:x}{:08x}", nanos, random)
}

fn now_ms() -> i64 {
  SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .unwrap_or_default()
    .as_millis() as i64
}

fn get_mime_type(path: &Path) -> Option<String> {
  let ext = path.extension()?.to_str()?.to_lowercase();
  Some(match ext.as_str() {
    "jpg" | "jpeg" => "image/jpeg",
    "png" => "image/png",
    "gif" => "image/gif",
    "webp" => "image/webp",
    "svg" => "image/svg+xml",
    "bmp" => "image/bmp",
    "pdf" => "application/pdf",
    "txt" => "text/plain",
    "md" => "text/markdown",
    "json" => "application/json",
    "html" | "htm" => "text/html",
    "css" => "text/css",
    "js" => "application/javascript",
    "ts" => "application/typescript",
    "xml" => "application/xml",
    "zip" => "application/zip",
    "doc" => "application/msword",
    "docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "xls" => "application/vnd.ms-excel",
    "xlsx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "ppt" => "application/vnd.ms-powerpoint",
    "pptx" => "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    _ => "application/octet-stream",
  }.to_string())
}

fn is_image_type(mime: &Option<String>) -> bool {
  mime.as_ref().map(|m| m.starts_with("image/")).unwrap_or(false)
}

struct DbState {
  path: PathBuf,
  lock: Mutex<()>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct DropRecord {
  id: i64,
  path: String,
  hash: String,
  created_at: i64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct DropProcessedPayload {
  record: DropRecord,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct BehaviorAnalysis {
  typing_speed: f64,        // 打字速度 (keys per second)
  key_press_count: u32,     // 按键次数
  backspace_count: u32,     // 退格键次数
  mouse_move_speed: f64,     // 鼠标移动速度 (pixels per second)
  mouse_click_count: u32,   // 鼠标点击次数
  idle_time: f64,           // 空闲时间 (seconds)
  activity_level: f64,       // 活动水平 (0.0 - 1.0)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LlmRequest {
  provider: String,  // "openai" or "anthropic"
  api_key: String,
  model: String,
  prompt: String,
  max_tokens: Option<u32>,
}

// ============ Timeline Event Types ============

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct TimelineEvent {
  id: String,
  #[serde(rename = "type")]
  event_type: String,  // 'file' | 'image' | 'text' | 'thought'
  title: Option<String>,
  note: Option<String>,
  text_content: Option<String>,
  created_at: i64,
  source: Option<String>,  // 'drop' | 'manual' | 'clipboard'
  is_deleted: bool,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Attachment {
  id: String,
  event_id: String,
  kind: String,  // 'file' | 'image'
  original_path: String,
  stored_path: Option<String>,
  file_name: Option<String>,
  mime_type: Option<String>,
  size_bytes: Option<i64>,
  sha256: Option<String>,
  width: Option<i32>,
  height: Option<i32>,
  created_at: i64,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Reminder {
  id: String,
  event_id: String,
  remind_at: i64,
  message: String,
  status: String,  // 'pending' | 'triggered' | 'dismissed' | 'snoozed'
  triggered_at: Option<i64>,
  snooze_until: Option<i64>,
  created_at: i64,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct DailyExport {
  id: String,
  date_key: String,
  output_format: String,
  output_path: String,
  created_at: i64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct TimelineEventWithAttachments {
  event: TimelineEvent,
  attachments: Vec<Attachment>,
  reminders: Vec<Reminder>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateDropEventRequest {
  paths: Vec<String>,
  note: Option<String>,
  remind_at: Option<i64>,
  remind_message: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateTextEventRequest {
  note: String,
  text_content: Option<String>,
  remind_at: Option<i64>,
  remind_message: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveDroppedFileRequest {
  file_name: String,
  content: Vec<u8>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ListEventsRequest {
  start_date: Option<i64>,  // unix ms
  end_date: Option<i64>,    // unix ms
  page: Option<u32>,
  page_size: Option<u32>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ReminderDuePayload {
  reminder: Reminder,
  event: TimelineEvent,
  attachments: Vec<Attachment>,
}

fn init_db(db_path: &Path) -> Result<(), String> {
  if let Some(parent) = db_path.parent() {
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
  }

  let conn = rusqlite::Connection::open(db_path).map_err(|e| e.to_string())?;
  conn.execute_batch(
    "
    -- Legacy table (keep for migration compatibility)
    CREATE TABLE IF NOT EXISTS drop_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      path TEXT NOT NULL,
      hash TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      summary TEXT,
      actions TEXT,
      memory TEXT,
      tags TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_drop_records_hash ON drop_records(hash);

    -- New timeline-first schema
    CREATE TABLE IF NOT EXISTS timeline_events (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      title TEXT,
      note TEXT,
      text_content TEXT,
      created_at INTEGER NOT NULL,
      source TEXT,
      is_deleted INTEGER DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_timeline_created_at ON timeline_events(created_at);

    CREATE TABLE IF NOT EXISTS attachments (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      original_path TEXT NOT NULL,
      stored_path TEXT,
      file_name TEXT,
      mime_type TEXT,
      size_bytes INTEGER,
      sha256 TEXT,
      width INTEGER,
      height INTEGER,
      created_at INTEGER NOT NULL,
      FOREIGN KEY(event_id) REFERENCES timeline_events(id)
    );
    CREATE INDEX IF NOT EXISTS idx_attach_event ON attachments(event_id);

    CREATE TABLE IF NOT EXISTS reminders (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL,
      remind_at INTEGER NOT NULL,
      message TEXT NOT NULL,
      status TEXT NOT NULL,
      triggered_at INTEGER,
      snooze_until INTEGER,
      created_at INTEGER NOT NULL,
      FOREIGN KEY(event_id) REFERENCES timeline_events(id)
    );
    CREATE INDEX IF NOT EXISTS idx_remind_due ON reminders(status, remind_at);

    CREATE TABLE IF NOT EXISTS daily_exports (
      id TEXT PRIMARY KEY,
      date_key TEXT NOT NULL,
      output_format TEXT NOT NULL,
      output_path TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_export_date_format ON daily_exports(date_key, output_format);

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    ",
  )
  .map_err(|e| e.to_string())?;
  Ok(())
}

fn hash_file(path: &Path) -> Result<String, String> {
  let mut file = File::open(path).map_err(|e| e.to_string())?;
  let mut hasher = Sha256::new();
  let mut buffer = [0u8; 8192];

  loop {
    let read = file.read(&mut buffer).map_err(|e| e.to_string())?;
    if read == 0 {
      break;
    }
    hasher.update(&buffer[..read]);
  }

  let result = hasher.finalize();
  Ok(hex::encode(result))
}

fn insert_drop_record(db_path: &Path, path: &Path) -> Result<DropRecord, String> {
  let hash = hash_file(path)?;
  let created_at = std::time::SystemTime::now()
    .duration_since(std::time::UNIX_EPOCH)
    .map_err(|e| e.to_string())?
    .as_secs() as i64;

  let conn = rusqlite::Connection::open(db_path).map_err(|e| e.to_string())?;
  conn
    .execute(
      "INSERT INTO drop_records (path, hash, created_at) VALUES (?1, ?2, ?3)",
      (path.to_string_lossy().to_string(), hash.clone(), created_at),
    )
    .map_err(|e| e.to_string())?;

  let id = conn.last_insert_rowid();
  Ok(DropRecord {
    id,
    path: path.to_string_lossy().to_string(),
    hash,
    created_at,
  })
}

fn process_drop_paths(
  state: &DbState,
  paths: Vec<PathBuf>,
) -> Result<DropRecord, String> {
  if paths.is_empty() {
    return Err("empty drop".to_string());
  }
  let first_path = paths[0].clone();
  let guard = state.lock.lock().map_err(|_| "db lock".to_string())?;
  let result = insert_drop_record(&state.path, &first_path);
  drop(guard);
  result
}

#[tauri::command]
fn save_mock_result(
  state: tauri::State<DbState>,
  record_id: i64,
  kind: String,
  content: String,
) -> Result<(), String> {
  let _guard = state.lock.lock().map_err(|_| "db lock".to_string())?;
  let conn = rusqlite::Connection::open(&state.path).map_err(|e| e.to_string())?;

  let column = match kind.as_str() {
    "summarize" => "summary",
    "actions" => "actions",
    "remember" => "memory",
    _ => return Err("unknown kind".to_string()),
  };

  let query = format!("UPDATE drop_records SET {} = ?1 WHERE id = ?2", column);
  conn
    .execute(&query, (content, record_id))
    .map_err(|e| e.to_string())?;
  Ok(())
}

#[tauri::command]
fn process_drop_paths_command(
  state: tauri::State<DbState>,
  paths: Vec<String>,
) -> Result<DropProcessedPayload, String> {
  let paths: Vec<PathBuf> = paths.into_iter().map(PathBuf::from).collect();
  let record = process_drop_paths(&state, paths)?;
  Ok(DropProcessedPayload { record })
}

#[tauri::command]
fn hide_for(app_handle: tauri::AppHandle, ms: u64) -> Result<(), String> {
  let window = app_handle
    .get_webview_window("main")
    .ok_or_else(|| "missing window".to_string())?;
  window.hide().map_err(|e| e.to_string())?;
  let handle = app_handle.clone();
  tauri::async_runtime::spawn(async move {
    std::thread::sleep(Duration::from_millis(ms));
    if let Some(win) = handle.get_webview_window("main") {
      let _ = win.show();
      let _ = win.set_focus();
    }
  });
  Ok(())
}

#[tauri::command]
fn set_window_size(
  app_handle: tauri::AppHandle,
  width: f64,
  height: f64,
) -> Result<(), String> {
  let window = app_handle
    .get_webview_window("main")
    .ok_or_else(|| "missing window".to_string())?;
  
  // Get current position
  let current_position = window.outer_position().map_err(|e| e.to_string())?;
  
  // Keep left and top position fixed, only expand to the right
  // This keeps the pet in the same screen position
  let new_x = current_position.x;
  let new_y = current_position.y;
  
  let size = tauri::Size::Logical(tauri::LogicalSize { width, height });
  window.set_size(size).map_err(|e| e.to_string())?;
  
  // Keep position fixed (left-top anchor)
  window
    .set_position(tauri::Position::Physical(tauri::PhysicalPosition {
      x: new_x,
      y: new_y,
    }))
    .map_err(|e| e.to_string())?;
  
  Ok(())
}

#[tauri::command]
async fn call_llm_api(request: LlmRequest) -> Result<String, String> {
  let max_tokens = request.max_tokens.unwrap_or(150);
  
  if request.provider == "openai" {
    let client = reqwest::Client::new();
    let url = "https://api.openai.com/v1/chat/completions";
    
    let body = serde_json::json!({
      "model": request.model,
      "messages": [
        {
          "role": "user",
          "content": request.prompt
        }
      ],
      "max_tokens": max_tokens,
      "temperature": 0.7
    });
    
    let response = client
      .post(url)
      .header("Authorization", format!("Bearer {}", request.api_key))
      .header("Content-Type", "application/json")
      .json(&body)
      .send()
      .await
      .map_err(|e| format!("Request failed: {}", e))?;
    
    if response.status().is_success() {
      let json: serde_json::Value = response.json().await
        .map_err(|e| format!("Failed to parse response: {}", e))?;
      
      let content = json["choices"][0]["message"]["content"]
        .as_str()
        .ok_or_else(|| "No content in response".to_string())?;
      
      Ok(content.to_string())
    } else {
      let error_text = response.text().await.unwrap_or_else(|_| "Unknown error".to_string());
      Err(format!("API error: {}", error_text))
    }
  } else if request.provider == "anthropic" {
    let client = reqwest::Client::new();
    let url = "https://api.anthropic.com/v1/messages";
    
    let body = serde_json::json!({
      "model": request.model,
      "max_tokens": max_tokens,
      "messages": [
        {
          "role": "user",
          "content": request.prompt
        }
      ]
    });
    
    let response = client
      .post(url)
      .header("x-api-key", request.api_key)
      .header("anthropic-version", "2023-06-01")
      .header("Content-Type", "application/json")
      .json(&body)
      .send()
      .await
      .map_err(|e| format!("Request failed: {}", e))?;
    
    if response.status().is_success() {
      let json: serde_json::Value = response.json().await
        .map_err(|e| format!("Failed to parse response: {}", e))?;
      
      let content = json["content"][0]["text"]
        .as_str()
        .ok_or_else(|| "No content in response".to_string())?;
      
      Ok(content.to_string())
    } else {
      let error_text = response.text().await.unwrap_or_else(|_| "Unknown error".to_string());
      Err(format!("API error: {}", error_text))
    }
  } else {
    Err(format!("Unsupported provider: {}", request.provider))
  }
}

#[tauri::command]
async fn read_file_content(file_path: String) -> Result<String, String> {
  let path = PathBuf::from(&file_path);

  // Check if file exists
  if !path.exists() {
    return Err(format!("File not found: {}", file_path));
  }

  // Check file size (limit to 1MB to avoid memory issues)
  let metadata = fs::metadata(&path).map_err(|e| format!("Failed to read file metadata: {}", e))?;
  if metadata.len() > 1_000_000 {
    return Err("File too large (max 1MB)".to_string());
  }

  // Read file content
  let content = fs::read_to_string(&path)
    .map_err(|e| format!("Failed to read file: {}", e))?;

  Ok(content)
}

// ============ Timeline Event Commands ============

#[tauri::command]
fn save_dropped_file(
  app: tauri::AppHandle,
  request: SaveDroppedFileRequest,
) -> Result<String, String> {
  // Get app data directory
  let app_data = app.path().app_data_dir()
    .map_err(|e| format!("Failed to get app data dir: {}", e))?;

  // Create drops directory if it doesn't exist
  let drops_dir = app_data.join("drops");
  fs::create_dir_all(&drops_dir)
    .map_err(|e| format!("Failed to create drops dir: {}", e))?;

  // Generate unique filename to avoid collisions
  let timestamp = std::time::SystemTime::now()
    .duration_since(std::time::UNIX_EPOCH)
    .unwrap()
    .as_millis();
  let unique_name = format!("{}_{}", timestamp, request.file_name);
  let file_path = drops_dir.join(&unique_name);

  // Write file content
  fs::write(&file_path, &request.content)
    .map_err(|e| format!("Failed to write file: {}", e))?;

  // Return the full path as string
  file_path.to_str()
    .map(|s| s.to_string())
    .ok_or_else(|| "Invalid path".to_string())
}

#[tauri::command]
fn create_drop_event(
  state: tauri::State<DbState>,
  request: CreateDropEventRequest,
) -> Result<TimelineEventWithAttachments, String> {
  if request.paths.is_empty() {
    return Err("No files provided".to_string());
  }

  let _guard = state.lock.lock().map_err(|_| "db lock".to_string())?;
  let conn = rusqlite::Connection::open(&state.path).map_err(|e| e.to_string())?;

  let event_id = generate_id();
  let created_at = now_ms();

  // Determine event type based on first file
  let first_path = PathBuf::from(&request.paths[0]);
  let mime = get_mime_type(&first_path);
  let event_type = if is_image_type(&mime) { "image" } else { "file" };
  let title = first_path.file_name()
    .and_then(|n| n.to_str())
    .map(|s| s.to_string());

  // Insert event
  conn.execute(
    "INSERT INTO timeline_events (id, type, title, note, created_at, source, is_deleted)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0)",
    (
      &event_id,
      event_type,
      &title,
      &request.note,
      created_at,
      "drop",
    ),
  ).map_err(|e| e.to_string())?;

  // Insert attachments
  let mut attachments = Vec::new();
  for path_str in &request.paths {
    let path = PathBuf::from(path_str);
    let attach_id = generate_id();
    let file_name = path.file_name()
      .and_then(|n| n.to_str())
      .map(|s| s.to_string());
    let mime_type = get_mime_type(&path);
    let kind = if is_image_type(&mime_type) { "image" } else { "file" };
    let size_bytes = fs::metadata(&path).ok().map(|m| m.len() as i64);
    let sha256 = hash_file(&path).ok();

    conn.execute(
      "INSERT INTO attachments (id, event_id, kind, original_path, file_name, mime_type, size_bytes, sha256, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
      (
        &attach_id,
        &event_id,
        kind,
        path_str,
        &file_name,
        &mime_type,
        size_bytes,
        &sha256,
        created_at,
      ),
    ).map_err(|e| e.to_string())?;

    attachments.push(Attachment {
      id: attach_id,
      event_id: event_id.clone(),
      kind: kind.to_string(),
      original_path: path_str.clone(),
      stored_path: None,
      file_name,
      mime_type,
      size_bytes,
      sha256,
      width: None,
      height: None,
      created_at,
    });
  }

  // Insert reminder if requested
  let mut reminders = Vec::new();
  if let Some(remind_at) = request.remind_at {
    let reminder_id = generate_id();
    let message = request.remind_message
      .or(request.note.clone())
      .unwrap_or_else(|| title.clone().unwrap_or_else(|| "Reminder".to_string()));

    conn.execute(
      "INSERT INTO reminders (id, event_id, remind_at, message, status, created_at)
       VALUES (?1, ?2, ?3, ?4, 'pending', ?5)",
      (&reminder_id, &event_id, remind_at, &message, created_at),
    ).map_err(|e| e.to_string())?;

    reminders.push(Reminder {
      id: reminder_id,
      event_id: event_id.clone(),
      remind_at,
      message,
      status: "pending".to_string(),
      triggered_at: None,
      snooze_until: None,
      created_at,
    });
  }

  let event = TimelineEvent {
    id: event_id,
    event_type: event_type.to_string(),
    title,
    note: request.note,
    text_content: None,
    created_at,
    source: Some("drop".to_string()),
    is_deleted: false,
  };

  Ok(TimelineEventWithAttachments { event, attachments, reminders })
}

#[tauri::command]
fn create_text_event(
  state: tauri::State<DbState>,
  request: CreateTextEventRequest,
) -> Result<TimelineEventWithAttachments, String> {
  let _guard = state.lock.lock().map_err(|_| "db lock".to_string())?;
  let conn = rusqlite::Connection::open(&state.path).map_err(|e| e.to_string())?;

  let event_id = generate_id();
  let created_at = now_ms();
  let event_type = if request.text_content.is_some() { "text" } else { "thought" };

  conn.execute(
    "INSERT INTO timeline_events (id, type, note, text_content, created_at, source, is_deleted)
     VALUES (?1, ?2, ?3, ?4, ?5, 'manual', 0)",
    (
      &event_id,
      event_type,
      &request.note,
      &request.text_content,
      created_at,
    ),
  ).map_err(|e| e.to_string())?;

  // Insert reminder if requested
  let mut reminders = Vec::new();
  if let Some(remind_at) = request.remind_at {
    let reminder_id = generate_id();
    let message = request.remind_message
      .unwrap_or_else(|| request.note.clone());

    conn.execute(
      "INSERT INTO reminders (id, event_id, remind_at, message, status, created_at)
       VALUES (?1, ?2, ?3, ?4, 'pending', ?5)",
      (&reminder_id, &event_id, remind_at, &message, created_at),
    ).map_err(|e| e.to_string())?;

    reminders.push(Reminder {
      id: reminder_id,
      event_id: event_id.clone(),
      remind_at,
      message,
      status: "pending".to_string(),
      triggered_at: None,
      snooze_until: None,
      created_at,
    });
  }

  let event = TimelineEvent {
    id: event_id,
    event_type: event_type.to_string(),
    title: None,
    note: Some(request.note),
    text_content: request.text_content,
    created_at,
    source: Some("manual".to_string()),
    is_deleted: false,
  };

  Ok(TimelineEventWithAttachments { event, attachments: vec![], reminders })
}

#[tauri::command]
fn list_events(
  state: tauri::State<DbState>,
  request: ListEventsRequest,
) -> Result<Vec<TimelineEventWithAttachments>, String> {
  let _guard = state.lock.lock().map_err(|_| "db lock".to_string())?;
  let conn = rusqlite::Connection::open(&state.path).map_err(|e| e.to_string())?;

  let page = request.page.unwrap_or(0);
  let page_size = request.page_size.unwrap_or(50);
  let offset = page * page_size;

  let mut sql = String::from(
    "SELECT id, type, title, note, text_content, created_at, source, is_deleted
     FROM timeline_events WHERE is_deleted = 0"
  );
  let mut params: Vec<Box<dyn rusqlite::ToSql>> = vec![];

  if let Some(start) = request.start_date {
    sql.push_str(" AND created_at >= ?");
    params.push(Box::new(start));
  }
  if let Some(end) = request.end_date {
    sql.push_str(" AND created_at <= ?");
    params.push(Box::new(end));
  }

  sql.push_str(" ORDER BY created_at DESC LIMIT ? OFFSET ?");
  params.push(Box::new(page_size));
  params.push(Box::new(offset));

  let params_refs: Vec<&dyn rusqlite::ToSql> = params.iter().map(|p| p.as_ref()).collect();

  let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
  let events: Vec<TimelineEvent> = stmt
    .query_map(params_refs.as_slice(), |row| {
      Ok(TimelineEvent {
        id: row.get(0)?,
        event_type: row.get(1)?,
        title: row.get(2)?,
        note: row.get(3)?,
        text_content: row.get(4)?,
        created_at: row.get(5)?,
        source: row.get(6)?,
        is_deleted: row.get::<_, i32>(7)? != 0,
      })
    })
    .map_err(|e| e.to_string())?
    .filter_map(|r| r.ok())
    .collect();

  // Fetch attachments and reminders for each event
  let mut results = Vec::new();
  for event in events {
    let attachments: Vec<Attachment> = conn
      .prepare("SELECT id, event_id, kind, original_path, stored_path, file_name, mime_type, size_bytes, sha256, width, height, created_at FROM attachments WHERE event_id = ?")
      .map_err(|e| e.to_string())?
      .query_map([&event.id], |row| {
        Ok(Attachment {
          id: row.get(0)?,
          event_id: row.get(1)?,
          kind: row.get(2)?,
          original_path: row.get(3)?,
          stored_path: row.get(4)?,
          file_name: row.get(5)?,
          mime_type: row.get(6)?,
          size_bytes: row.get(7)?,
          sha256: row.get(8)?,
          width: row.get(9)?,
          height: row.get(10)?,
          created_at: row.get(11)?,
        })
      })
      .map_err(|e| e.to_string())?
      .filter_map(|r| r.ok())
      .collect();

    let reminders: Vec<Reminder> = conn
      .prepare("SELECT id, event_id, remind_at, message, status, triggered_at, snooze_until, created_at FROM reminders WHERE event_id = ?")
      .map_err(|e| e.to_string())?
      .query_map([&event.id], |row| {
        Ok(Reminder {
          id: row.get(0)?,
          event_id: row.get(1)?,
          remind_at: row.get(2)?,
          message: row.get(3)?,
          status: row.get(4)?,
          triggered_at: row.get(5)?,
          snooze_until: row.get(6)?,
          created_at: row.get(7)?,
        })
      })
      .map_err(|e| e.to_string())?
      .filter_map(|r| r.ok())
      .collect();

    results.push(TimelineEventWithAttachments { event, attachments, reminders });
  }

  Ok(results)
}

#[tauri::command]
fn get_event_detail(
  state: tauri::State<DbState>,
  event_id: String,
) -> Result<TimelineEventWithAttachments, String> {
  let _guard = state.lock.lock().map_err(|_| "db lock".to_string())?;
  let conn = rusqlite::Connection::open(&state.path).map_err(|e| e.to_string())?;

  let event: TimelineEvent = conn
    .query_row(
      "SELECT id, type, title, note, text_content, created_at, source, is_deleted
       FROM timeline_events WHERE id = ?",
      [&event_id],
      |row| {
        Ok(TimelineEvent {
          id: row.get(0)?,
          event_type: row.get(1)?,
          title: row.get(2)?,
          note: row.get(3)?,
          text_content: row.get(4)?,
          created_at: row.get(5)?,
          source: row.get(6)?,
          is_deleted: row.get::<_, i32>(7)? != 0,
        })
      },
    )
    .map_err(|_| "Event not found".to_string())?;

  let attachments: Vec<Attachment> = conn
    .prepare("SELECT id, event_id, kind, original_path, stored_path, file_name, mime_type, size_bytes, sha256, width, height, created_at FROM attachments WHERE event_id = ?")
    .map_err(|e| e.to_string())?
    .query_map([&event_id], |row| {
      Ok(Attachment {
        id: row.get(0)?,
        event_id: row.get(1)?,
        kind: row.get(2)?,
        original_path: row.get(3)?,
        stored_path: row.get(4)?,
        file_name: row.get(5)?,
        mime_type: row.get(6)?,
        size_bytes: row.get(7)?,
        sha256: row.get(8)?,
        width: row.get(9)?,
        height: row.get(10)?,
        created_at: row.get(11)?,
      })
    })
    .map_err(|e| e.to_string())?
    .filter_map(|r| r.ok())
    .collect();

  let reminders: Vec<Reminder> = conn
    .prepare("SELECT id, event_id, remind_at, message, status, triggered_at, snooze_until, created_at FROM reminders WHERE event_id = ?")
    .map_err(|e| e.to_string())?
    .query_map([&event_id], |row| {
      Ok(Reminder {
        id: row.get(0)?,
        event_id: row.get(1)?,
        remind_at: row.get(2)?,
        message: row.get(3)?,
        status: row.get(4)?,
        triggered_at: row.get(5)?,
        snooze_until: row.get(6)?,
        created_at: row.get(7)?,
      })
    })
    .map_err(|e| e.to_string())?
    .filter_map(|r| r.ok())
    .collect();

  Ok(TimelineEventWithAttachments { event, attachments, reminders })
}

#[tauri::command]
fn delete_event(
  state: tauri::State<DbState>,
  event_id: String,
) -> Result<(), String> {
  let _guard = state.lock.lock().map_err(|_| "db lock".to_string())?;
  let conn = rusqlite::Connection::open(&state.path).map_err(|e| e.to_string())?;

  conn.execute(
    "UPDATE timeline_events SET is_deleted = 1 WHERE id = ?",
    [&event_id],
  ).map_err(|e| e.to_string())?;

  Ok(())
}

#[tauri::command]
fn update_event_note(
  state: tauri::State<DbState>,
  event_id: String,
  note: String,
) -> Result<(), String> {
  let _guard = state.lock.lock().map_err(|_| "db lock".to_string())?;
  let conn = rusqlite::Connection::open(&state.path).map_err(|e| e.to_string())?;

  conn.execute(
    "UPDATE timeline_events SET note = ? WHERE id = ?",
    (&note, &event_id),
  ).map_err(|e| e.to_string())?;

  Ok(())
}

// ============ Reminder Commands ============

#[tauri::command]
fn create_reminder(
  state: tauri::State<DbState>,
  event_id: String,
  remind_at: i64,
  message: String,
) -> Result<Reminder, String> {
  let _guard = state.lock.lock().map_err(|_| "db lock".to_string())?;
  let conn = rusqlite::Connection::open(&state.path).map_err(|e| e.to_string())?;

  let reminder_id = generate_id();
  let created_at = now_ms();

  conn.execute(
    "INSERT INTO reminders (id, event_id, remind_at, message, status, created_at)
     VALUES (?1, ?2, ?3, ?4, 'pending', ?5)",
    (&reminder_id, &event_id, remind_at, &message, created_at),
  ).map_err(|e| e.to_string())?;

  Ok(Reminder {
    id: reminder_id,
    event_id,
    remind_at,
    message,
    status: "pending".to_string(),
    triggered_at: None,
    snooze_until: None,
    created_at,
  })
}

#[tauri::command]
fn snooze_reminder(
  state: tauri::State<DbState>,
  reminder_id: String,
  snooze_minutes: i64,
) -> Result<(), String> {
  let _guard = state.lock.lock().map_err(|_| "db lock".to_string())?;
  let conn = rusqlite::Connection::open(&state.path).map_err(|e| e.to_string())?;

  let snooze_until = now_ms() + snooze_minutes * 60 * 1000;

  conn.execute(
    "UPDATE reminders SET status = 'snoozed', snooze_until = ? WHERE id = ?",
    (snooze_until, &reminder_id),
  ).map_err(|e| e.to_string())?;

  Ok(())
}

#[tauri::command]
fn dismiss_reminder(
  state: tauri::State<DbState>,
  reminder_id: String,
) -> Result<(), String> {
  let _guard = state.lock.lock().map_err(|_| "db lock".to_string())?;
  let conn = rusqlite::Connection::open(&state.path).map_err(|e| e.to_string())?;

  let triggered_at = now_ms();

  conn.execute(
    "UPDATE reminders SET status = 'dismissed', triggered_at = ? WHERE id = ?",
    (triggered_at, &reminder_id),
  ).map_err(|e| e.to_string())?;

  Ok(())
}

#[tauri::command]
fn list_pending_reminders(
  state: tauri::State<DbState>,
) -> Result<Vec<Reminder>, String> {
  let _guard = state.lock.lock().map_err(|_| "db lock".to_string())?;
  let conn = rusqlite::Connection::open(&state.path).map_err(|e| e.to_string())?;

  let reminders: Vec<Reminder> = conn
    .prepare(
      "SELECT id, event_id, remind_at, message, status, triggered_at, snooze_until, created_at
       FROM reminders WHERE status = 'pending' OR status = 'snoozed' ORDER BY remind_at ASC"
    )
    .map_err(|e| e.to_string())?
    .query_map([], |row| {
      Ok(Reminder {
        id: row.get(0)?,
        event_id: row.get(1)?,
        remind_at: row.get(2)?,
        message: row.get(3)?,
        status: row.get(4)?,
        triggered_at: row.get(5)?,
        snooze_until: row.get(6)?,
        created_at: row.get(7)?,
      })
    })
    .map_err(|e| e.to_string())?
    .filter_map(|r| r.ok())
    .collect();

  Ok(reminders)
}

// ============ Settings Commands ============

#[tauri::command]
fn get_setting(
  state: tauri::State<DbState>,
  key: String,
) -> Result<Option<String>, String> {
  let _guard = state.lock.lock().map_err(|_| "db lock".to_string())?;
  let conn = rusqlite::Connection::open(&state.path).map_err(|e| e.to_string())?;

  let result = conn.query_row(
    "SELECT value FROM settings WHERE key = ?",
    [&key],
    |row| row.get(0),
  );

  match result {
    Ok(value) => Ok(Some(value)),
    Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
    Err(e) => Err(e.to_string()),
  }
}

#[tauri::command]
fn set_setting(
  state: tauri::State<DbState>,
  key: String,
  value: String,
) -> Result<(), String> {
  let _guard = state.lock.lock().map_err(|_| "db lock".to_string())?;
  let conn = rusqlite::Connection::open(&state.path).map_err(|e| e.to_string())?;

  conn.execute(
    "INSERT INTO settings (key, value) VALUES (?1, ?2)
     ON CONFLICT(key) DO UPDATE SET value = ?2",
    (&key, &value),
  ).map_err(|e| e.to_string())?;

  Ok(())
}

#[tauri::command]
fn list_settings(
  state: tauri::State<DbState>,
) -> Result<Vec<(String, String)>, String> {
  let _guard = state.lock.lock().map_err(|_| "db lock".to_string())?;
  let conn = rusqlite::Connection::open(&state.path).map_err(|e| e.to_string())?;

  let settings: Vec<(String, String)> = conn
    .prepare("SELECT key, value FROM settings")
    .map_err(|e| e.to_string())?
    .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
    .map_err(|e| e.to_string())?
    .filter_map(|r| r.ok())
    .collect();

  Ok(settings)
}

// ============ Export Commands (Phase 5) ============

#[tauri::command]
fn generate_daily_export(
  app_handle: tauri::AppHandle,
  state: tauri::State<DbState>,
  date_key: String,
  format: String,
) -> Result<String, String> {
  let _guard = state.lock.lock().map_err(|_| "db lock".to_string())?;
  let conn = rusqlite::Connection::open(&state.path).map_err(|e| e.to_string())?;

  // Parse date_key to get start and end timestamps (in local timezone)
  let naive_date = NaiveDate::parse_from_str(&date_key, "%Y-%m-%d")
    .map_err(|_| "Invalid date format".to_string())?;

  let start_of_day = Local
    .from_local_datetime(&naive_date.and_hms_opt(0, 0, 0).unwrap())
    .single()
    .ok_or_else(|| "Invalid local time".to_string())?
    .timestamp_millis();

  let end_of_day = Local
    .from_local_datetime(&naive_date.and_hms_opt(23, 59, 59).unwrap())
    .single()
    .ok_or_else(|| "Invalid local time".to_string())?
    .timestamp_millis() + 999;

  // Fetch events for the day
  let events: Vec<TimelineEvent> = conn
    .prepare(
      "SELECT id, type, title, note, text_content, created_at, source, is_deleted
       FROM timeline_events
       WHERE created_at >= ?1 AND created_at <= ?2 AND is_deleted = 0
       ORDER BY created_at ASC"
    )
    .map_err(|e| e.to_string())?
    .query_map([start_of_day, end_of_day], |row| {
      Ok(TimelineEvent {
        id: row.get(0)?,
        event_type: row.get(1)?,
        title: row.get(2)?,
        note: row.get(3)?,
        text_content: row.get(4)?,
        created_at: row.get(5)?,
        source: row.get(6)?,
        is_deleted: row.get::<_, i32>(7)? != 0,
      })
    })
    .map_err(|e| e.to_string())?
    .filter_map(|r| r.ok())
    .collect();

  // Generate Markdown content
  let mut content = format!("# Daily Record - {}\n\n", date_key);
  content.push_str(&format!("{} records\n\n---\n\n", events.len()));

  for event in &events {
    // Format time (in local timezone)
    let time = DateTime::<Utc>::from_timestamp_millis(event.created_at)
      .map(|dt| dt.with_timezone(&Local).format("%H:%M").to_string())
      .unwrap_or_else(|| "??:??".to_string());

    // Event type icon
    let icon = match event.event_type.as_str() {
      "image" => "🖼️",
      "text" => "📝",
      "thought" => "💭",
      _ => "📄",
    };

    content.push_str(&format!("## {} {} {}\n\n", time, icon, event.title.as_deref().unwrap_or("Untitled")));

    if let Some(note) = &event.note {
      if !note.is_empty() {
        content.push_str(&format!("{}\n\n", note));
      }
    }

    if let Some(text) = &event.text_content {
      if !text.is_empty() {
        content.push_str(&format!("```\n{}\n```\n\n", text));
      }
    }

    // Get attachments
    let attachments: Vec<Attachment> = conn
      .prepare("SELECT id, event_id, kind, original_path, stored_path, file_name, mime_type, size_bytes, sha256, width, height, created_at FROM attachments WHERE event_id = ?")
      .ok()
      .map(|mut stmt| {
        stmt.query_map([&event.id], |row| {
          Ok(Attachment {
            id: row.get(0)?,
            event_id: row.get(1)?,
            kind: row.get(2)?,
            original_path: row.get(3)?,
            stored_path: row.get(4)?,
            file_name: row.get(5)?,
            mime_type: row.get(6)?,
            size_bytes: row.get(7)?,
            sha256: row.get(8)?,
            width: row.get(9)?,
            height: row.get(10)?,
            created_at: row.get(11)?,
          })
        })
        .ok()
        .map(|iter| iter.filter_map(|r| r.ok()).collect())
        .unwrap_or_default()
      })
      .unwrap_or_default();

    if !attachments.is_empty() {
      content.push_str("**Attachments:**\n");
      for att in &attachments {
        let icon = if att.kind == "image" { "🖼️" } else { "📎" };
        content.push_str(&format!("- {} {}\n", icon, att.file_name.as_deref().unwrap_or("Unknown")));
      }
      content.push('\n');
    }

    content.push_str("---\n\n");
  }

  // Save to file
  let exports_dir = app_handle
    .path()
    .resolve("exports", tauri::path::BaseDirectory::AppData)
    .map_err(|e| e.to_string())?;

  fs::create_dir_all(&exports_dir).map_err(|e| e.to_string())?;

  let file_ext = if format == "html" { "html" } else { "md" };
  let file_name = format!("{}.{}", date_key, file_ext);
  let output_path = exports_dir.join(&file_name);

  // If HTML, wrap content
  let final_content = if format == "html" {
    format!(
      r#"<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Daily Record - {}</title>
  <style>
    body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; line-height: 1.6; }}
    h1 {{ color: #333; border-bottom: 2px solid #ffb347; padding-bottom: 10px; }}
    h2 {{ color: #555; margin-top: 30px; }}
    hr {{ border: none; border-top: 1px solid #eee; margin: 20px 0; }}
    pre {{ background: #f5f5f5; padding: 15px; border-radius: 5px; overflow-x: auto; }}
  </style>
</head>
<body>
{}
</body>
</html>"#,
      date_key,
      content.replace("\n", "<br>\n").replace("# ", "<h1>").replace("## ", "<h2>")
    )
  } else {
    content.clone()
  };

  fs::write(&output_path, &final_content).map_err(|e| e.to_string())?;

  // Save export record
  let export_id = generate_id();
  let created_at = now_ms();
  let output_path_str = output_path.to_string_lossy().to_string();

  conn.execute(
    "INSERT INTO daily_exports (id, date_key, output_format, output_path, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5)
     ON CONFLICT(date_key, output_format) DO UPDATE SET output_path = ?4, created_at = ?5",
    (&export_id, &date_key, &format, &output_path_str, created_at),
  ).map_err(|e| e.to_string())?;

  Ok(output_path_str)
}

#[tauri::command]
fn list_exports(
  state: tauri::State<DbState>,
) -> Result<Vec<DailyExport>, String> {
  let _guard = state.lock.lock().map_err(|_| "db lock".to_string())?;
  let conn = rusqlite::Connection::open(&state.path).map_err(|e| e.to_string())?;

  let exports: Vec<DailyExport> = conn
    .prepare("SELECT id, date_key, output_format, output_path, created_at FROM daily_exports ORDER BY date_key DESC")
    .map_err(|e| e.to_string())?
    .query_map([], |row| {
      Ok(DailyExport {
        id: row.get(0)?,
        date_key: row.get(1)?,
        output_format: row.get(2)?,
        output_path: row.get(3)?,
        created_at: row.get(4)?,
      })
    })
    .map_err(|e| e.to_string())?
    .filter_map(|r| r.ok())
    .collect();

  Ok(exports)
}

#[tauri::command]
fn open_export_folder(
  app_handle: tauri::AppHandle,
) -> Result<String, String> {
  let exports_dir = app_handle
    .path()
    .resolve("exports", tauri::path::BaseDirectory::AppData)
    .map_err(|e| e.to_string())?;

  fs::create_dir_all(&exports_dir).map_err(|e| e.to_string())?;

  // Open folder in file explorer
  #[cfg(target_os = "windows")]
  {
    std::process::Command::new("explorer")
      .arg(&exports_dir)
      .spawn()
      .map_err(|e| e.to_string())?;
  }
  #[cfg(target_os = "macos")]
  {
    std::process::Command::new("open")
      .arg(&exports_dir)
      .spawn()
      .map_err(|e| e.to_string())?;
  }
  #[cfg(target_os = "linux")]
  {
    std::process::Command::new("xdg-open")
      .arg(&exports_dir)
      .spawn()
      .map_err(|e| e.to_string())?;
  }

  Ok(exports_dir.to_string_lossy().to_string())
}

fn main() {
  tauri::Builder::default()
    .setup(|app| {
      let db_path = app
        .path()
        .resolve("papa_pet.sqlite", tauri::path::BaseDirectory::AppData)
        .map_err(|e| e.to_string())?;
      init_db(&db_path)?;

      let state = DbState {
        path: db_path,
        lock: Mutex::new(()),
      };
      app.manage(state);

      // Start global mouse tracking
      let app_handle_mouse = app.handle().clone();
      tauri::async_runtime::spawn(async move {
        let device_state = DeviceState::new();
        let mut last_x: Option<i32> = None;
        let mut last_y: Option<i32> = None;
        let mut last_button_pressed = false;
        
        loop {
          // Poll mouse position every ~16ms (60fps)
          tokio::time::sleep(Duration::from_millis(16)).await;
          
          let mouse = device_state.get_mouse();
          let x = mouse.coords.0;
          let y = mouse.coords.1;
          let button_pressed = mouse.button_pressed[0]; // Left button
          
          // Emit mouse position if changed
          if last_x != Some(x) || last_y != Some(y) {
            last_x = Some(x);
            last_y = Some(y);
            
            if let Some(window) = app_handle_mouse.get_webview_window("main") {
              let _ = window.emit("global-mouse-move", serde_json::json!({
                "x": x,
                "y": y,
                "buttonPressed": button_pressed
              }));
            }
          }
          
          // Emit button state change
          if last_button_pressed != button_pressed {
            last_button_pressed = button_pressed;
            if let Some(window) = app_handle_mouse.get_webview_window("main") {
              let _ = window.emit("global-mouse-button", serde_json::json!({
                "pressed": button_pressed
              }));
            }
          }
        }
      });

      // Start behavior analysis monitoring
      let app_handle_behavior = app.handle().clone();
      tauri::async_runtime::spawn(async move {
        let device_state = DeviceState::new();
        let mut last_keys: Vec<Keycode> = Vec::new();
        let mut last_mouse_pos: Option<(i32, i32)> = None;
        let mut last_mouse_click = false;
        
        let mut key_press_count = 0u32;
        let mut backspace_count = 0u32;
        let mut mouse_click_count = 0u32;
        let mut mouse_move_distance = 0.0f64;
        let mut last_analysis_time = Instant::now();
        let mut last_activity_time = Instant::now();
        
        loop {
          tokio::time::sleep(Duration::from_millis(100)).await; // Check every 100ms
          
          let mouse = device_state.get_mouse();
          let keys = device_state.get_keys();
          let current_time = Instant::now();
          
          // Track keyboard activity
          if keys.len() > last_keys.len() {
            key_press_count += 1;
            // Check for backspace
            if keys.contains(&Keycode::Backspace) && !last_keys.contains(&Keycode::Backspace) {
              backspace_count += 1;
            }
            last_activity_time = current_time;
          }
          last_keys = keys.clone();
          
          // Track mouse activity
          let current_pos = (mouse.coords.0, mouse.coords.1);
          if let Some(last_pos) = last_mouse_pos {
            let dx = (current_pos.0 - last_pos.0) as f64;
            let dy = (current_pos.1 - last_pos.1) as f64;
            let distance = (dx * dx + dy * dy).sqrt();
            mouse_move_distance += distance;
            if distance > 0.0 {
              last_activity_time = current_time;
            }
          }
          last_mouse_pos = Some(current_pos);
          
          if mouse.button_pressed[0] && !last_mouse_click {
            mouse_click_count += 1;
            last_activity_time = current_time;
          }
          last_mouse_click = mouse.button_pressed[0];
          
          // Emit behavior analysis every 2 seconds
          let elapsed = current_time.duration_since(last_analysis_time);
          if elapsed.as_secs() >= 2 {
            let time_window = elapsed.as_secs_f64();
            let idle_time = current_time.duration_since(last_activity_time).as_secs_f64();
            
            let typing_speed = if time_window > 0.0 {
              key_press_count as f64 / time_window
            } else {
              0.0
            };
            
            let mouse_move_speed = if time_window > 0.0 {
              mouse_move_distance / time_window
            } else {
              0.0
            };
            
            // Calculate activity level (0.0 - 1.0)
            let activity_level = (typing_speed * 0.3 + (mouse_move_speed / 1000.0).min(1.0) * 0.3 + 
                                 (mouse_click_count as f64 / time_window).min(5.0) / 5.0 * 0.4).min(1.0);
            
            let analysis = BehaviorAnalysis {
              typing_speed,
              key_press_count,
              backspace_count,
              mouse_move_speed,
              mouse_click_count,
              idle_time,
              activity_level,
            };
            
            if let Some(window) = app_handle_behavior.get_webview_window("main") {
              let _ = window.emit("behavior-analysis", &analysis);
            }
            
            // Reset counters
            key_press_count = 0;
            backspace_count = 0;
            mouse_click_count = 0;
            mouse_move_distance = 0.0;
            last_analysis_time = current_time;
          }
        }
      });

      // Start reminder scanner (every 30 seconds)
      let app_handle_reminder = app.handle().clone();
      let db_path_reminder = app
        .path()
        .resolve("papa_pet.sqlite", tauri::path::BaseDirectory::AppData)
        .map_err(|e| e.to_string())?;
      tauri::async_runtime::spawn(async move {
        loop {
          tokio::time::sleep(Duration::from_secs(30)).await;

          let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as i64;

          // Check for due reminders
          if let Ok(conn) = rusqlite::Connection::open(&db_path_reminder) {
            // Find pending reminders that are due
            let due_reminders: Vec<Reminder> = conn
              .prepare(
                "SELECT id, event_id, remind_at, message, status, triggered_at, snooze_until, created_at
                 FROM reminders
                 WHERE (status = 'pending' AND remind_at <= ?1)
                    OR (status = 'snoozed' AND snooze_until <= ?1)
                 ORDER BY remind_at ASC"
              )
              .ok()
              .map(|mut stmt| {
                stmt.query_map([now], |row| {
                  Ok(Reminder {
                    id: row.get(0)?,
                    event_id: row.get(1)?,
                    remind_at: row.get(2)?,
                    message: row.get(3)?,
                    status: row.get(4)?,
                    triggered_at: row.get(5)?,
                    snooze_until: row.get(6)?,
                    created_at: row.get(7)?,
                  })
                })
                .ok()
                .map(|iter| iter.filter_map(|r| r.ok()).collect())
                .unwrap_or_default()
              })
              .unwrap_or_default();

            for reminder in due_reminders {
              // Get event details
              let event: Option<TimelineEvent> = conn
                .query_row(
                  "SELECT id, type, title, note, text_content, created_at, source, is_deleted
                   FROM timeline_events WHERE id = ?",
                  [&reminder.event_id],
                  |row| {
                    Ok(TimelineEvent {
                      id: row.get(0)?,
                      event_type: row.get(1)?,
                      title: row.get(2)?,
                      note: row.get(3)?,
                      text_content: row.get(4)?,
                      created_at: row.get(5)?,
                      source: row.get(6)?,
                      is_deleted: row.get::<_, i32>(7)? != 0,
                    })
                  },
                )
                .ok();

              if let Some(event) = event {
                // Get attachments
                let attachments: Vec<Attachment> = conn
                  .prepare("SELECT id, event_id, kind, original_path, stored_path, file_name, mime_type, size_bytes, sha256, width, height, created_at FROM attachments WHERE event_id = ?")
                  .ok()
                  .map(|mut stmt| {
                    stmt.query_map([&reminder.event_id], |row| {
                      Ok(Attachment {
                        id: row.get(0)?,
                        event_id: row.get(1)?,
                        kind: row.get(2)?,
                        original_path: row.get(3)?,
                        stored_path: row.get(4)?,
                        file_name: row.get(5)?,
                        mime_type: row.get(6)?,
                        size_bytes: row.get(7)?,
                        sha256: row.get(8)?,
                        width: row.get(9)?,
                        height: row.get(10)?,
                        created_at: row.get(11)?,
                      })
                    })
                    .ok()
                    .map(|iter| iter.filter_map(|r| r.ok()).collect())
                    .unwrap_or_default()
                  })
                  .unwrap_or_default();

                // Mark as triggered
                let _ = conn.execute(
                  "UPDATE reminders SET status = 'triggered', triggered_at = ? WHERE id = ?",
                  (now, &reminder.id),
                );

                // Emit reminder-due event
                let payload = ReminderDuePayload {
                  reminder: reminder.clone(),
                  event,
                  attachments,
                };

                if let Some(window) = app_handle_reminder.get_webview_window("main") {
                  let _ = window.emit("reminder-due", &payload);
                }
              }
            }
          }
        }
      });

      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      save_mock_result,
      hide_for,
      set_window_size,
      process_drop_paths_command,
      call_llm_api,
      read_file_content,
      // Timeline event commands
      save_dropped_file,
      create_drop_event,
      create_text_event,
      list_events,
      get_event_detail,
      delete_event,
      update_event_note,
      // Reminder commands
      create_reminder,
      snooze_reminder,
      dismiss_reminder,
      list_pending_reminders,
      // Settings commands
      get_setting,
      set_setting,
      list_settings,
      // Export commands
      generate_daily_export,
      list_exports,
      open_export_folder
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
