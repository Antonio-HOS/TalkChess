import { Chess, DEFAULT_POSITION, type Move } from 'chess.js';

export type Color = 'white' | 'black';

export type ResultReason =
  | 'checkmate'
  | 'stalemate'
  | 'repetition'
  | 'insufficient'
  | 'fifty'
  | 'resign'
  | 'timeout'
  | 'agreement';

export interface GameResult {
  winner: Color | null; // null = empate
  reason: ResultReason;
}

export interface GameState {
  startFen: string;
  moves: Move[];
  /** fens[0] = posição inicial, fens[i] = posição após o lance i */
  fens: string[];
  manualResult: GameResult | null;
}

export type GameAction =
  | { type: 'reset'; fen?: string }
  | { type: 'move'; from: string; to: string; promotion?: string }
  | { type: 'undo'; count: number }
  | { type: 'result'; result: GameResult }
  | { type: 'set'; state: GameState };

export const START_FEN = DEFAULT_POSITION;

export function initialGame(fen: string = START_FEN): GameState {
  return { startFen: fen, moves: [], fens: [fen], manualResult: null };
}

/** Reconstrói um Chess com todo o histórico (necessário para detectar repetição). */
export function buildChess(state: Pick<GameState, 'startFen' | 'moves'>): Chess {
  const c = new Chess(state.startFen);
  for (const m of state.moves) c.move({ from: m.from, to: m.to, promotion: m.promotion });
  return c;
}

export function gameReducer(state: GameState, action: GameAction): GameState {
  switch (action.type) {
    case 'reset':
      return initialGame(action.fen);
    case 'move': {
      if (state.manualResult || detectResult(buildChess(state))) return state;
      const c = buildChess(state);
      let move: Move;
      try {
        move = c.move({ from: action.from, to: action.to, promotion: action.promotion });
      } catch {
        return state;
      }
      return { ...state, moves: [...state.moves, move], fens: [...state.fens, c.fen()] };
    }
    case 'undo': {
      const n = Math.max(0, Math.min(action.count, state.moves.length));
      if (n === 0) return state;
      return {
        ...state,
        moves: state.moves.slice(0, state.moves.length - n),
        fens: state.fens.slice(0, state.fens.length - n),
        manualResult: null,
      };
    }
    case 'result':
      return { ...state, manualResult: action.result };
    case 'set':
      return action.state;
  }
}

/** Constrói um GameState a partir de um PGN (com ou sem cabeçalhos). */
export function gameFromPgn(pgn: string): { state: GameState; headers: Record<string, string> } {
  const c = new Chess();
  c.loadPgn(pgn);
  const moves = c.history({ verbose: true });
  if (moves.length === 0) throw new Error('O PGN não contém lances.');
  const headers = c.header() as Record<string, string>;
  const startFen = headers.SetUp === '1' && headers.FEN ? headers.FEN : START_FEN;
  const fens = [startFen, ...moves.map((m) => m.after)];
  return { state: { startFen, moves, fens, manualResult: null }, headers };
}

export function detectResult(c: Chess): GameResult | null {
  if (c.isCheckmate()) return { winner: c.turn() === 'w' ? 'black' : 'white', reason: 'checkmate' };
  if (c.isStalemate()) return { winner: null, reason: 'stalemate' };
  if (c.isInsufficientMaterial()) return { winner: null, reason: 'insufficient' };
  if (c.isThreefoldRepetition()) return { winner: null, reason: 'repetition' };
  if (c.isDrawByFiftyMoves()) return { winner: null, reason: 'fifty' };
  return null;
}

export function resultOf(state: GameState): GameResult | null {
  return state.manualResult ?? detectResult(buildChess(state));
}

export function resultText(r: GameResult, player?: Color): string {
  const reasons: Record<ResultReason, string> = {
    checkmate: 'xeque-mate',
    stalemate: 'afogamento',
    repetition: 'tripla repetição',
    insufficient: 'material insuficiente',
    fifty: 'regra dos 50 lances',
    resign: 'desistência',
    timeout: 'tempo esgotado',
    agreement: 'acordo',
  };
  if (!r.winner) return `Empate por ${reasons[r.reason]}`;
  const who = player ? (r.winner === player ? 'Você venceu' : 'Stockfish venceu') : r.winner === 'white' ? 'Brancas vencem' : 'Pretas vencem';
  return `${who} por ${reasons[r.reason]}`;
}

export function pgnResultToken(r: GameResult | null): string {
  if (!r) return '*';
  return r.winner === 'white' ? '1-0' : r.winner === 'black' ? '0-1' : '1/2-1/2';
}

