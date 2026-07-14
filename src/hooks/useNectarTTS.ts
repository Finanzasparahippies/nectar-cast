// Hook personalizado de React para controlar la lectura de comentarios en voz alta (Text-to-Speech / TTS).
// Utiliza la API nativa `speechSynthesis` de Web Speech API provista por el motor de renderizado de la UI.
// Es 100% gratuito y no consume red ni CPU externa.

import { useCallback, useState, useEffect } from 'react';

export const useNectarTTS = () => {
  // Estado para controlar si la lectura por voz está encendida o apagada
  const [isEnabled, setIsEnabled] = useState(false);
  // Almacena la voz en español resuelta por el sistema
  const [selectedVoice, setSelectedVoice] = useState<SpeechSynthesisVoice | null>(null);

  // Carga y configura las voces del sistema operativo en el cliente
  useEffect(() => {
    const loadVoices = () => {
      if ('speechSynthesis' in window) {
        const voices = window.speechSynthesis.getVoices();
        
        // Prioriza una voz nativa en español mexicano (es-MX),
        // luego cualquier voz en español (es-*), y finalmente ninguna si no está soportada.
        const spanishVoice = voices.find(v => v.lang.includes('es-MX')) || 
                             voices.find(v => v.lang.toLowerCase().startsWith('es-')) || 
                             null;
        setSelectedVoice(spanishVoice);
      }
    };

    loadVoices();
    // En navegadores basados en Chromium, las voces se cargan de manera asíncrona,
    // por lo que debemos suscribirnos al evento onvoiceschanged para cargarlas correctamente.
    if ('speechSynthesis' in window && window.speechSynthesis.onvoiceschanged !== undefined) {
      window.speechSynthesis.onvoiceschanged = loadVoices;
    }
  }, []);

  // Función principal para leer un comentario en voz alta
  const speakComment = useCallback((user: string, text: string, platform: string) => {
    // Si el TTS está desactivado o la API no existe en este motor web, ignoramos la llamada
    if (!isEnabled || !('speechSynthesis' in window)) return;

    // Cancela cualquier lectura en curso para evitar que los comentarios se acumulen y
    // la voz se desfase con respecto a la transmisión en vivo.
    window.speechSynthesis.cancel();

    // Limpieza de caracteres: elimina emojis y caracteres especiales no verbalizables
    // para evitar que la voz deletree símbolos extraños durante el directo.
    const cleanText = text.replace(/[^\w\sñáéíóúüÁÉÍÓÚÜ]/gi, '').trim();
    if (!cleanText) return;

    // Construye la frase en español
    const utterance = new SpeechSynthesisUtterance(`${user} en ${platform} dice: ${cleanText}`);
    
    // Si logramos resolver una voz en español, la asignamos al locutor
    if (selectedVoice) {
      utterance.voice = selectedVoice;
    }
    
    utterance.rate = 1.15; // Velocidad de habla acelerada para que no interfiera con el audio del juego
    utterance.pitch = 1.0; // Tono normal
    utterance.lang = 'es-MX'; // Idioma de respaldo

    // Dispara el reproductor de voz local
    window.speechSynthesis.speak(utterance);
  }, [isEnabled, selectedVoice]);

  return { speakComment, isEnabled, setIsEnabled };
};
