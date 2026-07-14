// Componente React para la integración del chat unificado de YouTube, Facebook e Instagram.
// Permite a los streamers gestionar credenciales locales, simular transmisiones en vivo
// y consolidar los mensajes de múltiples plataformas en un único feed visual.

import React, { useState, useEffect, useRef } from 'react';
import { 
  Youtube, Facebook, Instagram, Volume2, VolumeX, 
  Settings as SettingsIcon, MessageSquare, ShieldAlert, Sparkles, Check
} from 'lucide-react';

// Interfaz para representar un mensaje unificado en la interfaz
interface ChatMessage {
  id: string;
  user: string;
  text: string;
  platform: 'youtube' | 'facebook' | 'instagram';
  timestamp: string;
}

// Propiedades recibidas por el contenedor de chat
interface ChatContainerProps {
  onNewMessage: (user: string, text: string, platform: string) => void;
  ttsEnabled: boolean;
  setTtsEnabled: (enabled: boolean) => void;
}

export const ChatContainer: React.FC<ChatContainerProps> = ({ 
  onNewMessage, 
  ttsEnabled, 
  setTtsEnabled 
}) => {
  // Lista de mensajes activos en el feed
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  // Controla si el simulador de comentarios está activo o no
  const [isSimulating, setIsSimulating] = useState(false);
  // Controla la visibilidad del modal de configuraciones de API
  const [showConfig, setShowConfig] = useState(false);

  // Estados de configuración de las APIs.
  // Se inicializan leyendo directamente del localStorage local del cliente para mantener persistencia.
  const [ytApiKey, setYtApiKey] = useState(() => localStorage.getItem('nectar_yt_api_key') || '');
  const [ytLiveChatId, setYtLiveChatId] = useState(() => localStorage.getItem('nectar_yt_chat_id') || '');
  const [fbPostId, setFbPostId] = useState(() => localStorage.getItem('nectar_fb_post_id') || '');
  const [fbToken, setFbToken] = useState(() => localStorage.getItem('nectar_fb_token') || '');
  const [igMediaId, setIgMediaId] = useState(() => localStorage.getItem('nectar_ig_media_id') || '');
  const [igToken, setIgToken] = useState(() => localStorage.getItem('nectar_ig_token') || '');

  const chatEndRef = useRef<HTMLDivElement>(null);
  const simulationIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Hace scroll automático al último mensaje recibido cuando el feed de chat se actualiza
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

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

  // Base de datos de comentarios ficticios para el modo simulador
  const mockComments = [
    { user: 'Juan_Gamer', text: '¡Excelente calidad de transmisión!', platform: 'youtube' as const },
    { user: 'MariaRojas', text: 'Saludos desde Costa Rica, buen stream 🚀', platform: 'facebook' as const },
    { user: 'karen.v', text: '¿Qué cámara estás usando? Se ve súper nítido', platform: 'instagram' as const },
    { user: 'Luis_dev', text: 'Néctar Cast funciona increíble con cero lag', platform: 'youtube' as const },
    { user: 'Carlos_Alvarez', text: '¡Buenísima jugada en esa partida!', platform: 'facebook' as const },
    { user: 'andrea_streams', text: '¡Síganlo para más lives!', platform: 'instagram' as const },
    { user: 'GamerMax', text: '¿Vas a transmitir mañana a la misma hora?', platform: 'youtube' as const },
    { user: 'Pedro_Stream', text: 'Compartido en mi grupo de gaming', platform: 'facebook' as const },
    { user: 'sofi.code', text: 'Amo el diseño oscuro de tu app', platform: 'instagram' as const }
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
      // Dispara comentarios aleatorios cada 4 segundos
      simulationIntervalRef.current = setInterval(() => {
        sendMockComment();
      }, 4000);
    }
  };

  // Genera un comentario aleatorio y dispara el callback de voz (TTS)
  const sendMockComment = () => {
    const randomComment = mockComments[Math.floor(Math.random() * mockComments.length)];
    const newMessage: ChatMessage = {
      id: Math.random().toString(),
      user: randomComment.user,
      text: randomComment.text,
      platform: randomComment.platform,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    };

    setMessages(prev => [...prev, newMessage]);
    // Notifica al componente padre para que reproduzca la voz (TTS) si está activa
    onNewMessage(randomComment.user, randomComment.text, randomComment.platform);
  };

  // Efecto que controla las llamadas de sondeo (polling) de APIs reales
  useEffect(() => {
    let ytInterval: NodeJS.Timeout;
    
    // Si el usuario ingresó la API Key y el ID del Chat en Vivo de YouTube, inicia la consulta periódica
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
              timestamp: new Date(item.snippet.publishedAt).toLocaleTimeString()
            }));
            
            // Deduplica mensajes por ID único para evitar repetirlos en pantalla o voz
            setMessages(prev => {
              const existingIds = new Set(prev.map(m => m.id));
              const uniqueNew = newYtMsgs.filter((m: any) => !existingIds.has(m.id));
              // Dispara la lectura de voz para cada nuevo mensaje único recibido
              uniqueNew.forEach((m: any) => onNewMessage(m.user, m.text, 'YouTube'));
              return [...prev, ...uniqueNew];
            });
          }
        } catch (e) {
          console.error('Error polling YouTube chat:', e);
        }
      };
      // Consulta a la API de YouTube cada 5 segundos
      ytInterval = setInterval(pollYoutube, 5000);
    }

    return () => {
      if (ytInterval) clearInterval(ytInterval);
      if (simulationIntervalRef.current) clearInterval(simulationIntervalRef.current);
    };
  }, [ytApiKey, ytLiveChatId]);

  return (
    <div className="flex-1 flex flex-col glass-panel rounded-2xl overflow-hidden border border-white/5 h-full">
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

          {/* Botón para abrir el panel de configuración de credenciales de red */}
          <button 
            onClick={() => setShowConfig(!showConfig)}
            className="p-2 rounded-lg border border-white/5 hover:bg-white/5 text-slate-400 hover:text-white transition-all cursor-pointer"
            title="Chat integration API settings"
          >
            <SettingsIcon className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Caja contenedora del flujo de comentarios */}
      <div className="flex-1 p-5 overflow-y-auto flex flex-col gap-3 min-h-[300px] max-h-[500px]">
        {messages.length === 0 ? (
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
          messages.map((msg) => {
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
            }

            return (
              <div 
                key={msg.id} 
                className="glass-panel p-3 rounded-xl border border-white/5 flex flex-col gap-1 hover:bg-white/[0.01]"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {/* Badge identificador de red social */}
                    <span className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[10px] font-semibold tracking-wide ${badgeStyle}`}>
                      {icon}
                      {platformLabel}
                    </span>
                    <span className="font-bold text-sm text-slate-200">{msg.user}</span>
                  </div>
                  <span className="text-[10px] text-slate-500 font-mono">{msg.timestamp}</span>
                </div>
                <p className="text-xs text-slate-300 ml-1 mt-0.5 leading-relaxed">{msg.text}</p>
              </div>
            );
          })
        )}
        {/* Div utilizado como ancla para hacer scroll automático */}
        <div ref={chatEndRef} />
      </div>

      {/* Cajón de configuración (Modal de claves) */}
      {showConfig && (
        <div className="absolute inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="glass-panel max-w-md w-full p-6 rounded-2xl border border-white/10 flex flex-col gap-4 max-h-[90%] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-white/5 pb-3">
              <h3 className="font-bold text-lg text-white flex items-center gap-2">
                <SettingsIcon className="h-5 w-5 text-purple-400" />
                Stream Chat APIs
              </h3>
              <button 
                onClick={() => setShowConfig(false)}
                className="text-slate-400 hover:text-white font-semibold text-sm px-2 py-1 bg-white/5 hover:bg-white/10 rounded"
              >
                Close
              </button>
            </div>

            {/* Formulario de registro de credenciales */}
            <form onSubmit={saveConfig} className="flex flex-col gap-4">
              {/* Claves YouTube */}
              <div className="flex flex-col gap-2 p-3 bg-white/[0.01] border border-white/5 rounded-xl">
                <h4 className="text-xs font-bold text-rose-400 uppercase tracking-widest flex items-center gap-1">
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
                <h4 className="text-xs font-bold text-blue-400 uppercase tracking-widest flex items-center gap-1">
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
                <h4 className="text-xs font-bold text-pink-400 uppercase tracking-widest flex items-center gap-1">
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
              <div className="bg-yellow-500/10 border border-yellow-500/20 text-yellow-300 rounded-xl p-3 text-[11px] leading-relaxed flex gap-2">
                <ShieldAlert className="h-5 w-5 shrink-0 text-yellow-400" />
                <span>
                  All credentials are saved locally in the browser's sandbox storage (`localStorage`). They are never uploaded to remote servers.
                </span>
              </div>

              <button 
                type="submit"
                className="bg-purple-600 hover:bg-purple-700 text-white py-2 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 active:scale-[0.98] transition cursor-pointer"
              >
                <Check className="h-4 w-4" />
                Save Configurations
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
