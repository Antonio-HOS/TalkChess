import { useState } from 'react';
import type { Move } from 'chess.js';
import { describeCandidate } from '../lib/voice/parser';
import type { MicState } from '../lib/voice/speech';

export interface VoiceLogItem {
  id: number;
  heard: string;
  text: string;
  tone: 'ok' | 'warn' | 'err';
}

interface Props {
  supported: boolean;
  micState: MicState;
  interim: string;
  error: string | null;
  continuous: boolean;
  log: VoiceLogItem[];
  options: Move[];
  onToggleMic: () => void;
  onToggleContinuous: (v: boolean) => void;
  onPickOption: (m: Move) => void;
  onText: (text: string) => void;
}

export function VoicePanel({
  supported,
  micState,
  interim,
  error,
  continuous,
  log,
  options,
  onToggleMic,
  onToggleContinuous,
  onPickOption,
  onText,
}: Props) {
  const [text, setText] = useState('');
  const listening = micState === 'listening';
  const last = log[0];

  return (
    <div className="voice-panel">
      <div className="voice-main">
        <button
          className={`mic-btn ${listening ? 'on' : ''}`}
          onClick={onToggleMic}
          disabled={!supported}
          title={supported ? 'Clique (ou aperte Espaço) para falar' : 'Seu navegador não suporta reconhecimento de voz'}
          aria-pressed={listening}
        >
          <span className="mic-icon">{listening ? '🎙️' : '🎤'}</span>
          {listening && <span className="pulse" />}
        </button>
        <div className="voice-status">
          <div className="voice-line">
            {!supported ? (
              <span className="err">Reconhecimento de voz indisponível neste navegador — use Chrome/Edge ou digite abaixo.</span>
            ) : listening ? (
              <span>{interim ? <em>“{interim}”</em> : 'Ouvindo… diga seu lance, ex.: “cavalo efe três”'}</span>
            ) : (
              <span className="muted">Microfone desligado — aperte <kbd>Espaço</kbd> ou clique no microfone</span>
            )}
          </div>
          {error && <div className="voice-line err">{error}</div>}
          {last && !listening && (
            <div className={`voice-line ${last.tone}`}>
              {last.heard && <span className="heard">“{last.heard}” → </span>}
              {last.text}
            </div>
          )}
        </div>
        <label className="switch" title="Mantém o microfone aberto entre os lances">
          <input type="checkbox" checked={continuous} onChange={(e) => onToggleContinuous(e.target.checked)} />
          <span>Escuta contínua</span>
        </label>
      </div>

      {options.length > 0 && (
        <div className="voice-options">
          <span>Qual deles?</span>
          {options.map((m) => (
            <button key={m.san + m.from + m.to + (m.promotion ?? '')} onClick={() => onPickOption(m)}>
              {describeCandidate(m)}
            </button>
          ))}
        </div>
      )}

      <form
        className="voice-text"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) {
            onText(text);
            setText('');
          }
        }}
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Ou digite o comando como se falasse: “cavalo f3”, “roque curto”, “desfazer”…"
          aria-label="Comando digitado"
        />
        <button type="submit">Enviar</button>
      </form>

      {log.length > 1 && (
        <ul className="voice-log">
          {log.slice(1, 6).map((l) => (
            <li key={l.id} className={l.tone}>
              {l.heard && <span className="heard">“{l.heard}” </span>}
              <span>{l.text}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
