mod commands;
mod mole;

use commands::*;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            get_mole_version,
            get_free_space_kb,
            clean_dry_run,
            clean_execute,
            uninstall_scan_apps,
            uninstall_execute,
            purge_dry_run,
            purge_execute,
            optimize_dry_run,
            optimize_execute,
            get_history,
        ])
        .setup(|app| {
            let _window = tauri::WebviewWindowBuilder::new(
                app,
                "main",
                tauri::WebviewUrl::App("index.html".into()),
            )
            .title("Mole")
            .inner_size(1100.0, 750.0)
            .min_inner_size(800.0, 600.0)
            .resizable(true)
            .center()
            .decorations(true)
            .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
