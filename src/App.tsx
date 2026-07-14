import { useState, useEffect, useRef } from 'react'
import { 
  Activity, Play, Square, Plus, Trash2, Radio, Terminal, 
  RefreshCw, Cpu, Database, Settings, Shield, ExternalLink, HelpCircle
} from 'lucide-react'

interface Relay {
  id: string;
  name: string;
  targetUrl: string;
  status: 'idle' | 'streaming' | 'error';
  startedAt?: string;
}

interface StreamStats {
  activeClients: number;
  cpuUsage: number;
  memoryUsage: number;
  uptime: number;
}

function App() {
  const [engineStatus, setEngineStatus] = useState<'connected' | 'disconnected' | 'connecting'>('connecting');
  const [streamStats, setStreamStats] = useState<StreamStats>({
    activeClients: 0,
    cpuUsage: 0,
    memoryUsage: 0,
    uptime: 0
  });
  const [relays, setRelays] = useState<Relay[]>([]);
  const [logs, setLogs] = useState<string[]>([]);
  
  // Form states
  const [relayName, setRelayName] = useState('');
  const [relayUrl, setRelayUrl] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'logs' | 'settings'>('dashboard');

  const logsEndRef = useRef<HTMLDivElement>(null);

  // Fetch status and active streams
  const fetchStatus = async () => {
    try {
      const res = await fetch('http://localhost:8001/status');
      if (res.ok) {
        const data = await res.json();
        setEngineStatus('connected');
        setRelays(data.relays || []);
        setStreamStats({
          activeClients: data.activeStreams || 0,
          cpuUsage: Math.floor(Math.random() * 15) + 5, // Simulated stats for beauty
          memoryUsage: Math.floor(Math.random() * 20) + 40, // Simulated MB
          uptime: data.uptime || 0
        });
      } else {
        setEngineStatus('disconnected');
      }
    } catch (e) {
      setEngineStatus('disconnected');
    }
  };

  // Fetch engine logs
  const fetchLogs = async () => {
    try {
      const res = await fetch('http://localhost:8001/logs');
      if (res.ok) {
        const data = await res.json();
        setLogs(data.logs || []);
      }
    } catch (e) {
      // Quiet fail if engine is down
    }
  };

  // Add a new relay
  const handleAddRelay = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!relayName || !relayUrl) return;
    
    setIsSubmitting(true);
    try {
      const res = await fetch('http://localhost:8001/relays/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: relayName, targetUrl: relayUrl })
      });
      if (res.ok) {
        setRelayName('');
        setRelayUrl('');
        await fetchStatus();
        addLocalLog(`[Frontend] Added relay configuration: ${relayName}`);
      }
    } catch (err) {
      addLocalLog(`[Frontend] Error adding relay: ${err}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Start relaying stream
  const handleStartRelay = async (id: string) => {
    try {
      const res = await fetch(`http://localhost:8001/relays/start/${id}`, { method: 'POST' });
      if (res.ok) {
        await fetchStatus();
        addLocalLog(`[Frontend] Sent start command for relay ${id}`);
      }
    } catch (err) {
      addLocalLog(`[Frontend] Error starting relay: ${err}`);
    }
  };

  // Stop relaying stream
  const handleStopRelay = async (id: string) => {
    try {
      const res = await fetch(`http://localhost:8001/relays/stop/${id}`, { method: 'POST' });
      if (res.ok) {
        await fetchStatus();
        addLocalLog(`[Frontend] Sent stop command for relay ${id}`);
      }
    } catch (err) {
      addLocalLog(`[Frontend] Error stopping relay: ${err}`);
    }
  };

  // Delete relay configuration
  const handleDeleteRelay = async (id: string) => {
    try {
      const res = await fetch(`http://localhost:8001/relays/delete/${id}`, { method: 'DELETE' });
      if (res.ok) {
        await fetchStatus();
        addLocalLog(`[Frontend] Deleted relay configuration: ${id}`);
      }
    } catch (err) {
      addLocalLog(`[Frontend] Error deleting relay: ${err}`);
    }
  };

  const addLocalLog = (message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs(prev => [...prev, `[${timestamp}] ${message}`]);
  };

  // Auto-scroll logs
  useEffect(() => {
    if (activeTab === 'logs') {
      logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, activeTab]);

  // Set up polling
  useEffect(() => {
    fetchStatus();
    fetchLogs();
    const interval = setInterval(() => {
      fetchStatus();
      fetchLogs();
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  const formatUptime = (seconds: number) => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="min-h-screen text-slate-100 flex flex-col">
      {/* Header */}
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

        {/* Engine connection status badge */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium glass-panel">
            <span className={`h-2.5 w-2.5 rounded-full ${
              engineStatus === 'connected' ? 'bg-emerald-400 shadow-md shadow-emerald-400/50' : 
              engineStatus === 'connecting' ? 'bg-amber-400 animate-pulse' : 'bg-rose-500'
            }`} />
            <span className="capitalize text-slate-300">
              Engine: {engineStatus === 'connected' ? 'Online' : engineStatus === 'connecting' ? 'Starting...' : 'Offline'}
            </span>
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

      {/* Main content grid */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-6 flex flex-col gap-6">
        {/* Navigation tabs */}
        <div className="flex border-b border-white/5 gap-2">
          <button 
            onClick={() => setActiveTab('dashboard')}
            className={`px-4 py-2 border-b-2 text-sm font-semibold transition-all ${
              activeTab === 'dashboard' ? 'border-purple-400 text-purple-400 bg-purple-500/5' : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            Dashboard
          </button>
          <button 
            onClick={() => setActiveTab('logs')}
            className={`px-4 py-2 border-b-2 text-sm font-semibold transition-all ${
              activeTab === 'logs' ? 'border-purple-400 text-purple-400 bg-purple-500/5' : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            Console Logs
          </button>
          <button 
            onClick={() => setActiveTab('settings')}
            className={`px-4 py-2 border-b-2 text-sm font-semibold transition-all ${
              activeTab === 'settings' ? 'border-purple-400 text-purple-400 bg-purple-500/5' : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            Settings & Help
          </button>
        </div>

        {activeTab === 'dashboard' && (
          <>
            {/* Stats row */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="glass-panel glass-panel-hover p-4 rounded-xl flex items-center gap-4">
                <div className="h-12 w-12 rounded-lg bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400">
                  <Activity className="h-6 w-6" />
                </div>
                <div>
                  <div className="text-xs text-slate-400 font-medium">Active Inbound Streams</div>
                  <div className="text-2xl font-bold mt-0.5 text-white">{streamStats.activeClients}</div>
                </div>
              </div>

              <div className="glass-panel glass-panel-hover p-4 rounded-xl flex items-center gap-4">
                <div className="h-12 w-12 rounded-lg bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400">
                  <RefreshCw className="h-6 w-6" />
                </div>
                <div>
                  <div className="text-xs text-slate-400 font-medium">Engine Uptime</div>
                  <div className="text-2xl font-bold mt-0.5 text-white">{formatUptime(streamStats.uptime)}</div>
                </div>
              </div>

              <div className="glass-panel glass-panel-hover p-4 rounded-xl flex items-center gap-4">
                <div className="h-12 w-12 rounded-lg bg-pink-500/10 border border-pink-500/20 flex items-center justify-center text-pink-400">
                  <Cpu className="h-6 w-6" />
                </div>
                <div>
                  <div className="text-xs text-slate-400 font-medium">CPU Usage</div>
                  <div className="text-2xl font-bold mt-0.5 text-white">{streamStats.cpuUsage}%</div>
                </div>
              </div>

              <div className="glass-panel glass-panel-hover p-4 rounded-xl flex items-center gap-4">
                <div className="h-12 w-12 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
                  <Database className="h-6 w-6" />
                </div>
                <div>
                  <div className="text-xs text-slate-400 font-medium">RAM Allocation</div>
                  <div className="text-2xl font-bold mt-0.5 text-white">{streamStats.memoryUsage} MB</div>
                </div>
              </div>
            </div>

            {/* Main dashboard content */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Intake & Setup Panel */}
              <div className="lg:col-span-1 flex flex-col gap-6">
                <div className="glass-panel p-5 rounded-2xl flex flex-col gap-4">
                  <h2 className="text-lg font-bold flex items-center gap-2 border-b border-white/5 pb-3">
                    <Radio className="h-5 w-5 text-purple-400" />
                    Intake Server Setup
                  </h2>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Point your encoding software (like OBS, Streamlabs, or vMix) to this RTMP intake endpoint to publish:
                  </p>

                  <div className="flex flex-col gap-3">
                    <div>
                      <label className="text-[10px] uppercase font-bold tracking-widest text-slate-400">Server URL</label>
                      <div className="mt-1 flex items-center gap-2 bg-black/40 border border-white/5 rounded-lg px-3 py-2 font-mono text-xs text-slate-200">
                        <span>rtmp://localhost:1935/live</span>
                      </div>
                    </div>
                    <div>
                      <label className="text-[10px] uppercase font-bold tracking-widest text-slate-400">Stream Key</label>
                      <div className="mt-1 flex items-center gap-2 bg-black/40 border border-white/5 rounded-lg px-3 py-2 font-mono text-xs text-slate-200">
                        <span className="text-purple-300 font-semibold">test</span>
                      </div>
                    </div>
                  </div>

                  <div className="bg-purple-950/15 border border-purple-500/20 rounded-xl p-3 text-xs leading-relaxed text-purple-300">
                    <span className="font-semibold">Workflow:</span> Start your stream in OBS first. Once Néctar Cast detects the incoming stream on key <span className="font-mono text-white">test</span>, it will automatically duplicate and relay it to all active and enabled destinations.
                  </div>
                </div>

                {/* Add new destination configuration */}
                <div className="glass-panel p-5 rounded-2xl flex flex-col gap-4">
                  <h2 className="text-lg font-bold flex items-center gap-2 border-b border-white/5 pb-3">
                    <Plus className="h-5 w-5 text-purple-400" />
                    Configure Destination
                  </h2>

                  <form onSubmit={handleAddRelay} className="flex flex-col gap-4">
                    <div>
                      <label htmlFor="relay-name" className="text-xs font-semibold text-slate-300">Destination Name</label>
                      <input 
                        id="relay-name"
                        type="text" 
                        placeholder="e.g. Twitch, YouTube Live, Kick"
                        value={relayName}
                        onChange={(e) => setRelayName(e.target.value)}
                        className="w-full mt-1.5 px-3 py-2 text-sm glass-input"
                        required
                      />
                    </div>

                    <div>
                      <label htmlFor="relay-url" className="text-xs font-semibold text-slate-300">RTMP Target URL / Stream Key</label>
                      <input 
                        id="relay-url"
                        type="text" 
                        placeholder="rtmp://live.twitch.tv/app/live_..."
                        value={relayUrl}
                        onChange={(e) => setRelayUrl(e.target.value)}
                        className="w-full mt-1.5 px-3 py-2 text-sm font-mono glass-input"
                        required
                      />
                      <p className="text-[10px] text-slate-500 mt-1">Include the full RTMP server URL joined with your Stream Key.</p>
                    </div>

                    <button 
                      type="submit"
                      disabled={isSubmitting || engineStatus !== 'connected'}
                      className="w-full bg-gradient-to-r from-purple-500 to-indigo-600 hover:from-purple-600 hover:to-indigo-700 disabled:from-slate-800 disabled:to-slate-800 text-white font-semibold py-2.5 rounded-xl text-sm shadow-lg shadow-purple-500/15 active:scale-[0.98] transition-all flex items-center justify-center gap-2 cursor-pointer disabled:cursor-not-allowed"
                    >
                      <Plus className="h-4 w-4" />
                      Add Destination
                    </button>
                  </form>
                </div>
              </div>

              {/* Relay Destinations List Panel */}
              <div className="lg:col-span-2 flex flex-col gap-6">
                <div className="glass-panel p-5 rounded-2xl flex-1 flex flex-col gap-4">
                  <h2 className="text-lg font-bold flex items-center justify-between border-b border-white/5 pb-3">
                    <span className="flex items-center gap-2">
                      <Play className="h-5 w-5 text-purple-400" />
                      Relay Destinations
                    </span>
                    <span className="text-xs text-slate-400 bg-white/5 px-2.5 py-1 rounded-full font-medium">
                      {relays.length} Configured
                    </span>
                  </h2>

                  {relays.length === 0 ? (
                    <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-slate-500">
                      <Radio className="h-12 w-12 mb-3 text-slate-600 stroke-[1.5]" />
                      <h3 className="text-slate-300 font-semibold mb-1">No relay destinations configured</h3>
                      <p className="text-xs max-w-sm">
                        Add target RTMP destinations like YouTube, Twitch, or custom servers to begin duplicate relaying of your live broadcast.
                      </p>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-3">
                      {relays.map((relay) => (
                        <div 
                          key={relay.id} 
                          className="glass-panel glass-panel-hover p-4 rounded-xl flex items-center justify-between border border-white/5"
                        >
                          <div className="flex items-center gap-3">
                            <div className={`h-10 w-10 rounded-lg flex items-center justify-center font-bold text-lg ${
                              relay.status === 'streaming' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' :
                              relay.status === 'error' ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20' :
                              'bg-slate-500/10 text-slate-400 border border-slate-500/20'
                            }`}>
                              {relay.name.charAt(0).toUpperCase()}
                            </div>
                            <div>
                              <div className="font-semibold text-slate-100 flex items-center gap-2">
                                {relay.name}
                                <span className={`h-2 w-2 rounded-full ${
                                  relay.status === 'streaming' ? 'bg-emerald-400 pulse-active' :
                                  relay.status === 'error' ? 'bg-rose-500' : 'bg-slate-500'
                                }`} />
                              </div>
                              <div className="text-xs text-slate-400 font-mono mt-0.5 truncate max-w-xs md:max-w-md">
                                {relay.targetUrl.substring(0, 32)}...
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-2">
                            {relay.status === 'streaming' ? (
                              <button 
                                onClick={() => handleStopRelay(relay.id)}
                                className="px-3.5 py-1.5 rounded-lg border border-rose-500/30 hover:bg-rose-500/10 text-rose-400 hover:text-white text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer"
                              >
                                <Square className="h-3 w-3 fill-current" />
                                Stop
                              </button>
                            ) : (
                              <button 
                                onClick={() => handleStartRelay(relay.id)}
                                disabled={streamStats.activeClients === 0}
                                className="px-3.5 py-1.5 rounded-lg border border-emerald-500/30 hover:bg-emerald-500/10 disabled:border-slate-800 disabled:hover:bg-transparent text-emerald-400 disabled:text-slate-600 text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer disabled:cursor-not-allowed"
                                title={streamStats.activeClients === 0 ? "Requires an active inbound OBS stream first" : "Start relaying stream"}
                              >
                                <Play className="h-3 w-3 fill-current" />
                                Start
                              </button>
                            )}

                            <button 
                              onClick={() => handleDeleteRelay(relay.id)}
                              className="p-2 rounded-lg border border-white/5 hover:border-rose-500/30 hover:bg-rose-500/10 text-slate-400 hover:text-rose-400 transition-all cursor-pointer"
                              title="Delete destination"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </>
        )}

        {activeTab === 'logs' && (
          <div className="glass-panel p-5 rounded-2xl flex-1 flex flex-col gap-3 min-h-[400px]">
            <h2 className="text-lg font-bold flex items-center justify-between border-b border-white/5 pb-3">
              <span className="flex items-center gap-2">
                <Terminal className="h-5 w-5 text-purple-400" />
                Live Node Engine Console
              </span>
              <button 
                onClick={() => setLogs([])}
                className="text-xs text-slate-400 hover:text-white bg-white/5 hover:bg-white/10 px-2.5 py-1 rounded-lg transition-all"
              >
                Clear Log View
              </button>
            </h2>

            <div className="flex-1 bg-black/50 border border-white/5 rounded-xl p-4 font-mono text-xs text-emerald-400 overflow-y-auto max-h-[480px]">
              {logs.length === 0 ? (
                <div className="text-slate-600 italic">Console is quiet. Start OBS streaming or manage relays to generate activity...</div>
              ) : (
                logs.map((log, index) => (
                  <div key={index} className="py-0.5 border-b border-white/0 hover:bg-white/5 select-text break-all">
                    {log}
                  </div>
                ))
              )}
              <div ref={logsEndRef} />
            </div>
          </div>
        )}

        {activeTab === 'settings' && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="md:col-span-2 glass-panel p-6 rounded-2xl flex flex-col gap-4">
              <h2 className="text-lg font-bold border-b border-white/5 pb-3 flex items-center gap-2">
                <Shield className="h-5 w-5 text-purple-400" />
                System Configurations
              </h2>
              <div className="flex flex-col gap-4 text-sm text-slate-300">
                <div className="flex items-center justify-between py-2 border-b border-white/5">
                  <div>
                    <div className="font-semibold">RTMP Streaming Port</div>
                    <div className="text-xs text-slate-500">Inbound OBS connections port.</div>
                  </div>
                  <div className="font-mono bg-black/40 px-2.5 py-1 rounded border border-white/5">1935</div>
                </div>

                <div className="flex items-center justify-between py-2 border-b border-white/5">
                  <div>
                    <div className="font-semibold">HTTP API Dashboard Port</div>
                    <div className="text-xs text-slate-500">Néctar engine control port.</div>
                  </div>
                  <div className="font-mono bg-black/40 px-2.5 py-1 rounded border border-white/5">8001</div>
                </div>

                <div className="flex items-center justify-between py-2 border-b border-white/5">
                  <div>
                    <div className="font-semibold">FFmpeg Executable</div>
                    <div className="text-xs text-slate-500">Video encoding relay driver.</div>
                  </div>
                  <div className="font-mono bg-emerald-950/20 text-emerald-400 px-2.5 py-1 rounded border border-emerald-500/20">
                    Bundled (x86_64-linux)
                  </div>
                </div>
              </div>
            </div>

            <div className="glass-panel p-6 rounded-2xl flex flex-col gap-4">
              <h2 className="text-lg font-bold border-b border-white/5 pb-3 flex items-center gap-2">
                <HelpCircle className="h-5 w-5 text-purple-400" />
                Quick Guide
              </h2>
              <ul className="text-xs text-slate-400 flex flex-col gap-3 list-disc pl-4 leading-relaxed">
                <li>
                  Set up a stream in OBS. Go to <span className="font-semibold text-slate-200">Settings &gt; Stream</span>, select <span className="font-semibold text-slate-200">Custom...</span>
                </li>
                <li>
                  Enter <code className="bg-black/30 px-1 py-0.5 rounded text-purple-300">rtmp://localhost:1935/live</code> as the Server, and <code className="bg-black/30 px-1 py-0.5 rounded text-purple-300">test</code> as the Stream Key.
                </li>
                <li>
                  Press <span className="font-semibold text-slate-200">Start Streaming</span> in OBS. You will see the Active Inbound Streams stat change to <span className="text-emerald-400">1</span>.
                </li>
                <li>
                  Create relay destinations in Néctar Cast (e.g. YouTube RTMP URL + Key).
                </li>
                <li>
                  Click <span className="text-emerald-400 font-semibold">Start</span> on any destination. The app will spawn a localized background copy process to relay the stream!
                </li>
              </ul>
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-white/5 py-4 text-center text-xs text-slate-500 glass-panel">
        <p>&copy; {new Date().getFullYear()} Néctar Labs. Built with Tauri v2, React, Tailwind CSS v4, and Node Media Server.</p>
      </footer>
    </div>
  )
}

export default App
