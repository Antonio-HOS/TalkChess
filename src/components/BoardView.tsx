import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Chess, type Square } from 'chess.js';
import { Chessboard } from 'react-chessboard';
import type { Color } from '../lib/game';

export interface BoardArrow {
  startSquare: string;
  endSquare: string;
  color: string;
}

export const BOARD_THEMES = {
  verde: { light: '#eeeed2', dark: '#769656', name: 'Verde' },
  madeira: { light: '#f0d9b5', dark: '#b58863', name: 'Madeira' },
  azul: { light: '#dee3e6', dark: '#8ca2ad', name: 'Azul' },
  noite: { light: '#9aa0b4', dark: '#4b5069', name: 'Noite' },
} as const;
export type BoardThemeKey = keyof typeof BOARD_THEMES;

interface Props {
  fen: string;
  orientation: Color;
  /** lado que pode mover agora (null = tabuleiro somente leitura) */
  movableColor: Color | null;
  lastMove?: { from: string; to: string } | null;
  arrows?: BoardArrow[];
  theme: BoardThemeKey;
  showLegalMoves: boolean;
  animate: boolean;
  /** retorna true se o lance foi aceito */
  onMove: (from: string, to: string, promotion?: string) => boolean;
}

const PROMO_GLYPH: Record<string, [string, string]> = {
  q: ['♕', '♛'],
  r: ['♖', '♜'],
  b: ['♗', '♝'],
  n: ['♘', '♞'],
};

export function BoardView({
  fen,
  orientation,
  movableColor,
  lastMove,
  arrows,
  theme,
  showLegalMoves,
  animate,
  onMove,
}: Props) {
  const chess = useMemo(() => new Chess(fen), [fen]);
  const [selected, setSelected] = useState<string | null>(null);
  const [promo, setPromo] = useState<{ from: string; to: string } | null>(null);

  // Mudou a posição => limpa seleção
  useEffect(() => {
    setSelected(null);
    setPromo(null);
  }, [fen]);

  const turnColor: Color = chess.turn() === 'w' ? 'white' : 'black';
  const canMove = movableColor !== null && movableColor === turnColor;

  const legalTargets = useMemo(() => {
    if (!selected || !canMove) return new Map<string, boolean>();
    const map = new Map<string, boolean>();
    for (const m of chess.moves({ square: selected as Square, verbose: true })) map.set(m.to, !!m.captured);
    return map;
  }, [chess, selected, canMove]);

  const squareStyles = useMemo(() => {
    const styles: Record<string, CSSProperties> = {};
    const add = (sq: string, s: CSSProperties) => {
      styles[sq] = { ...(styles[sq] ?? {}), ...s };
    };
    if (lastMove) {
      add(lastMove.from, { background: 'rgba(205, 210, 106, 0.55)' });
      add(lastMove.to, { background: 'rgba(205, 210, 106, 0.75)' });
    }
    if (chess.inCheck()) {
      const king = chess
        .board()
        .flat()
        .find((p) => p && p.type === 'k' && p.color === chess.turn());
      if (king) add(king.square, { background: 'radial-gradient(circle, rgba(255,0,0,.85) 0%, rgba(231,0,0,.55) 45%, rgba(169,0,0,0) 75%)' });
    }
    if (selected) add(selected, { background: 'rgba(20, 130, 60, 0.55)' });
    if (showLegalMoves) {
      legalTargets.forEach((isCapture, sq) => {
        add(
          sq,
          isCapture
            ? { background: 'radial-gradient(circle, transparent 58%, rgba(20,60,30,.45) 60%)' }
            : { background: 'radial-gradient(circle, rgba(20,60,30,.4) 18%, transparent 20%)' },
        );
      });
    }
    return styles;
  }, [lastMove, chess, selected, legalTargets, showLegalMoves]);

  const needsPromotion = (from: string, to: string) =>
    chess.moves({ square: from as Square, verbose: true }).some((m) => m.to === to && m.promotion);

  const attempt = (from: string, to: string): boolean => {
    if (!canMove) return false;
    const legal = chess.moves({ square: from as Square, verbose: true }).some((m) => m.to === to);
    if (!legal) return false;
    if (needsPromotion(from, to)) {
      setPromo({ from, to });
      return false; // a peça volta; o lance é feito após a escolha
    }
    const ok = onMove(from, to);
    if (ok) setSelected(null);
    return ok;
  };

  const colors = BOARD_THEMES[theme];

  return (
    <div className="board-wrap">
      <Chessboard
        options={{
          position: fen,
          boardOrientation: orientation,
          allowDragging: canMove,
          showAnimations: animate,
          animationDurationInMs: 180,
          lightSquareStyle: { backgroundColor: colors.light },
          darkSquareStyle: { backgroundColor: colors.dark },
          squareStyles,
          arrows: arrows ?? [],
          allowDrawingArrows: true,
          clearArrowsOnClick: true,
          boardStyle: { borderRadius: 6, boxShadow: '0 8px 30px rgba(0,0,0,.5)' },
          canDragPiece: ({ piece }) => canMove && piece.pieceType[0] === (movableColor === 'white' ? 'w' : 'b'),
          onPieceDrag: ({ square }) => {
            if (canMove && square) setSelected(square);
          },
          onPieceDrop: ({ sourceSquare, targetSquare }) => {
            if (!targetSquare || sourceSquare === targetSquare) return false;
            return attempt(sourceSquare, targetSquare);
          },
          onSquareClick: ({ piece, square }) => {
            if (!canMove) return;
            if (selected && legalTargets.has(square)) {
              attempt(selected, square);
              return;
            }
            const mine = piece && piece.pieceType[0] === (movableColor === 'white' ? 'w' : 'b');
            setSelected(mine && square !== selected ? square : null);
          },
        }}
      />
      {promo && (
        <div className="promo-overlay" onClick={() => setPromo(null)}>
          <div className="promo-dialog" onClick={(e) => e.stopPropagation()}>
            <span>Promover para:</span>
            <div className="promo-options">
              {(['q', 'r', 'b', 'n'] as const).map((p) => (
                <button
                  key={p}
                  className="promo-btn"
                  onClick={() => {
                    const { from, to } = promo;
                    setPromo(null);
                    onMove(from, to, p);
                  }}
                  aria-label={p}
                >
                  {PROMO_GLYPH[p][movableColor === 'white' ? 0 : 1]}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
