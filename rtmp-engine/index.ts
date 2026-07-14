// Motor de Streaming RTMP e Ingesta de Video de Néctar Cast.
// Desarrollado sobre Node-Media-Server (NMS) y orquestado mediante subprocesos locales de FFmpeg.
// Expone un servidor HTTP de control (API local) para gestionar la retransmisión dinámica.

import NodeMediaServer from 'node-media-server';
import http from 'http';
import path from 'path';
import fs from 'fs';
import { spawn, ChildProcess } from 'child_process';

// Límite de líneas almacenadas en memoria para el visor de logs del frontend
const LOG_LIMIT = 200;
const logsRingBuffer: string[] = [];

// Registra logs tanto en la salida de consola estándar como en el búfer circular en memoria (ring buffer)
// que es consultado periódicamente por el frontend a través de HTTP.
function addLog(msg: string) {
  const time = new Date().toLocaleTimeString();
  const formatted = `[${time}] ${msg}`;
  console.log(formatted);
  logsRingBuffer.push(formatted);
  // Si superamos el límite, descartamos el log más antiguo
  if (logsRingBuffer.length > LOG_LIMIT) {
    logsRingBuffer.shift();
  }
}

// Interfaz para representar un destino de retransmisión configurado
interface Relay {
  id: string;
  name: string;
  targetUrl: string;
  status: 'idle' | 'streaming' | 'error';
}

// Interfaz para mantener la referencia a un subproceso FFmpeg activo
interface ActiveProcess {
  id: string;
  process: ChildProcess;
}

let relays: Relay[] = [];
let activeProcesses: ActiveProcess[] = [];
let isStreamActive = false; // Indica si OBS está transmitiendo activamente a esta app
const startTime = Date.now();

// Resuelve si el código está empaquetado (pkg) o ejecutándose de forma directa en desarrollo
const isPackaged = typeof (process as any).pkg !== 'undefined';
const baseDir = isPackaged ? path.dirname(process.execPath) : process.cwd();
// Ruta de almacenamiento local de las configuraciones de destinos de retransmisión
const relaysConfigFile = path.join(baseDir, 'relays-config.json');

// Lee y decodifica las variables de entorno de red inyectadas por el backend de Rust (Tauri)
const rtmpPort = process.env.RTMP_PORT ? parseInt(process.env.RTMP_PORT) : 1935;
const httpApiPort = process.env.HTTP_PORT ? parseInt(process.env.HTTP_PORT) : 8001;
// El puerto HTTP de NMS para reproducción web (ej. HTTP-FLV) se calcula para evitar colisiones
const nmsHttpPort = process.env.HTTP_PORT ? parseInt(process.env.HTTP_PORT) - 1 : 8000;

// Carga la configuración guardada de destinos en disco
function loadConfig() {
  try {
    if (fs.existsSync(relaysConfigFile)) {
      const data = fs.readFileSync(relaysConfigFile, 'utf-8');
      // Al reiniciar la app, todos los flujos de retransmisión inician en estado 'idle' (apagado)
      relays = JSON.parse(data).map((r: any) => ({
        ...r,
        status: 'idle'
      }));
      addLog(`Loaded ${relays.length} relays from configuration file.`);
    } else {
      relays = [];
      addLog('No relays config file found. Starting empty.');
    }
  } catch (err) {
    addLog(`Error loading config: ${err}`);
    relays = [];
  }
}

// Escribe la lista de destinos de retransmisión configurados a disco (excluyendo estados efímeros)
function saveConfig() {
  try {
    const dataToSave = relays.map(({ id, name, targetUrl }) => ({ id, name, targetUrl }));
    fs.writeFileSync(relaysConfigFile, JSON.stringify(dataToSave, null, 2), 'utf-8');
    addLog('Saved relay configurations.');
  } catch (err) {
    addLog(`Error saving config: ${err}`);
  }
}

