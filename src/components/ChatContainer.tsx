// Componente React para la integración del chat unificado de YouTube, Facebook, Instagram, Twitch y TikTok.
// Permite a los streamers gestionar credenciales locales, simular transmisiones en vivo
// y consolidar los mensajes de múltiples plataformas en un único feed visual.
// Además, expone un enlace de superposición dinámico que se puede añadir directamente a OBS.

import React, { useState, useEffect, useRef } from 'react';
import { 
  Youtube, Facebook, Instagram, Twitch, Volume2, VolumeX, 
  Settings as SettingsIcon, MessageSquare, ShieldAlert, Sparkles, Check, Copy
} from 'lucide-react';

// Icono personalizado para TikTok
const TiktokIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor">
    <path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.17-2.89-.74-3.94-1.78-.22-.22-.41-.47-.58-.73v7.02c0 3.76-3.07 6.86-6.96 6.82-3.86-.03-6.9-3.23-6.79-7.1.09-3.41 2.85-6.26 6.27-6.4 1.17-.05 1.17 1.77 0 1.82-2.44.1-4.48 2.05-4.49 4.54-.02 2.79 2.4 5.09 5.21 4.9 2.45-.16 4.31-2.22 4.31-4.7v-11.6c.01-1.02-.01-2.04.02-3.06z"/>
  </svg>
);

// Interfaz para representar un mensaje unificado en la interfaz
interface ChatMessage {
  id: string;
  user: string;
  text: string;
  platform: 'youtube' | 'facebook' | 'instagram' | 'twitch' | 'tiktok' | string;
  timestamp: string;
}

// Propiedades recibidas por el contenedor de chat (incluye controles de voz desde el hook)
interface ChatContainerProps {
  onNewMessage: (user: string, text: string, platform: string) => void;
  ttsEnabled: boolean;
  setTtsEnabled: (enabled: boolean) => void;
  ttsVolume: number;
  setTtsVolume: (v: number) => void;
  ttsRate: number;
  setTtsRate: (r: number) => void;
  ttsPitch: number;
  setTtsPitch: (p: number) => void;
  ttsVoiceURI: string;
  setTtsVoiceURI: (uri: string) => void;
  ttsVoices: SpeechSynthesisVoice[];
  httpApiPort: number;
}

