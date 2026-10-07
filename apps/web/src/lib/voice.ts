import { useEffect, useRef, useState } from 'react';

/**
 * Dictado con el reconocimiento de voz del celular (Chrome en Android, Safari en iPhone).
 * Lifty solo recibe el texto; lo interpreta con reglas (parseQuick), sin IA.
 * Necesita https (o la compu misma). En la app de escritorio no anda (Electron no trae el
 * servicio de voz): ahí se dicta con Windows + H en cualquier campo.
 */

interface RecognitionResult {
  isFinal: boolean;
  0: { transcript: string };
}
interface RecognitionEvent {
  resultIndex: number;
  results: ArrayLike<RecognitionResult>;
}
interface Recognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  onresult: ((e: RecognitionEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type RecognitionCtor = new () => Recognition;

function ctor(): RecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export const isDesktopApp = () => typeof navigator !== 'undefined' && /electron/i.test(navigator.userAgent);

/** Se puede dictar acá (hay reconocimiento de voz, conexión segura y no es la app de escritorio). */
export const canDictate = () => !!ctor() && window.isSecureContext && !isDesktopApp();

const ERRORS: Record<string, string> = {
  'not-allowed': 'Lifty no tiene permiso para el micrófono. Habilitalo en los permisos del navegador.',
  'service-not-allowed': 'El dictado no está disponible acá. Probá con el micrófono del teclado.',
  'no-speech': 'No te escuché. Tocá el micrófono y decilo de nuevo.',
  'audio-capture': 'No encontré un micrófono.',
  network: 'El dictado necesita internet en el celular.',
};

/**
 * Escucha una frase: va mostrando lo que entiende y, al terminar, llama a onFinal con el texto.
 */
export function useDictation(onFinal: (text: string) => void) {
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<Recognition | null>(null);
  const finalCb = useRef(onFinal);
  finalCb.current = onFinal;
  useEffect(() => () => rec.current?.abort(), []);

  const start = () => {
    const C = ctor();
    if (!C || !canDictate()) {
      setError(
        isDesktopApp()
          ? 'En la compu, dictá con Windows + H sobre el campo de texto.'
          : 'Este navegador no dicta. Usá el micrófono del teclado del celular.',
      );
      return;
    }
    rec.current?.abort();
    const r = new C();
    r.lang = 'es-UY';
    r.interimResults = true;
    r.continuous = false;
    r.maxAlternatives = 1;
    let text = '';
    r.onresult = (e) => {
      let live = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) text += res[0].transcript;
        else live += res[0].transcript;
      }
      setInterim((text + live).trim());
    };
    r.onerror = (e) => {
      if (e.error !== 'aborted') setError(ERRORS[e.error] ?? `No pude escuchar (${e.error}).`);
    };
    r.onend = () => {
      setListening(false);
      setInterim('');
      if (text.trim()) finalCb.current(text.trim());
    };
    setError(null);
    setInterim('');
    setListening(true);
    rec.current = r;
    try {
      r.start();
    } catch {
      setListening(false);
      setError('No pude abrir el micrófono.');
    }
  };
  const stop = () => rec.current?.stop();
  return { listening, interim, error, start, stop, supported: canDictate() };
}
