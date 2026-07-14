import NodeMediaServer from 'node-media-server';
import http from 'http';
import path from 'path';
import fs from 'fs';
import { spawn, ChildProcess } from 'child_process';

const LOG_LIMIT = 200;
const logsRingBuffer: string[] = [];

function addLog(msg: string) {
  const time = new Date().toLocaleTimeString();
  const formatted = `[${time}] ${msg}`;
  console.log(formatted);
  logsRingBuffer.push(formatted);
  if (logsRingBuffer.length > LOG_LIMIT) {
    logsRingBuffer.shift();
  }
}

// Relays state management
interface Relay {
  id: string;
  name: string;
  targetUrl: string;
  status: 'idle' | 'streaming' | 'error';
}

interface ActiveProcess {
  id: string;
  process: ChildProcess;
}

let relays: Relay[] = [];
let activeProcesses: ActiveProcess[] = [];
let isStreamActive = false;
const startTime = Date.now();

// Setup paths
const isPackaged = typeof (process as any).pkg !== 'undefined';
const baseDir = isPackaged ? path.dirname(process.execPath) : process.cwd();
const relaysConfigFile = path.join(baseDir, 'relays-config.json');

// Load configurations
function loadConfig() {
  try {
    if (fs.existsSync(relaysConfigFile)) {
      const data = fs.readFileSync(relaysConfigFile, 'utf-8');
      relays = JSON.parse(data).map((r: any) => ({
        ...r,
        status: 'idle' // Reset status on startup
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

// Save configurations
function saveConfig() {
  try {
    const dataToSave = relays.map(({ id, name, targetUrl }) => ({ id, name, targetUrl }));
    fs.writeFileSync(relaysConfigFile, JSON.stringify(dataToSave, null, 2), 'utf-8');
    addLog('Saved relay configurations.');
  } catch (err) {
    addLog(`Error saving config: ${err}`);
  }
}

// Resolve FFmpeg path
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
  addLog(`FFmpeg sidecar not found at: ${sidecarFFmpeg}. Falling back to system path 'ffmpeg'.`);
}

// Start a single relay
function startRelayProcess(relay: Relay) {
  if (activeProcesses.some(ap => ap.id === relay.id)) {
    addLog(`Relay ${relay.name} is already running.`);
    return;
  }

  addLog(`Starting FFmpeg relay for: ${relay.name} -> ${relay.targetUrl}`);
  
  // Input is the local RTMP stream intake
  const inputUrl = 'rtmp://127.0.0.1:1935/live/test';
  
  // Spawn FFmpeg process
  // -re: read input at native frame rate (important for RTMP relaying sometimes, though -c copy usually doesn't need it. We will use -i first)
  // -i: input url
  // -c copy: copy video/audio codecs directly without transcoding (0% CPU cost!)
  // -f flv: force format to flv
  const args = ['-i', inputUrl, '-c', 'copy', '-f', 'flv', relay.targetUrl];
  
  const ffmpeg = spawn(ffmpegPath, args);
  relay.status = 'streaming';
  
  activeProcesses.push({
    id: relay.id,
    process: ffmpeg
  });

  ffmpeg.stdout?.on('data', (data) => {
    addLog(`[FFmpeg-${relay.name}] ${data.toString().trim()}`);
  });

  ffmpeg.stderr?.on('data', (data) => {
    const line = data.toString().trim();
    // Only log essential messages to keep console readable
    if (line.includes('frame=') || line.includes('fps=') || line.includes('speed=')) {
      // Periodic stats
      if (Math.random() < 0.1) { // Log occasionally to avoid spam
        addLog(`[FFmpeg-${relay.name} Status] ${line}`);
      }
    } else {
      addLog(`[FFmpeg-${relay.name}] ${line}`);
    }
  });

  ffmpeg.on('close', (code) => {
    addLog(`FFmpeg relay process for ${relay.name} exited with code ${code}`);
    activeProcesses = activeProcesses.filter(ap => ap.id !== relay.id);
    if (relay.status === 'streaming') {
      relay.status = code === 0 ? 'idle' : 'error';
    }
  });

  ffmpeg.on('error', (err) => {
    addLog(`Error in FFmpeg process for ${relay.name}: ${err.message}`);
    relay.status = 'error';
  });
}

// Stop a single relay
function stopRelayProcess(id: string) {
  const active = activeProcesses.find(ap => ap.id === id);
  if (active) {
    addLog(`Stopping relay process: ${id}`);
    active.process.kill('SIGKILL'); // Force terminate
    activeProcesses = activeProcesses.filter(ap => ap.id !== id);
  }
  const relay = relays.find(r => r.id === id);
  if (relay) {
    relay.status = 'idle';
  }
}

// Stop all running relays
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

// Initialize NMS
const nmsConfig = {
  rtmp: {
    port: 1935,
    chunk_size: 60000,
    gop_cache: true,
    ping: 30,
    ping_timeout: 60
  },
  http: {
    port: 8000,
    allow_origin: '*'
  }
};

const nms = new NodeMediaServer(nmsConfig);

nms.on('postPublish', (id, streamPath, args) => {
  addLog(`Inbound stream published: id=${id} path=${streamPath}`);
  if (streamPath === '/live/test') {
    isStreamActive = true;
    addLog('Stream matches intake key (/live/test). Relays ready.');
  }
});

nms.on('donePublish', (id, streamPath, args) => {
  addLog(`Inbound stream unpublished: id=${id} path=${streamPath}`);
  if (streamPath === '/live/test') {
    isStreamActive = false;
    stopAllRelays();
  }
});

// Load stored configurations on boot
loadConfig();

// Start NMS
nms.run();
addLog('Node-Media-Server is running on RTMP:1935, HTTP:8000');

// Create API Control HTTP Server
const apiServer = http.createServer((req, res) => {
  // CORS Headers
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

  // GET /status
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

  // GET /logs
  if (url === '/logs' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ logs: logsRingBuffer }));
    return;
  }

  // POST /relays/add
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

  // POST /relays/start/:id
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

  // POST /relays/stop/:id
  if (url.startsWith('/relays/stop/') && req.method === 'POST') {
    const id = url.split('/').pop() || '';
    stopRelayProcess(id);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'idle' }));
    return;
  }

  // DELETE /relays/delete/:id
  if (url.startsWith('/relays/delete/') && req.method === 'DELETE') {
    const id = url.split('/').pop() || '';
    stopRelayProcess(id);
    relays = relays.filter(r => r.id !== id);
    saveConfig();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
    return;
  }

  // Not Found
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Endpoint not found' }));
});

apiServer.listen(8001, () => {
  addLog('HTTP Control API Server is running on port 8001');
});