export const ChatContainer: React.FC<ChatContainerProps> = ({ 
  onNewMessage, 
  ttsEnabled, 
  setTtsEnabled,
  ttsVolume,
  setTtsVolume,
  ttsRate,
  setTtsRate,
  ttsPitch,
  setTtsPitch,
  ttsVoiceURI,
  setTtsVoiceURI,
  ttsVoices,
  httpApiPort
}) => {
  // Lista de mensajes activos en el feed
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  // Controla si el simulador de comentarios está activo o no
  const [isSimulating, setIsSimulating] = useState(false);
  // Controla la visibilidad del modal de configuraciones de API/Visuales
  const [showConfig, setShowConfig] = useState(false);
  // Pestaña activa del modal de configuración ('obs' | 'apis' | 'tts')
  const [activeSettingsTab, setActiveSettingsTab] = useState<'obs' | 'apis' | 'tts'>('obs');

  // Estados de configuración de las APIs de origen
  const [ytApiKey, setYtApiKey] = useState(() => localStorage.getItem('nectar_yt_api_key') || '');
  const [ytLiveChatId, setYtLiveChatId] = useState(() => localStorage.getItem('nectar_yt_chat_id') || '');
  const [fbPostId, setFbPostId] = useState(() => localStorage.getItem('nectar_fb_post_id') || '');
  const [fbToken, setFbToken] = useState(() => localStorage.getItem('nectar_fb_token') || '');
  const [igMediaId, setIgMediaId] = useState(() => localStorage.getItem('nectar_ig_media_id') || '');
  const [igToken, setIgToken] = useState(() => localStorage.getItem('nectar_ig_token') || '');

  // Ajustes Visuales de la Interfaz y el Overlay de OBS
  const [fontSize, setFontSize] = useState(() => localStorage.getItem('nectar_chat_fontsize') || 'sm');
  const [charLimit, setCharLimit] = useState(() => parseInt(localStorage.getItem('nectar_chat_charlimit') || '100'));
  const [userLimit, setUserLimit] = useState(() => parseInt(localStorage.getItem('nectar_chat_userlimit') || '15'));
  const [showEmojis, setShowEmojis] = useState(() => localStorage.getItem('nectar_chat_showemojis') !== 'false');
  const [showTimestamp, setShowTimestamp] = useState(() => localStorage.getItem('nectar_chat_showtimestamp') !== 'false');
  const [theme, setTheme] = useState(() => localStorage.getItem('nectar_chat_theme') || 'glass');
  const [visiblePlatforms, setVisiblePlatforms] = useState<string[]>(() => {
    const saved = localStorage.getItem('nectar_chat_platforms');
    return saved ? JSON.parse(saved) : ['youtube', 'facebook', 'instagram', 'twitch', 'tiktok'];
  });

  // Estado para controlar el feedback visual de copiado
  const [copyFeedback, setCopyFeedback] = useState(false);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const simulationIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Hace scroll automático al último mensaje recibido cuando el feed de chat se actualiza
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Persistir configuraciones visuales en localStorage
  useEffect(() => {
    localStorage.setItem('nectar_chat_fontsize', fontSize);
  }, [fontSize]);

  useEffect(() => {
    localStorage.setItem('nectar_chat_charlimit', charLimit.toString());
  }, [charLimit]);

  useEffect(() => {
    localStorage.setItem('nectar_chat_userlimit', userLimit.toString());
  }, [userLimit]);

  useEffect(() => {
    localStorage.setItem('nectar_chat_showemojis', showEmojis.toString());
  }, [showEmojis]);

  useEffect(() => {
    localStorage.setItem('nectar_chat_showtimestamp', showTimestamp.toString());
  }, [showTimestamp]);

  useEffect(() => {
    localStorage.setItem('nectar_chat_theme', theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem('nectar_chat_platforms', JSON.stringify(visiblePlatforms));
  }, [visiblePlatforms]);

  // Guarda las configuraciones de red de manera local y cierra el modal
  const saveConfig = (e: React.FormEvent) => {
    e.preventDefault();
    localStorage.setItem('nectar_yt_api_key', ytApiKey);
    localStorage.setItem('nectar_yt_chat_id', ytLiveChatId);
    localStorage.setItem('nectar_fb_post_id', fbPostId);
    localStorage.setItem('nectar_fb_token', fbToken);
    localStorage.setItem('nectar_ig_media_id', igMediaId);
    localStorage.setItem('nectar_ig_token', igToken);
    setShowConfig(false);
  };

  // Reemplazo automático de emoticonos de texto por sus correspondientes emojis coloridos
  const replaceEmoticons = (text: string) => {
    if (!showEmojis) return text;
    const emoticonsMap: { [key: string]: string } = {
      ':\\)': '😊',
      ':D': '😃',
      ':\\(': '😢',
      '<3': '❤️',
      ';\\)': '😉',
      'B\\)': '😎',
      ':o': '😮',
      ':P': '😛',
      ':/': '😕'
    };
    let formatted = text;
    for (const [key, emoji] of Object.entries(emoticonsMap)) {
      const regex = new RegExp(key, 'g');
      formatted = formatted.replace(regex, emoji);
    }
    return formatted;
  };

  // Limpieza opcional de emojis nativos si showEmojis está apagado
  const formatText = (text: string) => {
    let output = replaceEmoticons(text);
    if (!showEmojis) {
      // Elimina cualquier emoji del texto usando regex
      output = output.replace(/([\u2700-\u27BF]|[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDD10-\uDDFF])/g, '');
    }
    // Truncado de caracteres
    if (charLimit > 0 && output.length > charLimit) {
      output = output.substring(0, charLimit) + '...';
    }
    return output;
  };

  const formatUsername = (username: string) => {
    if (userLimit > 0 && username.length > userLimit) {
      return username.substring(0, userLimit) + '...';
    }
    return username;
  };

  // Base de datos de comentarios ficticios para el modo simulador
  const mockComments = [
    { user: 'Juan_Gamer', text: '¡Excelente calidad de transmisión! :)', platform: 'youtube' },
    { user: 'MariaRojas', text: 'Saludos desde Costa Rica, buen stream 🚀 <3', platform: 'facebook' },
    { user: 'karen.v', text: '¿Qué cámara estás usando? Se ve súper nítido :D', platform: 'instagram' },
    { user: 'Luis_dev', text: 'Néctar Cast funciona increíble con cero lag ;)', platform: 'youtube' },
    { user: 'Carlos_Alvarez', text: '¡Buenísima jugada en esa partida! B)', platform: 'facebook' },
    { user: 'andrea_streams', text: '¡Síganlo para más lives! :o', platform: 'instagram' },
    { user: 'xQc_Gamer', text: 'Kappa! PogChamp epic gaming moment right here!', platform: 'twitch' },
    { user: 'sofi.code', text: 'Amo el diseño oscuro de tu app :)', platform: 'instagram' },
    { user: 'tiktok_foryou', text: 'Este directo se va a hacer súper viral 🔥', platform: 'tiktok' }
  ];

  // Alterna el estado del simulador de chat en vivo local
  const toggleSimulation = () => {
    if (isSimulating) {
      if (simulationIntervalRef.current) {
        clearInterval(simulationIntervalRef.current);
        simulationIntervalRef.current = null;
      }
      setIsSimulating(false);
    } else {
      setIsSimulating(true);
      sendMockComment(); // Dispara un comentario inmediatamente
      simulationIntervalRef.current = setInterval(() => {
        sendMockComment();
      }, 4000);
    }
  };

  // Genera un comentario aleatorio, lo envía al motor local de fondo y dispara el callback de voz (TTS)
  const sendMockComment = async () => {
    const randomComment = mockComments[Math.floor(Math.random() * mockComments.length)];
    const newMessage: ChatMessage = {
      id: Math.random().toString(),
      user: randomComment.user,
      text: randomComment.text,
      platform: randomComment.platform,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    };

    setMessages(prev => [...prev, newMessage]);
    onNewMessage(randomComment.user, randomComment.text, randomComment.platform);

    // Sincronizar mensaje con el motor local
    try {
      await fetch(`http://localhost:${httpApiPort}/api/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newMessage)
      });
    } catch (e) {
      console.warn('[Overlay Server] Failed to sync simulated message:', e);
    }
  };

  // Efecto que controla las llamadas de sondeo (polling) de APIs reales
  useEffect(() => {
    let ytInterval: NodeJS.Timeout;
    
    if (ytApiKey && ytLiveChatId) {
      const pollYoutube = async () => {
        try {
          const res = await fetch(
            `https://www.googleapis.com/youtube/v3/liveChat/messages?liveChatId=${ytLiveChatId}&part=snippet,authorDetails&key=${ytApiKey}`
          );
          if (res.ok) {
            const data = await res.json();
            const newYtMsgs = (data.items || []).map((item: any) => ({
              id: item.id,
              user: item.authorDetails.displayName,
              text: item.snippet.displayMessage,
              platform: 'youtube' as const,
              timestamp: new Date(item.snippet.publishedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
            }));
            
            // Deduplica mensajes por ID único para evitar repetirlos en pantalla o voz
            setMessages(prev => {
              const existingIds = new Set(prev.map(m => m.id));
              const uniqueNew = newYtMsgs.filter((m: any) => !existingIds.has(m.id));
              
              // Dispara la lectura de voz para cada nuevo mensaje único recibido y sincroniza con el motor
              uniqueNew.forEach(async (m: any) => {
                onNewMessage(m.user, m.text, 'YouTube');
                try {
                  await fetch(`http://localhost:${httpApiPort}/api/messages`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(m)
                  });
                } catch (e) {
                  console.warn('[Overlay Server] Failed to sync YouTube message:', e);
                }
              });
              return [...prev, ...uniqueNew];
            });
          }
        } catch (e) {
          console.error('Error polling YouTube chat:', e);
        }
      };
      ytInterval = setInterval(pollYoutube, 5000);
    }

    return () => {
      if (ytInterval) clearInterval(ytInterval);
      if (simulationIntervalRef.current) clearInterval(simulationIntervalRef.current);
    };
  }, [ytApiKey, ytLiveChatId, httpApiPort]);

  // Alternar visibilidad de una plataforma en el feed
  const togglePlatform = (platform: string) => {
    if (visiblePlatforms.includes(platform)) {
      if (visiblePlatforms.length > 1) {
        setVisiblePlatforms(prev => prev.filter(p => p !== platform));
      }
    } else {
      setVisiblePlatforms(prev => [...prev, platform]);
    }
  };

  // Genera el enlace de OBS Browser Source
  const getObsOverlayUrl = () => {
    return `http://localhost:${httpApiPort}/overlay?fontSize=${fontSize}&theme=${theme}&platforms=${visiblePlatforms.join(',')}&showEmojis=${showEmojis}&limit=12`;
  };

  const handleCopyObsUrl = () => {
    navigator.clipboard.writeText(getObsOverlayUrl());
    setCopyFeedback(true);
    setTimeout(() => setCopyFeedback(false), 2000);
  };

  // Filtra los mensajes a mostrar en el feed de React
  const displayedMessages = messages.filter(m => visiblePlatforms.includes(m.platform));

  // Clases CSS de tamaño de fuente
  const fontSizeClass = 
    fontSize === 'xs' ? 'text-[10px]' :
    fontSize === 'sm' ? 'text-xs' :
    fontSize === 'md' ? 'text-sm' :
    fontSize === 'lg' ? 'text-base' : 'text-lg';

  return (
    <div className="flex-1 flex flex-col glass-panel rounded-2xl overflow-hidden border border-white/5 h-full relative">
      
      {/* Barra de cabecera con controles rápidos de chat */}
      <div className="px-5 py-4 border-b border-white/5 flex items-center justify-between bg-white/[0.02]">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-5 w-5 text-purple-400" />
          <h2 className="text-sm font-bold tracking-wide text-white uppercase">Unified Live Chat</h2>
        </div>

        <div className="flex items-center gap-2">
          {/* Alternador de lectura de Voz (TTS) */}
          <button 
            onClick={() => setTtsEnabled(!ttsEnabled)}
            className={`p-2 rounded-lg border flex items-center justify-center transition-all cursor-pointer ${
              ttsEnabled 
                ? 'bg-purple-500/20 border-purple-500/40 text-purple-400 hover:bg-purple-500/30' 
                : 'border-white/5 text-slate-400 hover:bg-white/5 hover:text-white'
            }`}
            title={ttsEnabled ? "Disable Text-To-Speech (Voz)" : "Enable Text-To-Speech (Voz)"}
          >
            {ttsEnabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
          </button>

          {/* Botón del Simulador de chat */}
          <button 
            onClick={toggleSimulation}
            className={`px-3 py-1.5 rounded-lg border text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
              isSimulating 
                ? 'bg-cyan-500/20 border-cyan-500/40 text-cyan-400 hover:bg-cyan-500/30' 
                : 'border-white/5 text-slate-400 hover:bg-white/5 hover:text-white'
            }`}
          >
            <Sparkles className="h-3 w-3" />
            {isSimulating ? 'Simulating' : 'Simulate'}
          </button>

          {/* Botón para abrir el panel de configuración */}
          <button 
            onClick={() => { setShowConfig(!showConfig); setActiveSettingsTab('obs'); }}
            className="p-2 rounded-lg border border-white/5 hover:bg-white/5 text-slate-400 hover:text-white transition-all cursor-pointer"
            title="Chat integration API settings"
          >
            <SettingsIcon className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Caja contenedora del flujo de comentarios */}
      <div className="flex-1 p-5 overflow-y-auto flex flex-col gap-3 min-h-[300px] max-h-[500px]">
        {displayedMessages.length === 0 ? (
          // Vista vacía (feed listo)
          <div className="flex-1 flex flex-col items-center justify-center text-center p-8 text-slate-500">
            <MessageSquare className="h-10 w-10 mb-2 stroke-[1.5] text-slate-600" />
            <div className="text-slate-300 font-semibold mb-1">Feed is ready</div>
            <p className="text-xs max-w-[200px]">
              Turn on "Simulate" to test or configure real API keys.
            </p>
          </div>
        ) : (
          // Renderizado dinámico de tarjetas de comentarios
          displayedMessages.map((msg) => {
            // Configura los colores estéticos y el ícono según la plataforma
            let icon = <Youtube className="h-3.5 w-3.5" />;
            let badgeStyle = 'bg-rose-500/10 text-rose-400 border-rose-500/20';
            let platformLabel = 'YouTube';

            if (msg.platform === 'facebook') {
              icon = <Facebook className="h-3.5 w-3.5" />;
              badgeStyle = 'bg-blue-500/10 text-blue-400 border-blue-500/20';
              platformLabel = 'Facebook';
            } else if (msg.platform === 'instagram') {
              icon = <Instagram className="h-3.5 w-3.5" />;
              badgeStyle = 'bg-pink-500/10 text-pink-400 border-pink-500/20';
              platformLabel = 'Instagram';
            } else if (msg.platform === 'twitch') {
              icon = <Twitch className="h-3.5 w-3.5" />;
              badgeStyle = 'bg-purple-500/10 text-purple-400 border-purple-500/20';
              platformLabel = 'Twitch';
            } else if (msg.platform === 'tiktok') {
              icon = <TiktokIcon className="h-3.5 w-3.5" />;
              badgeStyle = 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20';
              platformLabel = 'TikTok';
            } else {
              icon = <MessageSquare className="h-3.5 w-3.5" />;
              badgeStyle = 'bg-slate-500/10 text-slate-400 border-slate-500/20';
              platformLabel = msg.platform.charAt(0).toUpperCase() + msg.platform.slice(1);
            }

            return (
              <div 
                key={msg.id} 
                className="glass-panel p-3 rounded-xl border border-white/5 flex flex-col gap-1 hover:bg-white/[0.01] transition-all"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {/* Badge identificador de red social */}
                    <span className={`flex items-center gap-1px px-2 py-0.5 rounded-full border text-[10px] font-semibold tracking-wide ${badgeStyle}`}>
                      {icon}
                      <span className="ml-1">{platformLabel}</span>
                    </span>
                    <span className="font-bold text-xs text-slate-200">{formatUsername(msg.user)}</span>
                  </div>
                  {showTimestamp && (
                    <span className="text-[10px] text-slate-500 font-mono">{msg.timestamp}</span>
                  )}
                </div>
                <p className={`${fontSizeClass} text-slate-300 ml-1 mt-0.5 leading-relaxed`}>
                  {formatText(msg.text)}
                </p>
              </div>
            );
          })
        )}
        {/* Div utilizado como ancla para hacer scroll automático */}
        <div ref={chatEndRef} />
      </div>

      {/* Cajón de configuración (Modal de claves y visual) */}
      {showConfig && (
        <div className="absolute inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className="glass-panel max-w-md w-full p-6 rounded-2xl border border-white/10 flex flex-col gap-4 max-h-[95%] overflow-y-auto">
            
            {/* Cabecera del Modal */}
            <div className="flex items-center justify-between border-b border-white/5 pb-3">
              <h3 className="font-bold text-base text-white flex items-center gap-2">
                <SettingsIcon className="h-5 w-5 text-purple-400 animate-spin-slow" />
                Néctar Chat Settings
              </h3>
              <button 
                onClick={() => setShowConfig(false)}
                className="text-slate-400 hover:text-white font-semibold text-xs px-2.5 py-1 bg-white/5 hover:bg-white/10 rounded-lg transition"
              >
                Close
              </button>
            </div>

            {/* Pestañas internas del Modal */}
            <div className="flex border-b border-white/5 gap-1 mb-2">
              <button 
                type="button"
                onClick={() => setActiveSettingsTab('obs')}
                className={`flex-1 py-1.5 text-xs font-bold border-b-2 transition-all ${
                  activeSettingsTab === 'obs' ? 'border-purple-400 text-purple-400 bg-purple-500/5' : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                OBS Overlay
              </button>
              <button 
                type="button"
                onClick={() => setActiveSettingsTab('apis')}
                className={`flex-1 py-1.5 text-xs font-bold border-b-2 transition-all ${
                  activeSettingsTab === 'apis' ? 'border-purple-400 text-purple-400 bg-purple-500/5' : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                API Keys
              </button>
              <button 
                type="button"
                onClick={() => setActiveSettingsTab('tts')}
                className={`flex-1 py-1.5 text-xs font-bold border-b-2 transition-all ${
                  activeSettingsTab === 'tts' ? 'border-purple-400 text-purple-400 bg-purple-500/5' : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                Voz (TTS)
              </button>
            </div>

            {/* Contenidos según pestaña activa */}
            {activeSettingsTab === 'obs' && (
              <div className="flex flex-col gap-4 text-xs">
                
                {/* Copiar enlace OBS */}
                <div className="bg-purple-950/10 border border-purple-500/10 rounded-xl p-3.5 flex flex-col gap-2">
                  <h4 className="font-bold text-purple-300 flex items-center gap-1.5">
                    <Sparkles className="h-4 w-4 text-purple-400" />
                    OBS Browser Source URL
                  </h4>
                  <p className="text-[10.5px] text-slate-400 leading-relaxed">
                    Copy this URL and add it as a new **Browser Source** in OBS Studio. Use `350`px width and `600`px height.
                  </p>
                  
                  <div className="mt-1 flex gap-2">
                    <input 
                      type="text" 
                      readOnly 
                      value={getObsOverlayUrl()} 
                      className="flex-1 px-3 py-1.5 text-[11px] font-mono glass-input select-all" 
                    />
                    <button 
                      onClick={handleCopyObsUrl}
                      className={`px-3 py-1.5 rounded-lg border font-semibold flex items-center justify-center gap-1.5 transition active:scale-95 cursor-pointer ${
                        copyFeedback 
                          ? 'bg-emerald-500/20 border-emerald-500/30 text-emerald-400' 
                          : 'bg-purple-500/20 border-purple-500/30 text-purple-400 hover:bg-purple-500/30'
                      }`}
                    >
                      {copyFeedback ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                      {copyFeedback ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                </div>

                {/* Filtro de Plataformas */}
                <div className="flex flex-col gap-2">
                  <span className="font-bold text-slate-300">Platforms Filter</span>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                    <button 
                      onClick={() => togglePlatform('youtube')}
                      className={`py-1.5 px-2 border rounded-xl font-semibold flex items-center justify-center gap-1.5 transition cursor-pointer ${
                        visiblePlatforms.includes('youtube') 
                          ? 'bg-rose-500/20 border-rose-500/40 text-rose-400' 
                          : 'border-white/5 text-slate-500 hover:text-slate-400'
                      }`}
                    >
                      <Youtube className="h-3.5 w-3.5" />
                      YouTube
                    </button>

                    <button 
                      onClick={() => togglePlatform('facebook')}
                      className={`py-1.5 px-2 border rounded-xl font-semibold flex items-center justify-center gap-1.5 transition cursor-pointer ${
                        visiblePlatforms.includes('facebook') 
                          ? 'bg-blue-500/20 border-blue-500/40 text-blue-400' 
                          : 'border-white/5 text-slate-500 hover:text-slate-400'
                      }`}
                    >
                      <Facebook className="h-3.5 w-3.5" />
                      Facebook
                    </button>

                    <button 
                      onClick={() => togglePlatform('instagram')}
                      className={`py-1.5 px-2 border rounded-xl font-semibold flex items-center justify-center gap-1.5 transition cursor-pointer ${
                        visiblePlatforms.includes('instagram') 
                          ? 'bg-pink-500/20 border-pink-500/40 text-pink-400' 
                          : 'border-white/5 text-slate-500 hover:text-slate-400'
                      }`}
                    >
                      <Instagram className="h-3.5 w-3.5" />
                      Instagram
                    </button>

                    <button 
                      onClick={() => togglePlatform('twitch')}
                      className={`py-1.5 px-2 border rounded-xl font-semibold flex items-center justify-center gap-1.5 transition cursor-pointer ${
                        visiblePlatforms.includes('twitch') 
                          ? 'bg-purple-500/20 border-purple-500/40 text-purple-400' 
                          : 'border-white/5 text-slate-500 hover:text-slate-400'
                      }`}
                    >
                      <Twitch className="h-3.5 w-3.5" />
                      Twitch
                    </button>

                    <button 
                      onClick={() => togglePlatform('tiktok')}
                      className={`py-1.5 px-2 border rounded-xl font-semibold flex items-center justify-center gap-1.5 transition cursor-pointer ${
                        visiblePlatforms.includes('tiktok') 
                          ? 'bg-cyan-500/20 border-cyan-500/40 text-cyan-400' 
                          : 'border-white/5 text-slate-500 hover:text-slate-400'
                      }`}
                    >
                      <TiktokIcon className="h-3.5 w-3.5" />
                      TikTok
                    </button>
                  </div>
                </div>

                {/* Estilos Visuales del Chat */}
                <div className="grid grid-cols-2 gap-3 mt-1">
                  
                  {/* Tamaño de Fuente */}
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="fontSize" className="font-semibold text-slate-300">Font Size</label>
                    <select 
                      id="fontSize"
                      value={fontSize} 
                      onChange={(e) => setFontSize(e.target.value)}
                      className="w-full px-2 py-1.5 glass-input"
                    >
                      <option value="xs">XS (Extra Small)</option>
                      <option value="sm">SM (Small)</option>
                      <option value="md">MD (Medium)</option>
                      <option value="lg">LG (Large)</option>
                      <option value="xl">XL (Extra Large)</option>
                    </select>
                  </div>

                  {/* Tema visual del overlay */}
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="theme" className="font-semibold text-slate-300">Overlay Theme</label>
                    <select 
                      id="theme"
                      value={theme} 
                      onChange={(e) => setTheme(e.target.value)}
                      className="w-full px-2 py-1.5 glass-input"
                    >
                      <option value="glass">Glassmorphism (Glass)</option>
                      <option value="dark">Deep Obsidian (Dark)</option>
                      <option value="bubble">Purple Left-Bubble</option>
                      <option value="minimal">Translucent Dark (Minimal)</option>
                    </select>
                  </div>

                  {/* Límite de Caracteres */}
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="charLimit" className="font-semibold text-slate-300">Character Limit (Text)</label>
                    <select 
                      id="charLimit"
                      value={charLimit} 
                      onChange={(e) => setCharLimit(parseInt(e.target.value))}
                      className="w-full px-2 py-1.5 glass-input"
                    >
                      <option value="50">50 Chars</option>
                      <option value="100">100 Chars</option>
                      <option value="200">200 Chars</option>
                      <option value="0">Unlimited (Complete)</option>
                    </select>
                  </div>

                  {/* Límite de Nombre */}
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="userLimit" className="font-semibold text-slate-300">User Name Limit</label>
                    <select 
                      id="userLimit"
                      value={userLimit} 
                      onChange={(e) => setUserLimit(parseInt(e.target.value))}
                      className="w-full px-2 py-1.5 glass-input"
                    >
                      <option value="10">10 Chars</option>
                      <option value="15">15 Chars</option>
                      <option value="20">20 Chars</option>
                      <option value="0">Unlimited</option>
                    </select>
                  </div>

                </div>

                {/* Toggles booleanos */}
                <div className="flex justify-between items-center border-t border-white/5 pt-3">
                  <div className="flex items-center gap-2">
                    <input 
                      type="checkbox" 
                      id="toggle-emojis" 
                      checked={showEmojis} 
                      onChange={(e) => setShowEmojis(e.target.checked)}
                      className="rounded border-white/10 bg-black/40 text-purple-500 focus:ring-purple-500 h-4 w-4"
                    />
                    <label htmlFor="toggle-emojis" className="font-semibold text-slate-300 select-none cursor-pointer">Replace Text to Emojis</label>
                  </div>

                  <div className="flex items-center gap-2">
                    <input 
                      type="checkbox" 
                      id="toggle-time" 
                      checked={showTimestamp} 
                      onChange={(e) => setShowTimestamp(e.target.checked)}
                      className="rounded border-white/10 bg-black/40 text-purple-500 focus:ring-purple-500 h-4 w-4"
                    />
                    <label htmlFor="toggle-time" className="font-semibold text-slate-300 select-none cursor-pointer">Show Timestamps</label>
                  </div>
                </div>

              </div>
            )}

            {activeSettingsTab === 'apis' && (
              <form onSubmit={saveConfig} className="flex flex-col gap-3">
                {/* Claves YouTube */}
                <div className="flex flex-col gap-2 p-3 bg-white/[0.01] border border-white/5 rounded-xl">
                  <h4 className="text-xs font-bold text-rose-400 uppercase tracking-widest flex items-center gap-1.5">
                    <Youtube className="h-4 w-4" />
                    YouTube Live Chat API
                  </h4>
                  <input 
                    type="password" 
                    placeholder="YouTube API Key"
                    value={ytApiKey}
                    onChange={(e) => setYtApiKey(e.target.value)}
                    className="w-full px-3 py-1.5 text-xs glass-input"
                  />
                  <input 
                    type="text" 
                    placeholder="Live Chat ID"
                    value={ytLiveChatId}
                    onChange={(e) => setYtLiveChatId(e.target.value)}
                    className="w-full px-3 py-1.5 text-xs glass-input font-mono"
                  />
                </div>

                {/* Claves Facebook */}
                <div className="flex flex-col gap-2 p-3 bg-white/[0.01] border border-white/5 rounded-xl">
                  <h4 className="text-xs font-bold text-blue-400 uppercase tracking-widest flex items-center gap-1.5">
                    <Facebook className="h-4 w-4" />
                    Facebook Live Comments API
                  </h4>
                  <input 
                    type="text" 
                    placeholder="Live Post ID"
                    value={fbPostId}
                    onChange={(e) => setFbPostId(e.target.value)}
                    className="w-full px-3 py-1.5 text-xs glass-input font-mono"
                  />
                  <input 
                    type="password" 
                    placeholder="Page Access Token"
                    value={fbToken}
                    onChange={(e) => setFbToken(e.target.value)}
                    className="w-full px-3 py-1.5 text-xs glass-input"
                  />
                </div>

                {/* Claves Instagram */}
                <div className="flex flex-col gap-2 p-3 bg-white/[0.01] border border-white/5 rounded-xl">
                  <h4 className="text-xs font-bold text-pink-400 uppercase tracking-widest flex items-center gap-1.5">
                    <Instagram className="h-4 w-4" />
                    Instagram Graph API
                  </h4>
                  <input 
                    type="text" 
                    placeholder="Live Media ID"
                    value={igMediaId}
                    onChange={(e) => setIgMediaId(e.target.value)}
                    className="w-full px-3 py-1.5 text-xs glass-input font-mono"
                  />
                  <input 
                    type="password" 
                    placeholder="User Access Token"
                    value={igToken}
                    onChange={(e) => setIgToken(e.target.value)}
                    className="w-full px-3 py-1.5 text-xs glass-input"
                  />
                </div>

                {/* Nota de seguridad */}
                <div className="bg-yellow-500/10 border border-yellow-500/20 text-yellow-300 rounded-xl p-3 text-[10.5px] leading-relaxed flex gap-2">
                  <ShieldAlert className="h-5 w-5 shrink-0 text-yellow-400" />
                  <span>
                    All credentials are saved locally in the browser's sandbox storage (`localStorage`). They are never uploaded to remote servers.
                  </span>
                </div>

                <button 
                  type="submit"
                  className="bg-purple-600 hover:bg-purple-700 text-white py-2 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 active:scale-[0.98] transition cursor-pointer"
                >
                  <Check className="h-4 w-4" />
                  Save API Keys
                </button>
              </form>
            )}

            {activeSettingsTab === 'tts' && (
              <div className="flex flex-col gap-4 text-xs">
                
                {/* Selección de Voz del Sistema */}
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="ttsVoice" className="font-semibold text-slate-300">System Speech Voice (Voz)</label>
                  <select 
                    id="ttsVoice"
                    value={ttsVoiceURI}
                    onChange={(e) => setTtsVoiceURI(e.target.value)}
                    className="w-full px-2 py-1.5 glass-input text-xs"
                  >
                    {ttsVoices.length === 0 ? (
                      <option value="">No voices detected by system</option>
                    ) : (
                      ttsVoices.map((voice) => (
                        <option key={voice.voiceURI} value={voice.voiceURI}>
                          {voice.name} ({voice.lang})
                        </option>
                      ))
                    )}
                  </select>
                </div>

                {/* Volumen */}
                <div className="flex flex-col gap-1">
                  <div className="flex justify-between font-semibold">
                    <label htmlFor="ttsVol">Volume</label>
                    <span>{Math.round(ttsVolume * 100)}%</span>
                  </div>
                  <input 
                    id="ttsVol"
                    type="range" 
                    min="0" 
                    max="1" 
                    step="0.05"
                    value={ttsVolume}
                    onChange={(e) => setTtsVolume(parseFloat(e.target.value))}
                    className="accent-purple-500 bg-white/10 rounded-lg appearance-none h-1.5"
                  />
                </div>

                {/* Rate (Velocidad) */}
                <div className="flex flex-col gap-1">
                  <div className="flex justify-between font-semibold">
                    <label htmlFor="ttsRate">Speed (Rate)</label>
                    <span>{ttsRate.toFixed(2)}x</span>
                  </div>
                  <input 
                    id="ttsRate"
                    type="range" 
                    min="0.5" 
                    max="2.0" 
                    step="0.05"
                    value={ttsRate}
                    onChange={(e) => setTtsRate(parseFloat(e.target.value))}
                    className="accent-purple-500 bg-white/10 rounded-lg appearance-none h-1.5"
                  />
                </div>

                {/* Pitch (Tono) */}
                <div className="flex flex-col gap-1">
                  <div className="flex justify-between font-semibold">
                    <label htmlFor="ttsPitch">Tone (Pitch)</label>
                    <span>{ttsPitch.toFixed(2)}</span>
                  </div>
                  <input 
                    id="ttsPitch"
                    type="range" 
                    min="0.5" 
                    max="2.0" 
                    step="0.05"
                    value={ttsPitch}
                    onChange={(e) => setTtsPitch(parseFloat(e.target.value))}
                    className="accent-purple-500 bg-white/10 rounded-lg appearance-none h-1.5"
                  />
                </div>

                {/* Botón de Prueba */}
                <button 
                  onClick={() => onNewMessage('Sistema', 'Prueba de voz en Néctar Cast', 'Voz')}
                  className="w-full bg-white/5 border border-white/5 text-slate-300 font-semibold py-2 rounded-xl text-xs hover:bg-white/10 active:scale-95 transition cursor-pointer"
                >
                  Test Speak
                </button>
              </div>
            )}

          </div>
        </div>
      )}
    </div>
  );
};