export function exportPgn(
  state: GameState,
  meta: { white: string; black: string; whiteElo?: number; blackElo?: number; event?: string },
): string {
  const c = buildChess(state);
  const result = resultOf(state);
  const d = new Date();
  const date = `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
  c.setHeader('Event', meta.event ?? 'TalkChess');
  c.setHeader('Site', 'TalkChess');
  c.setHeader('Date', date);
  c.setHeader('White', meta.white);
  c.setHeader('Black', meta.black);
  if (meta.whiteElo) c.setHeader('WhiteElo', String(meta.whiteElo));
  if (meta.blackElo) c.setHeader('BlackElo', String(meta.blackElo));
  c.setHeader('Result', pgnResultToken(result));
  return c.pgn();
}

// ---------------------------------------------------------------------------
// Utilidades de lance / posição
// ---------------------------------------------------------------------------

export function uciToMove(uci: string): { from: string; to: string; promotion?: string } {
  return { from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.length > 4 ? uci[4] : undefined };
}

export function uciToSan(fen: string, uci: string): string | null {
  try {
    const c = new Chess(fen);
    return c.move(uciToMove(uci)).san;
  } catch {
    return null;
  }
}

/** Converte uma variante principal (UCI) em SAN, parando no primeiro lance inválido. */
export function pvToSan(fen: string, pv: string[], limit = 8): string[] {
  const c = new Chess(fen);
  const out: string[] = [];
  for (const u of pv.slice(0, limit)) {
    try {
      out.push(c.move(uciToMove(u)).san);
    } catch {
      break;
    }
  }
  return out;
}

export function randomLegalMove(fen: string): { from: string; to: string; promotion?: string } | null {
  const moves = new Chess(fen).moves({ verbose: true });
  if (moves.length === 0) return null;
  const m = moves[Math.floor(Math.random() * moves.length)];
  return { from: m.from, to: m.to, promotion: m.promotion };
}

const VALUES: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9 };
const INITIAL: Record<string, number> = { p: 8, n: 2, b: 2, r: 2, q: 1 };

export interface Material {
  /** peças que as brancas capturaram (pretas perdidas) */
  capturedByWhite: string[];
  capturedByBlack: string[];
  /** vantagem das brancas em pontos (negativo = pretas à frente) */
  diff: number;
}

export function materialOf(fen: string): Material {
  const board = fen.split(' ')[0];
  const w: Record<string, number> = { p: 0, n: 0, b: 0, r: 0, q: 0 };
  const b: Record<string, number> = { p: 0, n: 0, b: 0, r: 0, q: 0 };
  for (const ch of board) {
    const lower = ch.toLowerCase();
    if (!(lower in VALUES)) continue;
    if (ch === lower) b[lower]++;
    else w[lower]++;
  }
  const order = ['q', 'r', 'b', 'n', 'p'];
  const capturedByWhite: string[] = [];
  const capturedByBlack: string[] = [];
  let diff = 0;
  for (const p of order) {
    for (let i = 0; i < Math.max(0, INITIAL[p] - b[p]); i++) capturedByWhite.push(p);
    for (let i = 0; i < Math.max(0, INITIAL[p] - w[p]); i++) capturedByBlack.push(p);
    diff += (w[p] - b[p]) * VALUES[p];
  }
  return { capturedByWhite, capturedByBlack, diff };
}

// ---------------------------------------------------------------------------
// Avaliação
// ---------------------------------------------------------------------------

export interface Evaluation {
  /** do ponto de vista das brancas */
  cp?: number;
  mate?: number;
  depth: number;
  pv: string[];
}

export function toWhitePerspective(
  fen: string,
  info: { cp?: number; mate?: number; depth: number; pv: string[] },
): Evaluation {
  const sign = fen.split(' ')[1] === 'b' ? -1 : 1;
  return {
    cp: info.cp !== undefined ? info.cp * sign : undefined,
    mate: info.mate !== undefined ? info.mate * sign : undefined,
    depth: info.depth,
    pv: info.pv,
  };
}

export function evalLabel(e: Evaluation | null): string {
  if (!e) return '–';
  if (e.cp !== undefined && Math.abs(e.cp) >= 10000) return '#';
  if (e.mate !== undefined) return e.mate === 0 ? '#' : `${e.mate > 0 ? '' : '-'}M${Math.abs(e.mate)}`;
  const v = (e.cp ?? 0) / 100;
  return `${v > 0 ? '+' : ''}${v.toFixed(1)}`;
}

/** Percentual de barra (0..100) favorável às brancas — mesma curva do Lichess. */
export function evalPercent(e: Evaluation | null): number {
  if (!e) return 50;
  if (e.mate !== undefined) return e.mate > 0 ? 100 : e.mate < 0 ? 0 : 50;
  const cp = Math.max(-1000, Math.min(1000, e.cp ?? 0));
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
}

export function formatClock(ms: number): string {
  const total = Math.max(0, ms);
  if (total < 20_000) {
    const s = Math.floor(total / 1000);
    const t = Math.floor((total % 1000) / 100);
    return `${s}.${t}`;
  }
  const secs = Math.ceil(total / 1000);
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
