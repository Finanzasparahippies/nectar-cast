// Biblioteca principal del backend de Tauri en Rust.
// Se encarga de la orquestación del ciclo de vida de la aplicación, el escaneo de puertos 
// y la inicialización de los binarios secundarios (sidecars).

use std::net::TcpListener;

// Estructura que almacena los puertos asignados dinámicamente.
// Se serializa con nombres de propiedades en formato camelCase para que el frontend de TypeScript los lea directamente.
#[derive(Clone, serde::Serialize)]
struct EnginePorts {
    #[serde(rename = "rtmpPort")]
    rtmp_port: u16,
    #[serde(rename = "httpPort")]
    http_port: u16,
}

// Comando de Tauri expuesto al frontend.
// Retorna una copia de los puertos activos que fueron reservados por el backend en el arranque.
#[tauri::command]
fn get_engine_ports(state: tauri::State<'_, EnginePorts>) -> EnginePorts {
    state.inner().clone()
}

// Escanea de forma secuencial a partir de un puerto inicial en búsqueda del primer puerto libre
// en el que se pueda enlazar un socket TCP local. De esta forma evitamos colisiones de red.
fn find_free_port(start_port: u16) -> u16 {
    let mut port = start_port;
    loop {
        // Intenta enlazar a la dirección local en el puerto actual. Si tiene éxito, está libre.
        if TcpListener::bind(("127.0.0.1", port)).is_ok() {
            return port;
        }
        port += 1;
        // Límite de puertos TCP de 16 bits para evitar bucles infinitos en redes extremadamente bloqueadas.
        if port == 65535 {
            break;
        }
    }
    start_port
}

// Punto de entrada de inicialización de la librería de Tauri
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  // Escaneo dinámico de puertos al inicio del programa
  let rtmp_port = find_free_port(1935); // Puerto por defecto para la recepción RTMP (OBS)
  let http_port = find_free_port(8001); // Puerto por defecto para la API HTTP del motor de retransmisión
  let ports = EnginePorts { rtmp_port, http_port };

  tauri::Builder::default()
    // Habilita el plugin shell para poder interactuar con procesos y sidecars
    .plugin(tauri_plugin_shell::init())
    // Registra el estado de los puertos para poder inyectarlo en los controladores de comandos
    .manage(ports.clone())
    // Registra el controlador de comandos expuestos al frontend de React
    .invoke_handler(tauri::generate_handler![get_engine_ports])
    .setup(move |app| {
      // Configuración de logs opcionales durante la depuración en modo desarrollo
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }

      // Orquestación del motor secundario en sistemas de escritorio (sidecar)
      #[cfg(desktop)]
      {
        use tauri_plugin_shell::ShellExt;
        use tauri_plugin_shell::process::CommandEvent;

        let shell = app.shell();
        
        // Inicializa el sidecar del motor de Node-Media-Server empaquetado en formato pkg.
        // Inyecta el target-triple y los puertos de red resueltos como variables de entorno
        // para que el subproceso los detecte automáticamente al arrancar.
        let (mut rx, _child) = shell
            .sidecar("nectar-cast-engine")
            .unwrap()
            .env("RTMP_PORT", rtmp_port.to_string())
            .env("HTTP_PORT", http_port.to_string())
            .spawn()
            .expect("Failed to spawn RTMP engine sidecar");

        println!("[Rust Core] Spawning engine sidecar with RTMP_PORT={} HTTP_PORT={}", rtmp_port, http_port);

        // Hilo asíncrono secundario para escuchar y redirigir la salida estándar del motor Node hacia la terminal principal.
        tauri::async_runtime::spawn(async move {
            while let Some(event) = rx.recv().await {
                match event {
                    // Muestra los logs emitidos por la consola del motor en formato limpio
                    CommandEvent::Stdout(line) => {
                        let text = String::from_utf8_lossy(&line);
                        println!("[Engine Stdout] {}", text.trim());
                    }
                    // Muestra los errores del motor en la salida de error
                    CommandEvent::Stderr(line) => {
                        let text = String::from_utf8_lossy(&line);
                        eprintln!("[Engine Stderr] {}", text.trim());
                    }
                    // Evento disparado cuando el subproceso secundario termina
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
