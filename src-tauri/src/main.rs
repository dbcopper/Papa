use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs::{self, File};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{DragDropEvent, Emitter, Manager, WindowEvent};
use device_query::{DeviceQuery, DeviceState, Keycode};

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

fn init_db(db_path: &Path) -> Result<(), String> {
  if let Some(parent) = db_path.parent() {
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
  }

  let conn = rusqlite::Connection::open(db_path).map_err(|e| e.to_string())?;
  conn.execute_batch(
    "
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

fn dispatch_js_event(window: &tauri::WebviewWindow, event: &str) {
  let script = format!(
    "window.dispatchEvent(new Event({:?}));",
    event
  );
  let _ = window.eval(&script);
}

fn dispatch_js_event_with_payload<T: Serialize>(
  window: &tauri::WebviewWindow,
  event: &str,
  payload: &T,
) {
  if let Ok(json) = serde_json::to_string(payload) {
    let script = format!(
      "window.dispatchEvent(new CustomEvent({:?}, {{ detail: {} }}));",
      event, json
    );
    let _ = window.eval(&script);
  }
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
  
  // Get current position and size
  let current_position = window.outer_position().map_err(|e| e.to_string())?;
  let current_size = window.outer_size().map_err(|e| e.to_string())?;
  
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

      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      save_mock_result,
      hide_for,
      set_window_size,
      process_drop_paths_command,
      call_llm_api,
      read_file_content
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
