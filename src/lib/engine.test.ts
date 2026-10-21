import { describe, expect, it } from 'vitest';
import { parseInfo, strengthForElo } from './engine';
import { evalPercent, gameReducer, initialGame, materialOf, resultOf, toWhitePerspective } from './game';

describe('strengthForElo', () => {
  it('usa UCI_LimitStrength dentro da faixa do Stockfish', () => {
    const s = strengthForElo(1800);
    expect(s).toMatchObject({ limit: true, uciElo: 1800, skill: 20, blunderChance: 0 });
  });
  it('abaixo de 1320 reduz skill, limita profundidade e permite erros', () => {
    const s = strengthForElo(500);
    expect(s.limit).toBe(false);
    expect(s.depth).toBe(1);
    expect(s.skill).toBeLessThan(2);
    expect(s.blunderChance).toBeGreaterThan(0);
  });
  it('força máxima desliga o limitador', () => {
    expect(strengthForElo(3200)).toMatchObject({ limit: false, skill: 20 });
  });
  it('é monotônico em tempo de busca dentro da faixa limitada', () => {
    expect(strengthForElo(2800).movetime).toBeGreaterThan(strengthForElo(1400).movetime);
  });
  it('limita valores fora da faixa', () => {
    expect(strengthForElo(100).elo).toBe(400);
    expect(strengthForElo(9999).elo).toBe(3200);
  });
});

describe('parseInfo', () => {
  it('lê cp e pv', () => {
    const i = parseInfo('info depth 12 seldepth 18 multipv 1 score cp 34 nodes 100 nps 1 time 5 pv e2e4 e7e5 g1f3');
    expect(i).toEqual({ depth: 12, cp: 34, mate: undefined, pv: ['e2e4', 'e7e5', 'g1f3'] });
  });
  it('lê mate', () => {
    expect(parseInfo('info depth 5 score mate -2 pv h7h8')?.mate).toBe(-2);
  });
  it('ignora lowerbound/upperbound', () => {
    expect(parseInfo('info depth 11 score cp 20 lowerbound nodes 1 pv g1f3')).toBeNull();
  });
});

describe('modelo de jogo', () => {
  it('aplica lances, desfaz e detecta mate do louco', () => {
    let g = initialGame();
    for (const [from, to] of [['f2', 'f3'], ['e7', 'e5'], ['g2', 'g4'], ['d8', 'h4']]) {
      g = gameReducer(g, { type: 'move', from, to });
    }
    expect(g.moves).toHaveLength(4);
    expect(resultOf(g)).toEqual({ winner: 'black', reason: 'checkmate' });
    // não aceita lances após o fim
    expect(gameReducer(g, { type: 'move', from: 'a2', to: 'a3' }).moves).toHaveLength(4);
    g = gameReducer(g, { type: 'undo', count: 1 });
    expect(g.moves).toHaveLength(3);
    expect(resultOf(g)).toBeNull();
  });
  it('rejeita lance ilegal', () => {
    const g = gameReducer(initialGame(), { type: 'move', from: 'e2', to: 'e5' });
    expect(g.moves).toHaveLength(0);
  });
  it('detecta tripla repetição', () => {
    let g = initialGame();
    const seq = [['g1', 'f3'], ['g8', 'f6'], ['f3', 'g1'], ['f6', 'g8']];
    for (let i = 0; i < 2; i++) for (const [from, to] of seq) g = gameReducer(g, { type: 'move', from, to });
    expect(resultOf(g)?.reason).toBe('repetition');
  });
  it('material inicial é igual', () => {
    expect(materialOf(initialGame().startFen).diff).toBe(0);
  });
  it('avaliação é convertida para a perspectiva das brancas', () => {
    const e = toWhitePerspective('8/8/8/8/8/8/8/K6k b - - 0 1', { cp: 100, depth: 1, pv: [] });
    expect(e.cp).toBe(-100);
    expect(evalPercent(e)).toBeLessThan(50);
  });
});
