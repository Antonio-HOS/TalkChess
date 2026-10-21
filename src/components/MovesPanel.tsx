import { useEffect, useRef } from 'react';

interface Props {
  sans: string[];
  /** ply visível (0 = posição inicial); null = último */
  viewPly: number | null;
  /** 1 = brancas movem primeiro */
  firstMoveBlack?: boolean;
  onSelect: (ply: number | null) => void;
}

export function MovesPanel({ sans, viewPly, firstMoveBlack, onSelect }: Props) {
  const total = sans.length;
  const current = viewPly ?? total;
  const activeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest' });
  }, [current, total]);

  const go = (ply: number) => onSelect(ply >= total ? null : Math.max(0, ply));

  // monta linhas: [numero, brancas, pretas]
  const offset = firstMoveBlack ? 1 : 0;
  const rows: Array<{ n: number; w?: { san: string; ply: number }; b?: { san: string; ply: number } }> = [];
  sans.forEach((san, i) => {
    const ply = i + 1;
    const idx = i + offset;
    const n = Math.floor(idx / 2) + 1;
    if (!rows.length || rows[rows.length - 1].n !== n) rows.push({ n });
    const row = rows[rows.length - 1];
    if (idx % 2 === 0) row.w = { san, ply };
    else row.b = { san, ply };
  });

  const cell = (m?: { san: string; ply: number }) =>
    m ? (
      <button
        ref={m.ply === current ? activeRef : undefined}
        className={`move-cell ${m.ply === current ? 'active' : ''}`}
        onClick={() => go(m.ply)}
      >
        {m.san}
      </button>
    ) : (
      <span className="move-cell empty">…</span>
    );

  return (
    <div className="moves-panel">
      <div className="moves-nav">
        <button onClick={() => go(0)} disabled={current === 0} title="Início">⏮</button>
        <button onClick={() => go(current - 1)} disabled={current === 0} title="Anterior (←)">◀</button>
        <button onClick={() => go(current + 1)} disabled={current >= total} title="Próximo (→)">▶</button>
        <button onClick={() => go(total)} disabled={current >= total} title="Fim">⏭</button>
      </div>
      <div className="moves-list">
        {rows.length === 0 && <p className="muted">Nenhum lance ainda.</p>}
        {rows.map((r) => (
          <div className="move-row" key={r.n}>
            <span className="move-num">{r.n}.</span>
            {cell(r.w)}
            {cell(r.b)}
          </div>
        ))}
      </div>
    </div>
  );
}
