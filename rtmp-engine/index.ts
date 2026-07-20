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
interface ChatMessage {
  id: string;
  user: string;
  text: string;
  platform: 'youtube' | 'facebook' | 'instagram';
  timestamp: string;
}

const chatMessagesBuffer: ChatMessage[] = [];
const CHAT_LIMIT = 100;

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

const OVERLAY_HTML = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>Néctar Cast - Chat Overlay</title>
  <style>
    body {
      background: transparent;
      margin: 0;
      padding: 10px;
      font-family: 'Inter', system-ui, -apple-system, sans-serif;
      color: #f1f5f9;
      overflow: hidden;
      height: 100vh;
      display: flex;
      flex-direction: column;
      justify-content: flex-end;
    }
    .chat-container {
      display: flex;
      flex-direction: column;
      gap: 10px;
      max-height: 100%;
      overflow: hidden;
      padding-bottom: 20px;
    }
    .message-card {
      display: flex;
      flex-direction: column;
      gap: 4px;
      padding: 12px 16px;
      border-radius: 12px;
      animation: slideIn 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards;
      opacity: 0;
      transform: translateY(20px);
      box-shadow: 0 4px 30px rgba(0, 0, 0, 0.2);
    }
    
    /* Themes */
    .theme-glass {
      background: rgba(15, 23, 42, 0.65);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      border: 1px solid rgba(255, 255, 255, 0.08);
    }
    .theme-dark {
      background: #0f172a;
      border: 1px solid #1e293b;
    }
    .theme-bubble {
      background: rgba(88, 28, 135, 0.15);
      border: 1px solid rgba(168, 85, 247, 0.25);
      border-left: 4px solid #a855f7;
    }
    .theme-minimal {
      background: rgba(0, 0, 0, 0.7);
      border-radius: 6px;
      box-shadow: none;
    }

    /* Font Sizes */
    .fs-xs { font-size: 11px; }
    .fs-sm { font-size: 13px; }
    .fs-md { font-size: 15px; }
    .fs-lg { font-size: 18px; }
    .fs-xl { font-size: 22px; }

    .header-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }
    .user-info {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .user-name {
      font-weight: 700;
      color: #ffffff;
      text-shadow: 0 1px 2px rgba(0,0,0,0.5);
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 2px 6px;
      border-radius: 9999px;
      font-size: 0.75em;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      border: 1px solid transparent;
    }
    .badge-youtube {
      background: rgba(239, 68, 68, 0.15);
      color: #f87171;
      border-color: rgba(239, 68, 68, 0.25);
    }
    .badge-facebook {
      background: rgba(59, 130, 246, 0.15);
      color: #60a5fa;
      border-color: rgba(59, 130, 246, 0.25);
    }
    .badge-instagram {
      background: rgba(236, 72, 153, 0.15);
      color: #f472b6;
      border-color: rgba(236, 72, 153, 0.25);
    }
    .badge-twitch {
      background: rgba(168, 85, 247, 0.15);
      color: #c084fc;
      border-color: rgba(168, 85, 247, 0.25);
    }
    .badge-tiktok {
      background: rgba(0, 242, 234, 0.1);
      color: #00f2ea;
      border-color: rgba(254, 44, 85, 0.3);
      text-shadow: 0 0 2px rgba(254, 44, 85, 0.6);
    }
    .badge-custom {
      background: rgba(100, 116, 139, 0.15);
      color: #94a3b8;
      border-color: rgba(100, 116, 139, 0.25);
    }
    .timestamp {
      font-size: 0.7em;
      color: #94a3b8;
      font-family: monospace;
    }
    .message-text {
      color: #cbd5e1;
      line-height: 1.4;
      word-break: break-word;
      text-shadow: 0 1px 2px rgba(0,0,0,0.5);
    }

    @keyframes slideIn {
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }
  </style>
</head>
<body>
  <div class="chat-container" id="chat"></div>
  <script>
    const params = new URLSearchParams(window.location.search);
    const fontSize = params.get('fontSize') || 'md';
    const theme = params.get('theme') || 'glass';
    const platforms = params.get('platforms') ? params.get('platforms').split(',') : ['youtube', 'facebook', 'instagram', 'twitch', 'tiktok'];
    const showEmojis = params.get('showEmojis') !== 'false';
    const limit = parseInt(params.get('limit')) || 10;

    const chatDiv = document.getElementById('chat');
    let displayedIds = new Set();

    const platformMeta = {
      youtube: {
        label: 'YouTube',
        badgeClass: 'badge-youtube',
        svg: '<svg style="width:12px;height:12px;" viewBox="0 0 24 24" fill="currentColor"><path d="M23.498 6.163a3.003 3.003 0 0 0-2.11-2.11C19.517 3.545 12 3.545 12 3.545s-7.517 0-9.388.508a3.003 3.003 0 0 0-2.11 2.11C0 8.033 0 12 0 12s0 3.967.502 5.837a3.003 3.003 0 0 0 2.11 2.11c1.871.508 9.388.508 9.388.508s7.517 0 9.388-.508a3.002 3.002 0 0 0 2.11-2.11C24 15.967 24 12 24 12s0-3.967-.502-5.837zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>'
      },
      facebook: {
        label: 'Facebook',
        badgeClass: 'badge-facebook',
        svg: '<svg style="width:12px;height:12px;" viewBox="0 0 24 24" fill="currentColor"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>'
      },
      instagram: {
        label: 'Instagram',
        badgeClass: 'badge-instagram',
        svg: '<svg style="width:12px;height:12px;" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.051.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 1 0 0 12.324 6.162 6.162 0 0 0 0-12.324zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.406-11.845a1.44 1.44 0 1 0 0 2.881 1.44 1.44 0 0 0 0-2.881z"/></svg>'
      },
      twitch: {
        label: 'Twitch',
        badgeClass: 'badge-twitch',
        svg: '<svg style="width:12px;height:12px;" viewBox="0 0 24 24" fill="currentColor"><path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714Z"/></svg>'
      },
      tiktok: {
        label: 'TikTok',
        badgeClass: 'badge-tiktok',
        svg: '<svg style="width:12px;height:12px;" viewBox="0 0 24 24" fill="currentColor"><path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.17-2.89-.74-3.94-1.78-.22-.22-.41-.47-.58-.73v7.02c0 3.76-3.07 6.86-6.96 6.82-3.86-.03-6.9-3.23-6.79-7.1.09-3.41 2.85-6.26 6.27-6.4 1.17-.05 1.17 1.77 0 1.82-2.44.1-4.48 2.05-4.49 4.54-.02 2.79 2.4 5.09 5.21 4.9 2.45-.16 4.31-2.22 4.31-4.7v-11.6c.01-1.02-.01-2.04.02-3.06z"/></svg>'
      }
    };

    function formatText(text) {
      if (!showEmojis) {
        return text.replace(/([\\u2700-\\u27BF]|[\\uE000-\\uF8FF]|\\uD83C[\\uDC00-\\uDFFF]|\\uD83D[\\uDC00-\\uDFFF]|[\\u2011-\\u26FF]|\\uD83E[\\uDD10-\\uDDFF])/g, '');
      }
      return text;
    }

    async function updateChat() {
      try {
        const res = await fetch('/api/messages');
        if (!res.ok) return;
        const data = await res.json();
        const apiMessages = data.messages || [];

        const filtered = apiMessages.filter(function(m) { return platforms.includes(m.platform); });
        const tail = filtered.slice(-limit);

        let hasNew = false;
        tail.forEach(function(msg) {
          if (!displayedIds.has(msg.id)) {
            hasNew = true;
            displayedIds.add(msg.id);
            
            let meta = platformMeta[msg.platform];
            if (!meta) {
              const platName = msg.platform.charAt(0).toUpperCase() + msg.platform.slice(1);
              meta = {
                label: platName,
                badgeClass: 'badge-custom',
                svg: '<svg style="width:12px;height:12px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>'
              };
            }

            const card = document.createElement('div');
            card.className = 'message-card theme-' + theme + ' fs-' + fontSize;
            card.dataset.id = msg.id;

            card.innerHTML = 
              '<div class="header-row">' +
                '<div class="user-info">' +
                  '<span class="badge ' + meta.badgeClass + '">' +
                    meta.svg + ' ' + meta.label +
                  '</span>' +
                  '<span class="user-name">' + msg.user + '</span>' +
                '</div>' +
                '<span class="timestamp">' + msg.timestamp + '</span>' +
              '</div>' +
              '<div class="message-text">' + formatText(msg.text) + '</div>';

            chatDiv.appendChild(card);
          }
        });

        const cards = chatDiv.getElementsByClassName('message-card');
        while (cards.length > limit) {
          const first = cards[0];
          displayedIds.delete(first.dataset.id);
          first.remove();
        }

        if (hasNew) {
          window.scrollTo(0, document.body.scrollHeight);
        }
      } catch (err) {
        console.error('Error fetching overlay messages:', err);
      }
    }

    updateChat();
    setInterval(updateChat, 1000);
  </script>
</body>
</html>`;

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
  const parsedUrl = new URL(url, 'http://localhost');
  const pathname = parsedUrl.pathname;
  addLog(`API Request: ${req.method} ${url}`);

  // Retorna el HTML del Overlay de chat de OBS
  if (pathname === '/overlay' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(OVERLAY_HTML);
    return;
  }

  // Devuelve los mensajes de chat almacenados en memoria
  if (pathname === '/api/messages' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ messages: chatMessagesBuffer }));
    return;
  }

  // Agrega un nuevo mensaje de chat al buffer circular
  if (pathname === '/api/messages' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const msg = JSON.parse(body);
        if (msg.user && msg.text && msg.platform) {
          const newMsg: ChatMessage = {
            id: msg.id || Math.random().toString(),
            user: msg.user,
            text: msg.text,
            platform: msg.platform,
            timestamp: msg.timestamp || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
          };
          chatMessagesBuffer.push(newMsg);
          if (chatMessagesBuffer.length > CHAT_LIMIT) {
            chatMessagesBuffer.shift();
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, message: newMsg }));
        } else {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing parameters' }));
        }
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid payload' }));
      }
    });
    return;
  }

  // Retorna el estado general, tiempo de actividad y destinos configurados
  if (pathname === '/status' && req.method === 'GET') {
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
  if (pathname === '/logs' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ logs: logsRingBuffer }));
    return;
  }

  // Agrega un nuevo destino de retransmisión y lo guarda a disco
  if (pathname === '/relays/add' && req.method === 'POST') {
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
  if (pathname.startsWith('/relays/start/') && req.method === 'POST') {
    const id = pathname.split('/').pop() || '';
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
  if (pathname.startsWith('/relays/stop/') && req.method === 'POST') {
    const id = pathname.split('/').pop() || '';
    stopRelayProcess(id);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'idle' }));
    return;
  }

  // Borra la configuración de un destino de retransmisión
  if (pathname.startsWith('/relays/delete/') && req.method === 'DELETE') {
    const id = pathname.split('/').pop() || '';
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
