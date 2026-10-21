import { useCallback, useEffect, useRef, useState } from 'react';

// Tipos mínimos da Web Speech API (não presentes em lib.dom)
interface SRAlternative {
  transcript: string;
  confidence: number;
}
interface SRResult {
  isFinal: boolean;
  length: number;
  [index: number]: SRAlternative;
}
interface SREvent {
  resultIndex: number;
  results: { length: number; [index: number]: SRResult };
}
interface SRErrorEvent {
  error: string;
}
interface SRInstance {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((e: SRErrorEvent) => void) | null;
  onresult: ((e: SREvent) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type SRConstructor = new () => SRInstance;

function getSR(): SRConstructor | null {
  const w = window as unknown as { SpeechRecognition?: SRConstructor; webkitSpeechRecognition?: SRConstructor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export const speechRecognitionSupported = () => typeof window !== 'undefined' && getSR() !== null;
export const speechSynthesisSupported = () => typeof window !== 'undefined' && 'speechSynthesis' in window;

export type MicState = 'idle' | 'listening' | 'error';

interface Options {
  lang: string;
  /** Chamado ao fim de cada frase reconhecida, com todas as hipóteses (melhor primeiro). */
  onFinal: (alternatives: string[]) => void;
}

export function useSpeechRecognition({ lang, onFinal }: Options) {
  const [state, setState] = useState<MicState>('idle');
  const [interim, setInterim] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [continuous, setContinuous] = useState(false);

  const recRef = useRef<SRInstance | null>(null);
  const wantRef = useRef(false); // usuário quer o microfone aberto
  const pausedRef = useRef(false); // pausado temporariamente (ex.: enquanto fala)
  const contRef = useRef(false);
  const onFinalRef = useRef(onFinal);
  onFinalRef.current = onFinal;
  const langRef = useRef(lang);
  langRef.current = lang;

  const supported = speechRecognitionSupported();

  const stopInstance = useCallback(() => {
    const r = recRef.current;
    recRef.current = null;
    if (r) {
      r.onend = null;
      r.onerror = null;
      r.onresult = null;
      try {
        r.abort();
      } catch {
        /* ignore */
      }
    }
  }, []);

  const begin = useCallback(() => {
    const SR = getSR();
    if (!SR || recRef.current || pausedRef.current) return;
    const rec = new SR();
    rec.lang = langRef.current;
    rec.continuous = false;
    rec.interimResults = true;
    rec.maxAlternatives = 6;
    rec.onstart = () => {
      setState('listening');
      setError(null);
    };
    rec.onresult = (e) => {
      let interimText = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) {
          const alts: string[] = [];
          for (let k = 0; k < res.length; k++) alts.push(res[k].transcript);
          setInterim('');
          onFinalRef.current(alts);
        } else {
          interimText += res[0].transcript;
        }
      }
      if (interimText) setInterim(interimText);
    };
    rec.onerror = (e) => {
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      const msgs: Record<string, string> = {
        'not-allowed': 'Permissão do microfone negada. Libere o acesso nas configurações do navegador.',
        'service-not-allowed': 'Reconhecimento de voz bloqueado pelo navegador.',
        network: 'Falha de rede no reconhecimento de voz (o Chrome usa um serviço online).',
        'audio-capture': 'Nenhum microfone encontrado.',
        'language-not-supported': 'Idioma não suportado pelo reconhecimento de voz.',
      };
      setError(msgs[e.error] ?? `Erro no reconhecimento de voz: ${e.error}`);
      wantRef.current = false;
      setState('error');
    };
    rec.onend = () => {
      recRef.current = null;
      setInterim('');
      if (wantRef.current && !pausedRef.current) {
        // escuta contínua: reabre; modo único: encerra
        if (contRef.current) setTimeout(begin, 150);
        else {
          wantRef.current = false;
          setState('idle');
        }
      } else if (!wantRef.current) {
        setState('idle');
      }
    };
    recRef.current = rec;
    try {
      rec.start();
    } catch {
      recRef.current = null;
    }
  }, []);

  const start = useCallback(() => {
    if (!supported) return;
    wantRef.current = true;
    setError(null);
    begin();
  }, [begin, supported]);

  const stop = useCallback(() => {
    wantRef.current = false;
    stopInstance();
    setInterim('');
    setState((s) => (s === 'error' ? s : 'idle'));
  }, [stopInstance]);

  const toggle = useCallback(() => {
    if (wantRef.current) stop();
    else start();
  }, [start, stop]);

  /** Pausa/retoma sem alterar a intenção do usuário (usado durante a fala do app). */
  const setPaused = useCallback(
    (paused: boolean) => {
      pausedRef.current = paused;
      if (paused) stopInstance();
      else if (wantRef.current) begin();
    },
    [begin, stopInstance],
  );

  const changeContinuous = useCallback((v: boolean) => {
    contRef.current = v;
    setContinuous(v);
  }, []);

  // Troca de idioma: reinicia a instância
  useEffect(() => {
    if (recRef.current) {
      stopInstance();
      if (wantRef.current) begin();
    }
  }, [lang, begin, stopInstance]);

  useEffect(
    () => () => {
      wantRef.current = false;
      stopInstance();
    },
    [stopInstance],
  );

  return { supported, state, interim, error, continuous, setContinuous: changeContinuous, start, stop, toggle, setPaused };
}

// ---------------------------------------------------------------------------
// Síntese de voz
// ---------------------------------------------------------------------------

export function speak(text: string, lang: string): Promise<void> {
  return new Promise((resolve) => {
    if (!speechSynthesisSupported()) return resolve();
    const synth = window.speechSynthesis;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang;
    const voices = synth.getVoices();
    const v =
      voices.find((x) => x.lang === lang) ??
      voices.find((x) => x.lang.toLowerCase().startsWith(lang.slice(0, 2).toLowerCase()));
    if (v) u.voice = v;
    u.rate = 1.0;
    u.onend = () => resolve();
    u.onerror = () => resolve();
    synth.cancel();
    synth.speak(u);
  });
}

export function cancelSpeech() {
  if (speechSynthesisSupported()) window.speechSynthesis.cancel();
}
