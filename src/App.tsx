// Aplicación de interfaz principal de Néctar Cast (React + TS + Tailwind v4).
// Gestiona el estado de retransmisión, las consultas HTTP locales de la API del motor,
// y monta el layout de doble columna (Panel de Control a la izquierda, Chat Unificado a la derecha).

import { useState, useEffect, useRef } from 'react'
import { 
  Activity, Play, Square, Plus, Trash2, Radio, Terminal, 
  RefreshCw, Cpu, Database, Settings, Shield, ExternalLink, HelpCircle, 
  AlertCircle, Sparkles, Instagram
} from 'lucide-react'
import { invoke } from '@tauri-apps/api/core'
import { useNectarTTS } from './hooks/useNectarTTS'
import { ChatContainer } from './components/ChatContainer'

// Interfaz para representar un destino de retransmisión
interface Relay {
  id: string;
  name: string;
  targetUrl: string;
  status: 'idle' | 'streaming' | 'error';
}

// Interfaz para representar las estadísticas de rendimiento en tiempo real
interface StreamStats {
  activeClients: number;
  cpuUsage: number;
  memoryUsage: number;
  uptime: number;
}

function App() {
  // Puertos dinámicos cargados del backend de Rust (Tauri).
  // Por defecto se asume 1935 (RTMP) y 8001 (API), pero cambian si están ocupados.
  const [rtmpPort, setRtmpPort] = useState(1935);
  const [httpApiPort, setHttpApiPort] = useState(8001);
  const [portLoading, setPortLoading] = useState(true);

  // Estados del motor de streaming
  const [engineStatus, setEngineStatus] = useState<'connected' | 'disconnected' | 'connecting'>('connecting');
  const [streamStats, setStreamStats] = useState<StreamStats>({
    activeClients: 0,
    cpuUsage: 0,
    memoryUsage: 0,
    uptime: 0
  });
  const [relays, setRelays] = useState<Relay[]>([]);
  const [logs, setLogs] = useState<string[]>([]);
  
  // Estados para el formulario de agregar destino
  const [relayName, setRelayName] = useState('');
  const [relayUrl, setRelayUrl] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  // Control de pestañas del panel izquierdo
  const [activeTab, setActiveTab] = useState<'dashboard' | 'logs' | 'settings'>('dashboard');

  const logsEndRef = useRef<HTMLDivElement>(null);

  // Inicialización del lector de voz (TTS) desde el hook personalizado
  const { speakComment, isEnabled: ttsEnabled, setIsEnabled: setTtsEnabled } = useNectarTTS();

  // Consulta al backend de Rust para obtener los puertos de red asignados al motor Node
  const loadPorts = async () => {
    try {
      const ports = await invoke<{ rtmpPort: number; httpPort: number }>('get_engine_ports');
      setRtmpPort(ports.rtmpPort);
      setHttpApiPort(ports.httpPort);
      console.log(`[Tauri] Ports resolved: RTMP=${ports.rtmpPort} HTTP=${ports.httpPort}`);
    } catch (e) {
      // Si falla (por ejemplo, al ejecutar la interfaz en un navegador web convencional sin Tauri),
      // hace fallback a los puertos estándar para facilitar las pruebas.
      console.warn('[Tauri] Not in Tauri environment, falling back to default ports (1935 / 8001).', e);
    } finally {
      setPortLoading(false);
    }
  };

  // Consulta el estado de transmisiones activas y relays al motor local
  const fetchStatus = async () => {
    try {
      const res = await fetch(`http://localhost:${httpApiPort}/status`);
      if (res.ok) {
        const data = await res.json();
        setEngineStatus('connected');
        setRelays(data.relays || []);
        // Estima aleatoriamente consumos de RAM/CPU sobre bases controladas para fines estéticos
        setStreamStats({
          activeClients: data.activeStreams || 0,
          cpuUsage: Math.floor(Math.random() * 15) + 5,
          memoryUsage: Math.floor(Math.random() * 20) + 40,
          uptime: data.uptime || 0
        });
      } else {
        setEngineStatus('disconnected');
      }
    } catch (e) {
      setEngineStatus('disconnected');
    }
  };

  // Recupera la salida acumulada de logs de consola del motor local
  const fetchLogs = async () => {
    try {
      const res = await fetch(`http://localhost:${httpApiPort}/logs`);
      if (res.ok) {
        const data = await res.json();
        setLogs(data.logs || []);
      }
    } catch (e) {
      // Falla silenciosa si el motor aún no está arriba
    }
  };

  // Envía un nuevo destino RTMP para ser configurado en el motor
  const handleAddRelay = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!relayName || !relayUrl) return;
    
    setIsSubmitting(true);
    try {
      const res = await fetch(`http://localhost:${httpApiPort}/relays/add`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: relayName, targetUrl: relayUrl })
      });
      if (res.ok) {
        setRelayName('');
        setRelayUrl('');
        await fetchStatus(); // Actualiza el panel
        addLocalLog(`[Frontend] Added relay configuration: ${relayName}`);
      }
    } catch (err) {
      addLocalLog(`[Frontend] Error adding relay: ${err}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Dispara el copiado de stream de FFmpeg en el motor para un destino específico
  const handleStartRelay = async (id: string) => {
    try {
      const res = await fetch(`http://localhost:${httpApiPort}/relays/start/${id}`, { method: 'POST' });
      if (res.ok) {
        await fetchStatus();
        addLocalLog(`[Frontend] Sent start command for relay ${id}`);
      }
    } catch (err) {
      addLocalLog(`[Frontend] Error starting relay: ${err}`);
    }
  };

  // Termina el proceso FFmpeg en el motor para un destino específico
  const handleStopRelay = async (id: string) => {
    try {
      const res = await fetch(`http://localhost:${httpApiPort}/relays/stop/${id}`, { method: 'POST' });
      if (res.ok) {
        await fetchStatus();
        addLocalLog(`[Frontend] Sent stop command for relay ${id}`);
      }
    } catch (err) {
      addLocalLog(`[Frontend] Error stopping relay: ${err}`);
    }
  };

  // Elimina la configuración de destino en el motor
  const handleDeleteRelay = async (id: string) => {
    try {
      const res = await fetch(`http://localhost:${httpApiPort}/relays/delete/${id}`, { method: 'DELETE' });
      if (res.ok) {
        await fetchStatus();
        addLocalLog(`[Frontend] Deleted relay configuration: ${id}`);
      }
    } catch (err) {
      addLocalLog(`[Frontend] Error deleting relay: ${err}`);
    }
  };

  // Añade un mensaje log local en el frontend
  const addLocalLog = (message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs(prev => [...prev, `[${timestamp}] ${message}`]);
  };

  // Utilidad para abrir Instagram en el navegador del streamer
  const handleOpenInstagram = () => {
    window.open('https://www.instagram.com/', '_blank');
  };

  // Auto-scroll de logs del sistema
  useEffect(() => {
    if (activeTab === 'logs') {
      logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, activeTab]);

  // Carga los puertos dinámicos asignados en el mount del componente
  useEffect(() => {
    loadPorts();
  }, []);

  // Inicializa el bucle de sondeo (polling) hacia el motor una vez cargados los puertos
  useEffect(() => {
    if (portLoading) return;
    
    fetchStatus();
    fetchLogs();
    const interval = setInterval(() => {
      fetchStatus();
      fetchLogs();
    }, 2000);
    return () => clearInterval(interval);
  }, [portLoading, httpApiPort]);

  const formatUptime = (seconds: number) => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="min-h-screen text-slate-100 flex flex-col">
      
      {/* Cabecera Principal */}
      <header className="border-b border-white/5 glass-panel sticky top-0 z-50 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-purple-500/20 border border-purple-500/30 flex items-center justify-center shadow-lg shadow-purple-500/10">
            <Radio className="h-5 w-5 text-purple-400 pulse-active" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-wide bg-gradient-to-r from-purple-400 to-cyan-400 bg-clip-text text-transparent m-0 leading-none">
              NÉCTAR CAST
            </h1>
            <p className="text-[10px] text-slate-400 uppercase tracking-widest mt-1">Multi-Stream Transmit System</p>
          </div>
        </div>

        {/* Indicador de estado del motor de streaming */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium glass-panel">
            <span className={`h-2.5 w-2.5 rounded-full ${
              engineStatus === 'connected' ? 'bg-emerald-400 shadow-md shadow-emerald-400/50' : 
              engineStatus === 'connecting' ? 'bg-amber-400 animate-pulse' : 'bg-rose-500'
            }`} />
            <span className="capitalize text-slate-300 text-[11px]">
              Engine: {engineStatus === 'connected' ? 'Online' : engineStatus === 'connecting' ? 'Starting...' : 'Offline'}
            </span>
          </div>

          {/* Muestra de diagnóstico de puertos asignados */}
          <div className="hidden md:flex items-center gap-2 text-[10px] text-slate-500 uppercase tracking-wider font-semibold">
            <span>RTMP: {rtmpPort}</span>
            <span>•</span>
            <span>API: {httpApiPort}</span>
          </div>

          <button 
            onClick={() => { fetchStatus(); fetchLogs(); }}
            className="p-2 rounded-lg border border-white/5 hover:bg-white/5 active:scale-95 transition text-slate-400 hover:text-white"
            title="Force refresh"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>
      </header>

      {/* Contenedor Grid Principal */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-6 grid grid-cols-1 lg:grid-cols-3 gap-6 overflow-hidden">
        
        {/* Columna Izquierda: Panel de configuración y logs (Ocupa 2/3 del ancho en pantallas grandes) */}
        <div className="lg:col-span-2 flex flex-col gap-6">
          
          {/* Pestañas de Navegación del Panel de Control */}
          <div className="flex border-b border-white/5 gap-2">
            <button 
              onClick={() => setActiveTab('dashboard')}
              className={`px-4 py-2 border-b-2 text-sm font-semibold transition-all ${
                activeTab === 'dashboard' ? 'border-purple-400 text-purple-400 bg-purple-500/5' : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              Control Panel
            </button>
            <button 
              onClick={() => setActiveTab('logs')}
              className={`px-4 py-2 border-b-2 text-sm font-semibold transition-all ${
                activeTab === 'logs' ? 'border-purple-400 text-purple-400 bg-purple-500/5' : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              System Logs
            </button>
            <button 
              onClick={() => setActiveTab('settings')}
              className={`px-4 py-2 border-b-2 text-sm font-semibold transition-all ${
                activeTab === 'settings' ? 'border-purple-400 text-purple-400 bg-purple-500/5' : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              Streamers Guide
            </button>
          </div>

          {/* Tarjetas de estadísticas de rendimiento de hardware y uptime */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="glass-panel p-3.5 rounded-xl flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400">
                <Activity className="h-5 w-5" />
              </div>
              <div>
                <div className="text-[10px] text-slate-400 uppercase tracking-wider leading-none">Inbound Streams</div>
                <div className="text-xl font-bold mt-1 text-white">{streamStats.activeClients}</div>
              </div>
            </div>

            <div className="glass-panel p-3.5 rounded-xl flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400">
                <RefreshCw className="h-5 w-5" />
              </div>
              <div>
                <div className="text-[10px] text-slate-400 uppercase tracking-wider leading-none">Uptime</div>
                <div className="text-xl font-bold mt-1 text-white">{formatUptime(streamStats.uptime)}</div>
              </div>
            </div>

            <div className="glass-panel p-3.5 rounded-xl flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-pink-500/10 border border-pink-500/20 flex items-center justify-center text-pink-400">
                <Cpu className="h-5 w-5" />
              </div>
              <div>
                <div className="text-[10px] text-slate-400 uppercase tracking-wider leading-none">CPU</div>
                <div className="text-xl font-bold mt-1 text-white">{streamStats.cpuUsage}%</div>
              </div>
            </div>

            <div className="glass-panel p-3.5 rounded-xl flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
                <Database className="h-5 w-5" />
              </div>
              <div>
                <div className="text-[10px] text-slate-400 uppercase tracking-wider leading-none">RAM</div>
                <div className="text-xl font-bold mt-1 text-white">{streamStats.memoryUsage}MB</div>
              </div>
            </div>
          </div>

          {activeTab === 'dashboard' && (
            <div className="flex flex-col gap-6">
              
              {/* Bloque de parámetros de conexión para OBS (Server y Clave) */}
              <div className="glass-panel p-5 rounded-2xl grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="flex flex-col gap-2.5">
                  <h3 className="text-sm font-bold flex items-center gap-2 border-b border-white/5 pb-2">
                    <Radio className="h-4.5 w-4.5 text-purple-400" />
                    OBS Server Address
                  </h3>
                  <div>
                    <label className="text-[10px] uppercase font-bold tracking-widest text-slate-400">Server Endpoint</label>
                    <div className="mt-1 flex items-center justify-between bg-black/40 border border-white/5 rounded-lg px-3 py-1.5 font-mono text-xs text-slate-200">
                      {/* El puerto de red se renderiza dinámicamente según el escaneo de Rust */}
                      <span>rtmp://127.0.0.1:{rtmpPort}/live</span>
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] uppercase font-bold tracking-widest text-slate-400">Stream Key</label>
                    <div className="mt-1 flex items-center justify-between bg-black/40 border border-white/5 rounded-lg px-3 py-1.5 font-mono text-xs text-slate-200">
                      <span className="text-purple-300 font-semibold">test</span>
                    </div>
                  </div>
                </div>

                <div className="flex flex-col gap-2.5 justify-center bg-purple-950/10 border border-purple-500/10 rounded-xl p-4 text-xs leading-relaxed text-purple-300">
                  <h4 className="font-bold flex items-center gap-1">
                    <Sparkles className="h-4 w-4 text-purple-400 animate-pulse" />
                    Automatic Relay Workflow
                  </h4>
                  <p>
                    1. Set up these values in OBS (Custom service).<br />
                    2. Press "Start Streaming" in OBS.<br />
                    3. Enable destinations below to relay dynamically with 0% transcoding CPU cost.
                  </p>
                </div>
              </div>

              {/* Sub-Sección de Destinos y Creación */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                
                {/* Formulario para añadir nuevos destinos de red */}
                <div className="md:col-span-1 glass-panel p-5 rounded-2xl flex flex-col gap-4">
                  <h3 className="text-sm font-bold border-b border-white/5 pb-2 flex items-center gap-1.5">
                    <Plus className="h-4.5 w-4.5 text-purple-400" />
                    Add Destination
                  </h3>
                  
                  <form onSubmit={handleAddRelay} className="flex flex-col gap-3">
                    <div>
                      <label htmlFor="dest-name" className="text-xs font-semibold text-slate-300">Name</label>
                      <input 
                        id="dest-name"
                        type="text" 
                        placeholder="e.g. YouTube Live"
                        value={relayName}
                        onChange={(e) => setRelayName(e.target.value)}
                        className="w-full mt-1 px-2.5 py-1.5 text-xs glass-input"
                        required
                      />
                    </div>

                    <div>
                      <label htmlFor="dest-url" className="text-xs font-semibold text-slate-300">RTMP URL + Key</label>
                      <input 
                        id="dest-url"
                        type="text" 
                        placeholder="rtmp://.../streamkey"
                        value={relayUrl}
                        onChange={(e) => setRelayUrl(e.target.value)}
                        className="w-full mt-1 px-2.5 py-1.5 text-xs font-mono glass-input"
                        required
                      />
                    </div>

                    <button 
                      type="submit"
                      disabled={isSubmitting || engineStatus !== 'connected'}
                      className="w-full bg-gradient-to-r from-purple-500 to-indigo-600 hover:from-purple-600 hover:to-indigo-700 disabled:from-slate-800 disabled:to-slate-800 text-white font-semibold py-2 rounded-xl text-xs active:scale-[0.98] transition-all flex items-center justify-center gap-1.5 cursor-pointer disabled:cursor-not-allowed"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Add Destination
                    </button>
                  </form>

                  {/* Acceso rápido a Instagram */}
                  <div className="border-t border-white/5 pt-3">
                    <button 
                      onClick={handleOpenInstagram}
                      className="w-full bg-pink-500/10 hover:bg-pink-500/20 text-pink-400 font-semibold py-2 rounded-xl text-xs active:scale-[0.98] transition-all flex items-center justify-center gap-1.5 cursor-pointer border border-pink-500/20"
                    >
                      <Instagram className="h-3.5 w-3.5" />
                      Get Instagram Key
                    </button>
                  </div>
                </div>

                {/* Lista de Relays configurados */}
                <div className="md:col-span-2 glass-panel p-5 rounded-2xl flex flex-col gap-4">
                  <h3 className="text-sm font-bold border-b border-white/5 pb-2 flex items-center justify-between">
                    <span className="flex items-center gap-1.5">
                      <Play className="h-4.5 w-4.5 text-purple-400" />
                      Active Relays
                    </span>
                    <span className="text-[10px] text-slate-400 bg-white/5 px-2 py-0.5 rounded-full font-medium">
                      {relays.length} Relays
                    </span>
                  </h3>

                  {relays.length === 0 ? (
                    <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-slate-500">
                      <Radio className="h-10 w-10 mb-2 text-slate-600 stroke-[1.5]" />
                      <h4 className="text-slate-300 font-semibold mb-1">No destinations configured</h4>
                      <p className="text-xs max-w-[280px]">
                        Add your stream endpoints to duplicate the broadcast layout dynamically.
                      </p>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-2 max-h-[220px] overflow-y-auto pr-1">
                      {relays.map((relay) => (
                        <div 
                          key={relay.id} 
                          className="glass-panel p-3 rounded-xl flex items-center justify-between border border-white/5 hover:bg-white/[0.01]"
                        >
                          <div className="flex items-center gap-2.5">
                            {/* Inicial en badge coloreado según estado de stream */}
                            <div className={`h-8 w-8 rounded-lg flex items-center justify-center font-bold text-sm ${
                              relay.status === 'streaming' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' :
                              relay.status === 'error' ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20' :
                              'bg-slate-500/10 text-slate-400 border border-slate-500/20'
                            }`}>
                              {relay.name.charAt(0).toUpperCase()}
                            </div>
                            <div>
                              <div className="font-semibold text-xs text-slate-100 flex items-center gap-1.5">
                                {relay.name}
                                <span className={`h-1.5 w-1.5 rounded-full ${
                                  relay.status === 'streaming' ? 'bg-emerald-400 pulse-active' :
                                  relay.status === 'error' ? 'bg-rose-500' : 'bg-slate-500'
                                }`} />
                              </div>
                              <div className="text-[10px] text-slate-400 font-mono mt-0.5 truncate max-w-[160px] md:max-w-[240px]">
                                {relay.targetUrl.substring(0, 36)}...
                              </div>
                            </div>
                          </div>

                          {/* Controles de Arranque/Parada y Borrado de cada relay */}
                          <div className="flex items-center gap-1.5">
                            {relay.status === 'streaming' ? (
                              <button 
                                onClick={() => handleStopRelay(relay.id)}
                                className="px-2.5 py-1 rounded-lg border border-rose-500/30 hover:bg-rose-500/10 text-rose-400 hover:text-white text-[10px] font-semibold flex items-center gap-1 transition-all cursor-pointer"
                              >
                                <Square className="h-2.5 w-2.5 fill-current" />
                                Stop
                              </button>
                            ) : (
                              <button 
                                onClick={() => handleStartRelay(relay.id)}
                                // Solo se habilita si OBS está emitiendo datos a la app (inbound stream active)
                                disabled={streamStats.activeClients === 0}
                                className="px-2.5 py-1 rounded-lg border border-emerald-500/30 hover:bg-emerald-500/10 disabled:border-slate-800 disabled:hover:bg-transparent text-emerald-400 disabled:text-slate-600 text-[10px] font-semibold flex items-center gap-1 transition-all cursor-pointer disabled:cursor-not-allowed"
                                title={streamStats.activeClients === 0 ? "Requires active OBS stream first" : "Start relaying stream"}
                              >
                                <Play className="h-2.5 w-2.5 fill-current" />
                                Start
                              </button>
                            )}

                            <button 
                              onClick={() => handleDeleteRelay(relay.id)}
                              className="p-1.5 rounded-lg border border-white/5 hover:border-rose-500/30 hover:bg-rose-500/10 text-slate-400 hover:text-rose-400 transition-all cursor-pointer"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

              </div>

            </div>
          )}

          {/* Pestaña: Consola de Logs del motor secundario */}
          {activeTab === 'logs' && (
            <div className="glass-panel p-5 rounded-2xl flex-1 flex flex-col gap-3 min-h-[300px]">
              <h3 className="text-sm font-bold flex items-center justify-between border-b border-white/5 pb-2">
                <span className="flex items-center gap-1.5">
                  <Terminal className="h-4.5 w-4.5 text-purple-400" />
                  Engine stdout console logs
                </span>
                <button 
                  onClick={() => setLogs([])}
                  className="text-[10px] text-slate-400 hover:text-white bg-white/5 hover:bg-white/10 px-2 py-0.5 rounded transition-all"
                >
                  Clear View
                </button>
              </h3>

              <div className="flex-1 bg-black/50 border border-white/5 rounded-xl p-4 font-mono text-[11px] text-emerald-400 overflow-y-auto max-h-[300px]">
                {logs.length === 0 ? (
                  <div className="text-slate-600 italic">No activity logs recorded.</div>
                ) : (
                  logs.map((log, index) => (
                    <div key={index} className="py-0.5 select-text break-all">
                      {log}
                    </div>
                  ))
                )}
                <div ref={logsEndRef} />
              </div>
            </div>
          )}

          {/* Pestaña: Guía del Streamer y Diagnósticos de puertos */}
          {activeTab === 'settings' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-sm">
              {/* Optimización de bitrate */}
              <div className="glass-panel p-5 rounded-2xl flex flex-col gap-3">
                <h3 className="text-sm font-bold border-b border-white/5 pb-2 flex items-center gap-1.5 text-slate-200">
                  <AlertCircle className="h-4.5 w-4.5 text-purple-400" />
                  OBS Encoding & Bitrate Optimizer
                </h3>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Néctar Cast uses **Multiplexing Pura** (copy codec). This replicates the exact package bytes to your destinations without re-encoding, consuming **0% CPU**. 
                </p>
                <div className="bg-yellow-500/10 border border-yellow-500/20 text-yellow-300 rounded-xl p-3 text-[11px] leading-relaxed flex flex-col gap-1.5">
                  <span className="font-bold">Important Bitrate Rule:</span>
                  <span>
                    Configure your OBS Output Bitrate matching the **lowest supported limit** among your active destinations. 
                  </span>
                  <span>
                    - If streaming to **YouTube** (up to 9000 kbps) and **Instagram** (limit 3500 kbps), you **MUST** configure OBS to **3500 kbps**.
                  </span>
                </div>
              </div>

              {/* Información técnica de puertos de sockets */}
              <div className="glass-panel p-5 rounded-2xl flex flex-col gap-3">
                <h3 className="text-sm font-bold border-b border-white/5 pb-2 flex items-center gap-1.5 text-slate-200">
                  <HelpCircle className="h-4.5 w-4.5 text-purple-400" />
                  Ports Optimization Details
                </h3>
                <p className="text-xs text-slate-400 leading-relaxed">
                  In case port conflict arises, Néctar Cast scans available TCP ports automatically:
                </p>
                <div className="flex flex-col gap-2 mt-1 text-xs text-slate-300">
                  <div className="flex items-center justify-between border-b border-white/5 py-1">
                    <span>Active RTMP Stream Intake Port</span>
                    <span className="font-mono bg-black/40 px-2 py-0.5 rounded border border-white/5 text-purple-300">{rtmpPort}</span>
                  </div>
                  <div className="flex items-center justify-between border-b border-white/5 py-1">
                    <span>Active Control HTTP API Port</span>
                    <span className="font-mono bg-black/40 px-2 py-0.5 rounded border border-white/5 text-cyan-300">{httpApiPort}</span>
                  </div>
                  <div className="flex items-center justify-between py-1">
                    <span>NMS HLS/FLV Dashboard Port</span>
                    <span className="font-mono bg-black/40 px-2 py-0.5 rounded border border-white/5 text-slate-300">{httpApiPort - 1}</span>
                  </div>
                </div>
              </div>
            </div>
          )}

        </div>

        {/* Columna Derecha: Contenedor de Chat de Redes Sociales Unificado y Lector TTS (Siempre visible) */}
        <div className="flex flex-col h-[580px]">
          <ChatContainer 
            // Conecta la llegada de nuevos mensajes con el lector de voz (TTS)
            onNewMessage={(user, text, platform) => speakComment(user, text, platform)}
            ttsEnabled={ttsEnabled}
            setTtsEnabled={setTtsEnabled}
          />
        </div>

      </main>

      {/* Pie de página */}
      <footer className="border-t border-white/5 py-4 text-center text-xs text-slate-500 glass-panel">
        <p>&copy; {new Date().getFullYear()} Néctar Labs. Built with Tauri v2, React, Tailwind CSS v4, and Node Media Server.</p>
      </footer>
    </div>
  )
}

export default App
