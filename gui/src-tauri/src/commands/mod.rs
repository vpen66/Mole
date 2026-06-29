use serde::{Deserialize, Serialize};
use tauri::{Emitter, Window};
use crate::mole::process;

#[derive(Serialize, Deserialize, Clone)]
pub struct MoleEvent {
    #[serde(rename = "type")]
    pub event_type: String,
    #[serde(flatten)]
    pub data: serde_json::Value,
}

#[derive(Serialize)]
pub struct MoleVersionInfo {
    pub version: String,
    pub installed: bool,
    pub path: String,
}

#[derive(Serialize)]
pub struct CleanResult {
    pub success: bool,
    pub lines: Vec<String>,
}

/// Parse an NDJSON line and emit a Tauri event to the frontend.
fn emit_mole_event(window: &Window, event_name: &str, line: &str) {
    if let Ok(json) = serde_json::from_str::<serde_json::Value>(line) {
        let event = MoleEvent {
            event_type: json
                .get("type")
                .and_then(|v| v.as_str())
                .unwrap_or("unknown")
                .to_string(),
            data: json,
        };
        let _ = window.emit(event_name, &event);
    }
}

#[tauri::command]
pub async fn get_mole_version() -> Result<MoleVersionInfo, String> {
    match process::get_mole_version().await {
        Ok(version) => {
            let path = process::find_mole_path()
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_default();
            Ok(MoleVersionInfo {
                version,
                installed: true,
                path,
            })
        }
        Err(_) => Ok(MoleVersionInfo {
            version: String::new(),
            installed: false,
            path: String::new(),
        }),
    }
}

#[tauri::command]
pub async fn get_free_space_kb() -> Result<u64, String> {
    let output = process::run_mole_capture(&["status", "--json"]).await?;
    if let Ok(json) = serde_json::from_str::<serde_json::Value>(&output) {
        if let Some(disks) = json.get("disks").and_then(|d| d.as_array()) {
            if let Some(first) = disks.first() {
                if let Some(free) = first.get("free").and_then(|f| f.as_u64()) {
                    return Ok(free / 1024);
                }
            }
        }
    }
    // Fallback: use df
    let output = tokio::process::Command::new("df")
        .args(["-k", "/"])
        .output()
        .await
        .map_err(|e| format!("Failed to run df: {}", e))?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    for line in stdout.lines().skip(1) {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() >= 4 {
            if let Ok(kb) = parts[3].parse::<u64>() {
                return Ok(kb);
            }
        }
    }
    Err("Could not determine free space".to_string())
}

#[tauri::command]
pub async fn clean_dry_run(window: Window) -> Result<CleanResult, String> {
    let (tx, rx) = std::sync::mpsc::channel();
    let window_clone = window.clone();

    tokio::spawn(async move {
        let lines = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
        let lines_clone = lines.clone();

        let code = process::run_mole_streaming(
            &["clean", "--dry-run", "--json"],
            move |line| {
                emit_mole_event(&window_clone, "mole-clean_dry_run-event", &line);
                lines_clone.lock().unwrap().push(line);
            },
        )
        .await;

        let collected = lines.lock().unwrap().clone();
        let _ = tx.send((code.unwrap_or(-1), collected));
    });

    let (code, lines) = rx
        .recv()
        .map_err(|e| format!("Channel error: {}", e))?;

    Ok(CleanResult {
        success: code == 0,
        lines,
    })
}

#[tauri::command]
pub async fn clean_execute(window: Window) -> Result<CleanResult, String> {
    let (tx, rx) = std::sync::mpsc::channel();
    let window_clone = window.clone();

    tokio::spawn(async move {
        let lines = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
        let lines_clone = lines.clone();

        let code = process::run_mole_streaming(
            &["clean", "--json"],
            move |line| {
                emit_mole_event(&window_clone, "mole-clean_execute-event", &line);
                lines_clone.lock().unwrap().push(line);
            },
        )
        .await;

        let collected = lines.lock().unwrap().clone();
        let _ = tx.send((code.unwrap_or(-1), collected));
    });

    let (code, lines) = rx
        .recv()
        .map_err(|e| format!("Channel error: {}", e))?;

    Ok(CleanResult {
        success: code == 0,
        lines,
    })
}

#[tauri::command]
pub async fn uninstall_scan_apps(window: Window) -> Result<String, String> {
    let (tx, rx) = std::sync::mpsc::channel();
    let window_clone = window.clone();

    tokio::spawn(async move {
        let output = std::sync::Arc::new(std::sync::Mutex::new(String::new()));
        let output_clone = output.clone();

        let _code = process::run_mole_streaming(
            &["uninstall", "--json"],
            move |line| {
                emit_mole_event(
                    &window_clone,
                    "mole-uninstall_scan_apps-event",
                    &line,
                );
                output_clone.lock().unwrap().push_str(&line);
                output_clone.lock().unwrap().push('\n');
            },
        )
        .await;

        let collected = output.lock().unwrap().clone();
        let _ = tx.send(collected);
    });

    let output = rx
        .recv()
        .map_err(|e| format!("Channel error: {}", e))?;

    Ok(output)
}