// Resolución del binario FFmpeg.
// En producción, el binario FFmpeg empaquetado como sidecar se copia en el mismo directorio que este ejecutable.
// El nombre del archivo incluye el target triple del compilador de Rust (ej: ffmpeg-x86_64-unknown-linux-gnu).
let ffmpegPath = 'ffmpeg';
const targetTriple = process.env.TAURI_TARGET_TRIPLE || 'x86_64-unknown-linux-gnu';
const sidecarFFmpeg = path.join(baseDir, `ffmpeg-${targetTriple}`);
const sidecarFFmpegWin = path.join(baseDir, `ffmpeg-${targetTriple}.exe`);

if (fs.existsSync(sidecarFFmpeg)) {
  ffmpegPath = sidecarFFmpeg;
  addLog(`Using bundled FFmpeg: ${ffmpegPath}`);
} else if (fs.existsSync(sidecarFFmpegWin)) {
  ffmpegPath = sidecarFFmpegWin;
  addLog(`Using bundled FFmpeg: ${ffmpegPath}`);
} else {
  // Si no se encuentra empaquetado localmente, se busca en las rutas globales del sistema operativo
  addLog(`FFmpeg sidecar not found at: ${sidecarFFmpeg}. Falling back to system path 'ffmpeg'.`);
}

// Inicia un subproceso de FFmpeg para duplicar el stream hacia una plataforma
function startRelayProcess(relay: Relay) {
  if (activeProcesses.some(ap => ap.id === relay.id)) {
    addLog(`Relay ${relay.name} is already running.`);
    return;
  }

  addLog(`Starting FFmpeg relay for: ${relay.name} -> ${relay.targetUrl}`);
  
  // Dirección de ingesta RTMP interna local
  const inputUrl = `rtmp://127.0.0.1:${rtmpPort}/live/test`;
  
  // Argumentos de FFmpeg:
  // -i: ruta del flujo de ingesta local
  // -c copy: copia directa de video y audio (no recodifica, reduce el consumo de CPU a 0%)
  // -f flv: obliga a utilizar el formato de contenedor FLV requerido por RTMP
  const args = ['-i', inputUrl, '-c', 'copy', '-f', 'flv', relay.targetUrl];
  
  const ffmpeg = spawn(ffmpegPath, args);
  relay.status = 'streaming';
  
  activeProcesses.push({
    id: relay.id,
    process: ffmpeg
  });

  // Escucha la salida estándar del subproceso
  ffmpeg.stdout?.on('data', (data) => {
    addLog(`[FFmpeg-${relay.name}] ${data.toString().trim()}`);
  });

  // Escucha los reportes de progreso y errores de FFmpeg
  ffmpeg.stderr?.on('data', (data) => {
    const line = data.toString().trim();
    // Filtra las estadísticas repetitivas de fotogramas para no saturar los logs
    if (line.includes('frame=') || line.includes('fps=') || line.includes('speed=')) {
      if (Math.random() < 0.1) { // Loguea ocasionalmente
        addLog(`[FFmpeg-${relay.name} Status] ${line}`);
      }
    } else {
      addLog(`[FFmpeg-${relay.name}] ${line}`);
    }
  });

  // Controlador para cuando el subproceso finaliza
  ffmpeg.on('close', (code) => {
    addLog(`FFmpeg relay process for ${relay.name} exited with code ${code}`);
    activeProcesses = activeProcesses.filter(ap => ap.id !== relay.id);
    if (relay.status === 'streaming') {
      relay.status = code === 0 ? 'idle' : 'error';
    }
  });

  // Captura problemas al lanzar el proceso
  ffmpeg.on('error', (err) => {
    addLog(`Error in FFmpeg process for ${relay.name}: ${err.message}`);
    relay.status = 'error';
  });
}

// Detiene un flujo de retransmisión matando su subproceso de FFmpeg
function stopRelayProcess(id: string) {
  const active = activeProcesses.find(ap => ap.id === id);
  if (active) {
    addLog(`Stopping relay process: ${id}`);
    active.process.kill('SIGKILL'); // Fuerza la terminación del proceso
    activeProcesses = activeProcesses.filter(ap => ap.id !== id);
  }
  const relay = relays.find(r => r.id === id);
  if (relay) {
    relay.status = 'idle';
  }
}

