import { Chess } from 'chess.js';
import { describe, expect, it } from 'vitest';
import { gameReducer, initialGame } from '../game';
import { changedSquares, readSamples, sampleDistance, squareCenter, summarize, type Corners, type SquareSample } from './geometry';
import { initialPhase, moveBetween, sameSquares, squaresTouched, stepTracker, type TrackPhase } from './track';

const UNIT: Corners = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];

function sanMove(fen: string, san: string) {
  const mv = new Chess(fen).moves({ verbose: true }).find((m) => m.san === san);
  if (!mv) throw new Error(`sem lance ${san}`);
  return mv;
}

function flat(rgb: [number, number, number], spread = 1): SquareSample {
  const [r, g, b] = rgb;
  return { r, g, b, lum: 0.2126 * r + 0.7152 * g + 0.0722 * b, spread };
}

describe('geometria', () => {
  it('a1 fica embaixo à esquerda quando as brancas estão perto da câmera', () => {
    const c = squareCenter(UNIT, 'a1', true);
    expect(c.x).toBeCloseTo(0.0625);
    expect(c.y).toBeCloseTo(0.9375);
  });

  it('a1 fica em cima à direita quando as pretas estão perto da câmera', () => {
    const c = squareCenter(UNIT, 'a1', false);
    expect(c.x).toBeCloseTo(0.9375);
    expect(c.y).toBeCloseTo(0.0625);
  });

  it('lê a cor do centro de uma casa', () => {
    const size = 160;
    const data = new Uint8ClampedArray(size * size * 4);
    for (let y = 130; y < size; y++) {
      for (let x = 0; x < 28; x++) {
        const i = (y * size + x) * 4;
        data[i] = 240;
        data[i + 1] = 240;
        data[i + 2] = 240;
        data[i + 3] = 255;
      }
    }
    const samples = readSamples({ data, width: size, height: size }, UNIT, true);
    expect(samples.a1.lum).toBeGreaterThan(150);
    expect(samples.h8.lum).toBeLessThan(5);
  });
});

describe('diferença de casas', () => {
  it('distância zero para a mesma amostra', () => {
    const a = summarize([
      { r: 10, g: 20, b: 30 },
      { r: 12, g: 18, b: 28 },
    ]);
    expect(sampleDistance(a, a)).toBe(0);
  });

  it('marca só a casa que mudou de cor', () => {
    const ref = { a1: flat([20, 20, 20]), b1: flat([200, 200, 200]) };
    const cur = { a1: flat([210, 210, 210]), b1: flat([200, 200, 200]) };
    expect(changedSquares(cur, ref, 0.2)).toEqual(['a1']);
  });
});

describe('casas tocadas pelo lance', () => {
  const start = new Chess().fen();

  it('lance simples', () => {
    expect(squaresTouched(sanMove(start, 'e4'))).toEqual(['e2', 'e4']);
  });

  it('roque curto', () => {
    const fen = 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1';
    expect(squaresTouched(sanMove(fen, 'O-O'))).toEqual(['e1', 'f1', 'g1', 'h1']);
  });

  it('roque longo', () => {
    const fen = 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1';
    expect(squaresTouched(sanMove(fen, 'O-O-O'))).toEqual(['a1', 'c1', 'd1', 'e1']);
  });

  it('en passant', () => {
    const fen = 'rnbqkbnr/ppp1pppp/8/3pP3/8/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 3';
    const mv = new Chess(fen).moves({ verbose: true }).find((m) => m.flags.includes('e'));
    expect(mv).toBeTruthy();
    expect(squaresTouched(mv!)).toEqual(['d5', 'd6', 'e5']);
  });

  it('a FEN gravada no jogo é a mesma do lance', () => {
    const e4 = sanMove(start, 'e4');
    const next = gameReducer(initialGame(), { type: 'move', from: 'e2', to: 'e4' });
    expect(next.fens[1]).toBe(e4.after);
    expect(moveBetween(start, e4.after)?.san).toBe('e4');
  });
});

