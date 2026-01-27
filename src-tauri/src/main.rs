use serde::Serialize;
use sha2::{Digest, Sha256};
use std::fs::{self, File};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{DragDropEvent, Emitter, Manager, WindowEvent};
use device_query::{DeviceQuery, DeviceState};

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
      let app_handle = app.handle().clone();
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
            
            if let Some(window) = app_handle.get_webview_window("main") {
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
            if let Some(window) = app_handle.get_webview_window("main") {
              let _ = window.emit("global-mouse-button", serde_json::json!({
                "pressed": button_pressed
              }));
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
      process_drop_paths_command
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
