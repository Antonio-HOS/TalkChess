import { formatClock } from '../lib/game';

const GLYPH: Record<string, string> = { p: '♟', n: '♞', b: '♝', r: '♜', q: '♛' };

interface Props {
  name: string;
  detail?: string;
  /** peças capturadas por este lado (letras minúsculas) */
  captured: string[];
  /** vantagem material deste lado em pontos (só exibida se > 0) */
  advantage: number;
  clockMs?: number | null;
  clockActive?: boolean;
  thinking?: boolean;
  isEngine?: boolean;
  pieceColor: 'white' | 'black';
}

export function PlayerBar({ name, detail, captured, advantage, clockMs, clockActive, thinking, isEngine, pieceColor }: Props) {
  return (
    <div className="player-bar">
      <div className={`avatar ${pieceColor}`}>{isEngine ? '🤖' : '👤'}</div>
      <div className="player-info">
        <div className="player-name">
          {name}
          {thinking && <span className="thinking"> pensando…</span>}
        </div>
        <div className="player-sub">
          {detail && <span>{detail}</span>}
          <span className={`captured ${pieceColor === 'white' ? 'cap-black' : 'cap-white'}`}>
            {captured.map((p, i) => (
              <span key={i}>{GLYPH[p]}</span>
            ))}
            {advantage > 0 && <b className="adv">+{advantage}</b>}
          </span>
        </div>
      </div>
      {clockMs !== null && clockMs !== undefined && (
        <div className={`clock ${clockActive ? 'active' : ''} ${clockMs < 20_000 ? 'low' : ''}`}>{formatClock(clockMs)}</div>
      )}
    </div>
  );
}
