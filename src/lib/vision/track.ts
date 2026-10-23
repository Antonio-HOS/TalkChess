/**
 * Lê um lance a partir das casas que mudaram de aparência.
 *
 * A câmera não precisa reconhecer o tipo da peça. A posição digital já é
 * conhecida; o conjunto de casas que mudou (origem, destino, torre do roque,
 * peão do en passant) identifica o lance legal. Muitas casas ao mesmo tempo
 * são a mão cobrindo o tabuleiro e são ignoradas.
 */

import { Chess, type Move } from 'chess.js';
import type { Color } from '../game';

export type TrackPhase =
  | { kind: 'align' }
  | { kind: 'player'; fen: string }
  | { kind: 'gap'; fromFen: string; afterFen: string }
  | { kind: 'wait'; fen: string }
  | { kind: 'engine'; fen: string; move: Move }
  | { kind: 'done'; fen: string };

export interface TrackObservation {
  liveFen: string;
  changed: string[];
  /** O mesmo conjunto de casas permaneceu por vários quadros seguidos. */
  stable: boolean;
  playerColor: Color;
}

export type TrackEvent =
  | { type: 'player-move'; move: Move; text: string }
  | { type: 'engine-seen'; move: Move; text: string }
  | { type: 'need-align'; text: string }
  | { type: 'status'; text: string };

const HAND_LIMIT = 6;
const HAND = 'Mão no tabuleiro, sombra ou a câmera se mexeu. Afaste a mão e deixe a imagem firme.';
const REALIGN = 'A posição na tela mudou. Deixe o tabuleiro físico igual ao da tela e confirme de novo.';

const byName = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function sameSquares(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const as = a.slice().sort(byName);
  const bs = b.slice().sort(byName);
  return as.every((sq, i) => sq === bs[i]);
}

function turnOf(fen: string): Color {
  return fen.split(' ')[1] === 'b' ? 'black' : 'white';
}

function isOver(fen: string): boolean {
  try {
    return new Chess(fen).isGameOver();
  } catch {
    return false;
  }
}

function finished(fen: string): { phase: TrackPhase; event: TrackEvent } {
  return { phase: { kind: 'done', fen }, event: { type: 'status', text: 'Partida encerrada.' } };
}

/** Casas cujo aspecto muda quando o lance é feito no tabuleiro. */
export function squaresTouched(move: Move): string[] {
  const set = new Set<string>([move.from, move.to]);
  const rank = move.from[1];
  if (move.flags.includes('k')) {
    set.add(`h${rank}`);
    set.add(`f${rank}`);
  } else if (move.flags.includes('q')) {
    set.add(`a${rank}`);
    set.add(`d${rank}`);
  } else if (move.flags.includes('e')) {
    set.add(`${move.to[0]}${rank}`);
  }
  return [...set].sort(byName);
}

export function moveBetween(fromFen: string, toFen: string): Move | null {
  let chess: Chess;
  try {
    chess = new Chess(fromFen);
  } catch {
    return null;
  }
  for (const mv of chess.moves({ verbose: true })) {
    if (mv.after === toFen) return mv;
  }
  return null;
}

export function initialPhase(fen: string, playerColor: Color): TrackPhase {
  if (isOver(fen)) return { kind: 'done', fen };
  return turnOf(fen) === playerColor ? { kind: 'player', fen } : { kind: 'wait', fen };
}

const PROMO_RANK: Record<string, number> = { q: 0, r: 1, b: 2, n: 3 };

function matchPlayerMove(fen: string, changed: string[]): Move | null {
  let chess: Chess;
  try {
    chess = new Chess(fen);
  } catch {
    return null;
  }
  const hits = chess.moves({ verbose: true }).filter((m) => sameSquares(squaresTouched(m), changed));
  if (hits.length === 0) return null;
  hits.sort((a, b) => (PROMO_RANK[a.promotion ?? ''] ?? -1) - (PROMO_RANK[b.promotion ?? ''] ?? -1));
  return hits[0];
}

function replyPhase(physicalFen: string, liveFen: string): { phase: TrackPhase; event: TrackEvent } | null {
  if (liveFen === physicalFen) return null;
  const reply = moveBetween(physicalFen, liveFen);
  if (!reply) return { phase: { kind: 'align' }, event: { type: 'need-align', text: REALIGN } };
  return {
    phase: { kind: 'engine', fen: physicalFen, move: reply },
    event: { type: 'status', text: `Faça no tabuleiro: ${reply.san}` },
  };
}

function afterEngine(move: Move, playerColor: Color): TrackPhase {
  const after = move.after;
  if (isOver(after)) return { kind: 'done', fen: after };
  return turnOf(after) === playerColor ? { kind: 'player', fen: after } : { kind: 'wait', fen: after };
}