// Detiene todas las retransmisiones activas (útil al detener el directo en OBS)
function stopAllRelays() {
  addLog('Stopping all active FFmpeg relays.');
  for (const ap of activeProcesses) {
    ap.process.kill('SIGKILL');
  }
  activeProcesses = [];
  for (const relay of relays) {
    relay.status = 'idle';
  }
}

// Configuración e inicio del servidor RTMP (NodeMediaServer)
const nmsConfig = {
  rtmp: {
    port: rtmpPort,
    chunk_size: 60000,
    gop_cache: true,
    ping: 30,
    ping_timeout: 60
  },
  http: {
    port: nmsHttpPort,
    allow_origin: '*'
  }
};

const nms = new NodeMediaServer(nmsConfig);

// Evento disparado cuando OBS inicia la transmisión hacia esta app
nms.on('postPublish', (id, streamPath, args) => {
  addLog(`Inbound stream published: id=${id} path=${streamPath}`);
  if (streamPath === '/live/test') {
    isStreamActive = true;
    addLog('Stream matches intake key (/live/test). Relays ready.');
  }
});

// Evento disparado cuando OBS detiene la transmisión hacia esta app
nms.on('donePublish', (id, streamPath, args) => {
  addLog(`Inbound stream unpublished: id=${id} path=${streamPath}`);
  if (streamPath === '/live/test') {
    isStreamActive = false;
    stopAllRelays(); // Detiene inmediatamente todas las copias activas de FFmpeg
  }
});

// Carga las configuraciones de disco en el arranque
loadConfig();

// Arranca el motor RTMP
nms.run();
addLog(`Node-Media-Server is running on RTMP:${rtmpPort}, HTTP:${nmsHttpPort}`);

// Creación de la API de control HTTP local
const apiServer = http.createServer((req, res) => {
  // Inyección de cabeceras CORS para permitir peticiones desde la app de Tauri (Vite en puerto 1420)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = req.url || '';
  addLog(`API Request: ${req.method} ${url}`);

  // Retorna el estado general, tiempo de actividad y destinos configurados
  if (url === '/status' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      activeStreams: isStreamActive ? 1 : 0,
      uptime: Math.floor((Date.now() - startTime) / 1000),
      relays: relays.map(r => ({
        id: r.id,
        name: r.name,
        targetUrl: r.targetUrl,
        status: r.status
      }))
    }));
    return;
  }

  // Retorna el búfer circular de logs acumulados
  if (url === '/logs' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ logs: logsRingBuffer }));
    return;
  }

  // Agrega un nuevo destino de retransmisión y lo guarda a disco
  if (url === '/relays/add' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const { name, targetUrl } = JSON.parse(body);
        if (!name || !targetUrl) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing parameters' }));
          return;
        }
        const newRelay: Relay = {
          id: Math.random().toString(36).substring(2, 9),
          name,
          targetUrl,
          status: 'idle'
        };
        relays.push(newRelay);
        saveConfig();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(newRelay));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid payload' }));
      }
    });
    return;
  }

  // Inicia la retransmisión hacia un destino específico
  if (url.startsWith('/relays/start/') && req.method === 'POST') {
    const id = url.split('/').pop() || '';
    const relay = relays.find(r => r.id === id);
    if (!relay) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Relay not found' }));
      return;
    }
    if (!isStreamActive) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Inbound stream is not active' }));
      return;
    }
    startRelayProcess(relay);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: relay.status }));
    return;
  }

  // Detiene la retransmisión hacia un destino específico
  if (url.startsWith('/relays/stop/') && req.method === 'POST') {
    const id = url.split('/').pop() || '';
    stopRelayProcess(id);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'idle' }));
    return;
  }

  // Borra la configuración de un destino de retransmisión
  if (url.startsWith('/relays/delete/') && req.method === 'DELETE') {
    const id = url.split('/').pop() || '';
    stopRelayProcess(id);
    relays = relays.filter(r => r.id !== id);
    saveConfig();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
    return;
  }

  // Ruta no encontrada
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Endpoint not found' }));
});

// Arranca el servidor de API
apiServer.listen(httpApiPort, () => {
  addLog(`HTTP Control API Server is running on port ${httpApiPort}`);
});