#[tauri::command]
pub async fn uninstall_execute(
    window: Window,
    targets: Vec<String>,
) -> Result<CleanResult, String> {
    let targets_str = targets.join("|");
    let (tx, rx) = std::sync::mpsc::channel();
    let window_clone = window.clone();

    tokio::spawn(async move {
        let lines = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
        let lines_clone = lines.clone();

        let code = process::run_mole_streaming(
            &[
                "uninstall",
                "--json",
                "--targets",
                &targets_str,
            ],
            move |line| {
                emit_mole_event(
                    &window_clone,
                    "mole-uninstall_execute-event",
                    &line,
                );
                lines_clone.lock().unwrap().push(line);
            },
        )
        .await;

        let collected = lines.lock().unwrap().clone();
        let _ = tx.send((code.unwrap_or(-1), collected));
    });

    let (code, lines) = rx
        .recv()
        .map_err(|e| format!("Channel error: {}", e))?;

    Ok(CleanResult {
        success: code == 0,
        lines,
    })
}

#[tauri::command]
pub async fn purge_dry_run(window: Window) -> Result<String, String> {
    let (tx, rx) = std::sync::mpsc::channel();
    let window_clone = window.clone();

    tokio::spawn(async move {
        let output = std::sync::Arc::new(std::sync::Mutex::new(String::new()));
        let output_clone = output.clone();

        let _code = process::run_mole_streaming(
            &["purge", "--dry-run", "--json"],
            move |line| {
                emit_mole_event(&window_clone, "mole-purge_dry_run-event", &line);
                output_clone.lock().unwrap().push_str(&line);
                output_clone.lock().unwrap().push('\n');
            },
        )
        .await;

        let collected = output.lock().unwrap().clone();
        let _ = tx.send(collected);
    });

    rx.recv().map_err(|e| format!("Channel error: {}", e))
}

#[tauri::command]
pub async fn purge_execute(
    window: Window,
    targets: Vec<String>,
) -> Result<CleanResult, String> {
    let targets_str = targets.join("|");
    let (tx, rx) = std::sync::mpsc::channel();
    let window_clone = window.clone();

    tokio::spawn(async move {
        let lines = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
        let lines_clone = lines.clone();

        let code = process::run_mole_streaming(
            &["purge", "--json", "--targets", &targets_str],
            move |line| {
                emit_mole_event(&window_clone, "mole-purge_execute-event", &line);
                lines_clone.lock().unwrap().push(line);
            },
        )
        .await;

        let collected = lines.lock().unwrap().clone();
        let _ = tx.send((code.unwrap_or(-1), collected));
    });

    let (code, lines) = rx
        .recv()
        .map_err(|e| format!("Channel error: {}", e))?;

    Ok(CleanResult {
        success: code == 0,
        lines,
    })
}

#[tauri::command]
pub async fn optimize_dry_run(window: Window) -> Result<String, String> {
    let (tx, rx) = std::sync::mpsc::channel();
    let window_clone = window.clone();

    tokio::spawn(async move {
        let output = std::sync::Arc::new(std::sync::Mutex::new(String::new()));
        let output_clone = output.clone();

        let _code = process::run_mole_streaming(
            &["optimize", "--dry-run", "--json"],
            move |line| {
                emit_mole_event(
                    &window_clone,
                    "mole-optimize_dry_run-event",
                    &line,
                );
                output_clone.lock().unwrap().push_str(&line);
                output_clone.lock().unwrap().push('\n');
            },
        )
        .await;

        let collected = output.lock().unwrap().clone();
        let _ = tx.send(collected);
    });

    rx.recv().map_err(|e| format!("Channel error: {}", e))
}

#[tauri::command]
pub async fn optimize_execute(
    window: Window,
    actions: Vec<String>,
) -> Result<CleanResult, String> {
    let actions_str = actions.join(",");
    let (tx, rx) = std::sync::mpsc::channel();
    let window_clone = window.clone();

    tokio::spawn(async move {
        let lines = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
        let lines_clone = lines.clone();

        let code = process::run_mole_streaming(
            &["optimize", "--json", "--actions", &actions_str],
            move |line| {
                emit_mole_event(
                    &window_clone,
                    "mole-optimize_execute-event",
                    &line,
                );
                lines_clone.lock().unwrap().push(line);
            },
        )
        .await;

        let collected = lines.lock().unwrap().clone();
        let _ = tx.send((code.unwrap_or(-1), collected));
    });

    let (code, lines) = rx
        .recv()
        .map_err(|e| format!("Channel error: {}", e))?;

    Ok(CleanResult {
        success: code == 0,
        lines,
    })
}

#[tauri::command]
pub async fn get_history(limit: Option<u32>) -> Result<String, String> {
    let limit_str = limit.unwrap_or(50).to_string();
    process::run_mole_capture(&["history", "--json", "--limit", &limit_str]).await
}
