use std::path::PathBuf;
use std::process::Stdio;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

/// Locate the Mole CLI binary on the system.
pub fn find_mole_path() -> Option<PathBuf> {
    // 1. Check if running from within the repo (gui/ -> ../mole)
    if let Ok(exe) = std::env::current_exe() {
        let repo_root = exe
            .parent()
            .and_then(|p| p.parent())
            .and_then(|p| p.parent())
            .and_then(|p| p.parent())
            .map(|p| p.join("mole"));
        if let Some(path) = repo_root {
            if path.exists() {
                return Some(path);
            }
        }
    }

    // 2. Check common install paths
    let candidates = [
        "/opt/homebrew/bin/mole",
        "/usr/local/bin/mole",
        "/usr/bin/mole",
    ];
    for candidate in candidates {
        let path = PathBuf::from(candidate);
        if path.exists() {
            return Some(path);
        }
    }

    // 3. Check ~/.local/bin
    if let Ok(home) = std::env::var("HOME") {
        let local_bin = PathBuf::from(format!("{}/.local/bin/mole", home));
        if local_bin.exists() {
            return Some(local_bin);
        }
    }

    // 4. Check PATH via `which`
    if let Ok(output) = std::process::Command::new("which")
        .arg("mole")
        .output()
    {
        if output.status.success() {
            let path_str = String::from_utf8_lossy(&output.stdout);
            let path = PathBuf::from(path_str.trim());
            if path.exists() {
                return Some(path);
            }
        }
    }

    None
}

/// Execute a Mole CLI command and stream NDJSON output line-by-line.
/// Calls `on_line` for each stdout line. Returns the exit status.
pub async fn run_mole_streaming<F>(
    args: &[&str],
    mut on_line: F,
) -> Result<i32, String>
where
    F: FnMut(String) + Send + 'static,
{
    let mole_path = find_mole_path().ok_or_else(|| {
        "Mole CLI not found. Please install it first.".to_string()
    })?;

    let mut child = Command::new(&mole_path)
        .args(args)
        .env("LC_ALL", "C")
        .env("NO_COLOR", "1")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to start Mole: {}", e))?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Failed to capture stdout".to_string())?;

    let reader = BufReader::new(stdout);
    let mut lines = reader.lines();

    while let Ok(Some(line)) = lines.next_line().await {
        on_line(line);
    }

    let status = child
        .wait()
        .await
        .map_err(|e| format!("Failed to wait for Mole: {}", e))?;

    Ok(status.code().unwrap_or(-1))
}

/// Execute a Mole CLI command and return stdout as a string.
pub async fn run_mole_capture(args: &[&str]) -> Result<String, String> {
    let mole_path = find_mole_path().ok_or_else(|| {
        "Mole CLI not found. Please install it first.".to_string()
    })?;

    let output = Command::new(&mole_path)
        .args(args)
        .env("LC_ALL", "C")
        .env("NO_COLOR", "1")
        .output()
        .await
        .map_err(|e| format!("Failed to run Mole: {}", e))?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        Err(if stderr.is_empty() {
            format!("Mole exited with code {}", output.status.code().unwrap_or(-1))
        } else {
            stderr
        })
    }
}

/// Get the Mole CLI version string.
pub async fn get_mole_version() -> Result<String, String> {
    let output = run_mole_capture(&["--version"]).await?;
    Ok(output.trim().to_string())
}
