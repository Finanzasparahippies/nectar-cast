// Hook personalizado de React para controlar la lectura de comentarios en voz alta (Text-to-Speech / TTS).
// Utiliza la API nativa `speechSynthesis` de Web Speech API provista por el motor de renderizado de la UI.
// Es 100% gratuito y no consume red ni CPU externa.

import { useCallback, useState, useEffect } from 'react';

export const useNectarTTS = () => {
  // Estado para controlar si la lectura por voz está encendida o apagada
  const [isEnabled, setIsEnabled] = useState(() => {
    return localStorage.getItem('nectar_tts_enabled') === 'true';
  });

  // Estados de configuración de voz
  const [volume, setVolume] = useState(() => {
    const val = localStorage.getItem('nectar_tts_volume');
    return val !== null ? parseFloat(val) : 1.0;
  });
  const [rate, setRate] = useState(() => {
    const val = localStorage.getItem('nectar_tts_rate');
    return val !== null ? parseFloat(val) : 1.15;
  });
  const [pitch, setPitch] = useState(() => {
    const val = localStorage.getItem('nectar_tts_pitch');
    return val !== null ? parseFloat(val) : 1.0;
  });
  const [selectedVoiceURI, setSelectedVoiceURI] = useState(() => {
    return localStorage.getItem('nectar_tts_voice_uri') || '';
  });

  // Lista de voces detectadas en el sistema
  const [availableVoices, setAvailableVoices] = useState<SpeechSynthesisVoice[]>([]);
  // Voz resuelta a usar
  const [selectedVoice, setSelectedVoice] = useState<SpeechSynthesisVoice | null>(null);

  // Persistir cambios en localStorage
  useEffect(() => {
    localStorage.setItem('nectar_tts_enabled', isEnabled.toString());
  }, [isEnabled]);

  useEffect(() => {
    localStorage.setItem('nectar_tts_volume', volume.toString());
  }, [volume]);

  useEffect(() => {
    localStorage.setItem('nectar_tts_rate', rate.toString());
  }, [rate]);

  useEffect(() => {
    localStorage.setItem('nectar_tts_pitch', pitch.toString());
  }, [pitch]);

  useEffect(() => {
    localStorage.setItem('nectar_tts_voice_uri', selectedVoiceURI);
  }, [selectedVoiceURI]);

  // Carga y configura las voces del sistema operativo en el cliente
  useEffect(() => {
    const loadVoices = () => {
      if ('speechSynthesis' in window) {
        const voices = window.speechSynthesis.getVoices();
        setAvailableVoices(voices);
        
        let voice: SpeechSynthesisVoice | null = null;

        if (selectedVoiceURI) {
          voice = voices.find(v => v.voiceURI === selectedVoiceURI) || null;
        }

        if (!voice) {
          // Si no hay seleccionada previamente, prioriza español mexicano, luego español
          voice = voices.find(v => v.lang.includes('es-MX')) || 
                  voices.find(v => v.lang.toLowerCase().startsWith('es-')) || 
                  voices[0] ||
                  null;
        }

        setSelectedVoice(voice);
        if (voice && !selectedVoiceURI) {
          setSelectedVoiceURI(voice.voiceURI);
        }
      }
    };

    loadVoices();
    if ('speechSynthesis' in window && window.speechSynthesis.onvoiceschanged !== undefined) {
      window.speechSynthesis.onvoiceschanged = loadVoices;
    }
  }, [selectedVoiceURI]);

  // Función principal para leer un comentario en voz alta
  const speakComment = useCallback((user: string, text: string, platform: string) => {
    if (!isEnabled || !('speechSynthesis' in window)) return;

    // Cancela cualquier lectura en curso para evitar cola infinita
    window.speechSynthesis.cancel();

    // Limpieza de emojis y caracteres no verbalizables
    const cleanText = text.replace(/[^\w\sñáéíóúüÁÉÍÓÚÜ]/gi, '').trim();
    if (!cleanText) return;

    // Construye la frase
    const utterance = new SpeechSynthesisUtterance(`${user} en ${platform} dice: ${cleanText}`);
    
    if (selectedVoice) {
      utterance.voice = selectedVoice;
    } else if (selectedVoiceURI) {
      const v = availableVoices.find(x => x.voiceURI === selectedVoiceURI);
      if (v) utterance.voice = v;
    }
    
    utterance.volume = volume;
    utterance.rate = rate;
    utterance.pitch = pitch;
    utterance.lang = selectedVoice?.lang || 'es-MX';

    window.speechSynthesis.speak(utterance);
  }, [isEnabled, selectedVoice, selectedVoiceURI, availableVoices, volume, rate, pitch]);

  return { 
    speakComment, 
    isEnabled, 
    setIsEnabled,
    volume,
    setVolume,
    rate,
    setRate,
    pitch,
    setPitch,
    selectedVoiceURI,
    setSelectedVoiceURI,
    availableVoices
  };
};