describe('acompanhamento', () => {
  const start = new Chess().fen();
  const white = { playerColor: 'white' as const };

  it('com as brancas, começa na vez do jogador', () => {
    expect(initialPhase(start, 'white').kind).toBe('player');
  });

  it('com as pretas, espera o Stockfish primeiro', () => {
    expect(initialPhase(start, 'black').kind).toBe('wait');
  });

  it('não aceita o lance antes da imagem estabilizar', () => {
    const e4 = sanMove(start, 'e4');
    const phase: TrackPhase = { kind: 'player', fen: start };
    const r = stepTracker(phase, { liveFen: start, changed: squaresTouched(e4), stable: false, ...white });
    expect(r.phase.kind).toBe('player');
    expect(r.event?.type).toBe('status');
  });

  it('lê e4 e depois espera a resposta no tabuleiro', () => {
    const e4 = sanMove(start, 'e4');
    let phase: TrackPhase = { kind: 'player', fen: start };
    let r = stepTracker(phase, { liveFen: start, changed: squaresTouched(e4), stable: true, ...white });
    expect(r.event?.type).toBe('player-move');
    if (r.event?.type === 'player-move') expect(r.event.move.san).toBe('e4');
    phase = r.phase;

    r = stepTracker(phase, { liveFen: start, changed: [], stable: false, ...white });
    expect(r.phase.kind).toBe('gap');

    r = stepTracker(phase, { liveFen: e4.after, changed: [], stable: false, ...white });
    expect(r.phase.kind).toBe('wait');
    phase = r.phase;

    const e5 = sanMove(e4.after, 'e5');
    r = stepTracker(phase, { liveFen: e5.after, changed: [], stable: false, ...white });
    expect(r.phase.kind).toBe('engine');
    if (r.phase.kind === 'engine') expect(r.phase.move.san).toBe('e5');
    phase = r.phase;

    r = stepTracker(phase, { liveFen: e5.after, changed: squaresTouched(e5), stable: false, ...white });
    expect(r.event?.type).toBe('status');
    expect(r.phase.kind).toBe('engine');

    r = stepTracker(phase, { liveFen: e5.after, changed: squaresTouched(e5), stable: true, ...white });
    expect(r.event?.type).toBe('engine-seen');
    expect(r.phase.kind).toBe('player');
  });

  it('ignora a mão cobrindo várias casas', () => {
    const phase: TrackPhase = { kind: 'player', fen: start };
    const changed = ['a2', 'b2', 'c2', 'd2', 'e2', 'f2', 'g2'];
    const r = stepTracker(phase, { liveFen: start, changed, stable: true, ...white });
    expect(r.phase.kind).toBe('player');
    expect(r.event?.text).toMatch(/Mão/);
  });

  it('pede novo alinhamento se a tela pula vários lances', () => {
    const phase: TrackPhase = { kind: 'player', fen: start };
    const far = new Chess();
    far.move('e4');
    far.move('e5');
    far.move('Nf3');
    const r = stepTracker(phase, { liveFen: far.fen(), changed: [], stable: false, ...white });
    expect(r.phase.kind).toBe('align');
    expect(r.event?.type).toBe('need-align');
  });

  it('xeque-mate não fica esperando o Stockfish', () => {
    const fen = 'k7/2Q5/1K6/8/8/8/8/8 w - - 0 1';
    const mv = sanMove(fen, 'Qa7#');
    const phase: TrackPhase = { kind: 'gap', fromFen: fen, afterFen: mv.after };
    const r = stepTracker(phase, { liveFen: mv.after, changed: [], stable: false, ...white });
    expect(r.phase.kind).toBe('done');
  });

  it('na promoção, escolhe a dama', () => {
    const fen = '4k3/P7/8/8/8/8/8/4K3 w - - 0 1';
    const phase: TrackPhase = { kind: 'player', fen };
    const r = stepTracker(phase, { liveFen: fen, changed: ['a7', 'a8'], stable: true, ...white });
    expect(r.event?.type).toBe('player-move');
    if (r.event?.type === 'player-move') expect(r.event.move.promotion).toBe('q');
  });

  it('sameSquares ignora a ordem', () => {
    expect(sameSquares(['e4', 'e2'], ['e2', 'e4'])).toBe(true);
    expect(sameSquares(['e2', 'e4'], ['e2', 'e3'])).toBe(false);
  });
});
