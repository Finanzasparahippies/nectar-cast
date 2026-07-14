#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_shell::init())
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }

      // Spawn the Node-Media-Server RTMP engine sidecar
      #[cfg(desktop)]
      {
        use tauri_plugin_shell::ShellExt;
        use tauri_plugin_shell::process::CommandEvent;

        let shell = app.shell();
        let (mut rx, _child) = shell
            .sidecar("nectar-cast-engine")
            .unwrap()
            .env("TAURI_TARGET_TRIPLE", "x86_64-unknown-linux-gnu")
            .spawn()
            .expect("Failed to spawn RTMP engine sidecar");

        tauri::async_runtime::spawn(async move {
            while let Some(event) = rx.recv().await {
                match event {
                    CommandEvent::Stdout(line) => {
                        let text = String::from_utf8_lossy(&line);
                        println!("[Engine Stdout] {}", text.trim());
                    }
                    CommandEvent::Stderr(line) => {
                        let text = String::from_utf8_lossy(&line);
                        eprintln!("[Engine Stderr] {}", text.trim());
                    }
                    CommandEvent::Terminated(status) => {
                        println!("[Engine] Process terminated with status {:?}", status);
                    }
                    _ => {}
                }
            }
        });
      }

      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