/**
 * Um passo do acompanhamento. Não olha pixels: recebe as casas já classificadas
 * como diferentes da referência e a FEN que a tela está mostrando.
 */
export function stepTracker(phase: TrackPhase, obs: TrackObservation): { phase: TrackPhase; event: TrackEvent | null } {
  if (phase.kind === 'align') return { phase, event: null };

  if (phase.kind === 'done') {
    if (obs.liveFen !== phase.fen) return { phase: { kind: 'align' }, event: { type: 'need-align', text: REALIGN } };
    return { phase, event: { type: 'status', text: 'Partida encerrada.' } };
  }

  if (phase.kind === 'gap') {
    if (obs.liveFen === phase.fromFen) return { phase, event: { type: 'status', text: 'Registrando o seu lance…' } };
    if (obs.liveFen === phase.afterFen) {
      if (isOver(phase.afterFen)) return finished(phase.afterFen);
      return { phase: { kind: 'wait', fen: phase.afterFen }, event: { type: 'status', text: 'Stockfish está pensando…' } };
    }
    return (
      replyPhase(phase.afterFen, obs.liveFen) ?? {
        phase: { kind: 'wait', fen: phase.afterFen },
        event: { type: 'status', text: 'Stockfish está pensando…' },
      }
    );
  }

  if (phase.kind === 'wait') {
    const jumped = replyPhase(phase.fen, obs.liveFen);
    if (jumped) return jumped;
    return { phase, event: { type: 'status', text: 'Stockfish está pensando…' } };
  }

  if (phase.kind === 'engine') {
    const expectedAfter = phase.move.after;
    if (obs.liveFen !== expectedAfter && obs.liveFen !== phase.fen) {
      const further = moveBetween(expectedAfter, obs.liveFen);
      if (!further) return { phase: { kind: 'align' }, event: { type: 'need-align', text: REALIGN } };
    }
    const expected = squaresTouched(phase.move);
    const prompt = `Faça no tabuleiro: ${phase.move.san}`;
    if (!obs.stable) {
      const text = obs.changed.length > HAND_LIMIT ? HAND : prompt;
      return { phase, event: { type: 'status', text } };
    }
    if (sameSquares(obs.changed, expected)) {
      return {
        phase: afterEngine(phase.move, obs.playerColor),
        event: { type: 'engine-seen', move: phase.move, text: 'Lance do Stockfish confirmado.' },
      };
    }
    if (obs.changed.length > HAND_LIMIT) {
      return { phase, event: { type: 'status', text: HAND } };
    }
    if (obs.changed.length > 0) {
      return {
        phase,
        event: { type: 'status', text: `Esse não é o lance do Stockfish (${phase.move.san}). Desfaça no tabuleiro.` },
      };
    }
    return { phase, event: { type: 'status', text: prompt } };
  }

  // vez do jogador, tabuleiro físico igual à FEN desta fase
  if (obs.liveFen !== phase.fen) {
    const unexpected = moveBetween(phase.fen, obs.liveFen);
    if (unexpected && turnOf(phase.fen) !== obs.playerColor) {
      return {
        phase: { kind: 'engine', fen: phase.fen, move: unexpected },
        event: { type: 'status', text: `Faça no tabuleiro: ${unexpected.san}` },
      };
    }
    return { phase: { kind: 'align' }, event: { type: 'need-align', text: REALIGN } };
  }

  if (!obs.stable) {
    if (obs.changed.length > HAND_LIMIT) {
      return { phase, event: { type: 'status', text: HAND } };
    }
    if (obs.changed.length > 0) return { phase, event: { type: 'status', text: 'Lendo o lance…' } };
    return { phase, event: { type: 'status', text: 'Sua vez — mova uma peça no tabuleiro.' } };
  }

  if (obs.changed.length > HAND_LIMIT) {
    return { phase, event: { type: 'status', text: HAND } };
  }
  if (obs.changed.length === 0) {
    return { phase, event: { type: 'status', text: 'Sua vez — mova uma peça no tabuleiro.' } };
  }

  const move = matchPlayerMove(phase.fen, obs.changed);
  if (!move) {
    const text =
      obs.changed.length < 2
        ? 'Só vi uma casa mudar. Termine o lance e tire a mão.'
        : 'Vi casas mudarem, mas isso não é um lance legal.';
    return { phase, event: { type: 'status', text } };
  }

  return {
    phase: { kind: 'gap', fromFen: phase.fen, afterFen: move.after },
    event: { type: 'player-move', move, text: `Lance lido: ${move.san}` },
  };
}
