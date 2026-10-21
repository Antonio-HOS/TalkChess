import { Chess, type Move } from 'chess.js';

/**
 * Interpretador de lances falados (pt-BR e inglês).
 *
 * Estratégia: a fala é convertida em *restrições* (peça, casa de origem/destino,
 * captura, promoção...) e confrontada com a lista de lances LEGAIS da posição.
 * Assim "cavalo f3", "Nf3", "cavalo g1 para f3", "g1 f3" e "efe três" chegam ao mesmo lance,
 * e a ambiguidade é detectada de forma precisa.
 */

export type VoiceAction = 'undo' | 'new' | 'resign' | 'hint' | 'flip' | 'draw' | 'repeat' | 'stop' | 'confirm' | 'cancel';

export type VoiceResult =
  | { kind: 'move'; move: Move; heard: string }
  | { kind: 'ambiguous'; candidates: Move[]; heard: string }
  | { kind: 'illegal'; heard: string; reason: string }
  | { kind: 'action'; action: VoiceAction; heard: string }
  | { kind: 'unknown'; heard: string };

// ---------------------------------------------------------------------------
// Vocabulário
// ---------------------------------------------------------------------------

/** Dicionário sem protótipo (evita colisões com propriedades de Object). */
function dict(o: Record<string, string>): Record<string, string> {
  return Object.assign(Object.create(null) as Record<string, string>, o);
}

/** Palavras que SEMPRE representam uma coluna. */
const FILE_STRICT = dict({
  b: 'b', be: 'b', bee: 'b', bravo: 'b',
  c: 'c', ce: 'c', cee: 'c', charlie: 'c', see: 'c', sea: 'c',
  d: 'd', dee: 'd', delta: 'd',
  f: 'f', efe: 'f', ef: 'f', eff: 'f', foxtrot: 'f',
  g: 'g', ge: 'g', gee: 'g', golf: 'g', jee: 'g',
  h: 'h', aga: 'h', hache: 'h', ache: 'h', aitch: 'h', hotel: 'h',
  alpha: 'a', alfa: 'a', echo: 'e',
});

/** Palavras que podem ser coluna, mas também são palavras comuns (só valem antes de um número). */
const FILE_LOOSE = dict({
  a: 'a', ah: 'a',
  e: 'e', eh: 'e', ee: 'e',
  de: 'd', da: 'd', di: 'd',
  se: 'c', ci: 'c', si: 'c',
  je: 'g', ja: 'g',
  ha: 'h',
});

const NUMBERS = dict({
  um: '1', uma: '1', one: '1', hum: '1',
  dois: '2', duas: '2', two: '2',
  tres: '3', three: '3',
  quatro: '4', four: '4',
  cinco: '5', five: '5',
  seis: '6', six: '6',
  sete: '7', seven: '7',
  oito: '8', eight: '8',
});

const PIECES = dict({
  peao: 'p', peoes: 'p', pawn: 'p',
  cavalo: 'n', cavalos: 'n', knight: 'n', horse: 'n',
  bispo: 'b', bispos: 'b', bishop: 'b',
  torre: 'r', torres: 'r', rook: 'r',
  dama: 'q', rainha: 'q', queen: 'q',
  rei: 'k', king: 'k',
});

const CAPTURE_WORDS = new Set([
  'toma', 'tomar', 'tomando', 'captura', 'capturar', 'come', 'comer', 'x', 'takes', 'take', 'captures', 'capture',
]);
const PROMO_WORDS = new Set([
  'promove', 'promover', 'promovendo', 'promocao', 'coroa', 'coroar', 'vira', 'transforma', 'igual', 'promotes', 'promote', 'promotion',
]);

const ACTIONS: Array<[VoiceAction, string[]]> = [
  ['undo', ['desfazer', 'desfaz', 'desfaca', 'voltar', 'volta', 'undo', 'takeback', 'retroceder']],
  ['new', ['nova partida', 'novo jogo', 'reiniciar', 'recomecar', 'new game', 'restart']],
  ['resign', ['desistir', 'desisto', 'abandonar', 'abandono', 'resign', 'me rendo', 'render']],
  ['hint', ['dica', 'sugestao', 'sugerir', 'sugira', 'ajuda', 'hint', 'melhor lance', 'melhor jogada']],
  ['flip', ['girar', 'gira', 'virar', 'vira tabuleiro', 'inverter', 'inverte', 'flip', 'rodar']],
  ['draw', ['empate', 'empatar', 'propor empate', 'oferecer empate', 'draw']],
  ['repeat', ['repetir', 'repete', 'ultima jogada', 'ultimo lance', 'qual foi', 'repeat']],
  ['stop', ['parar de ouvir', 'parar escuta', 'desligar microfone', 'stop listening']],
  ['confirm', ['confirmar', 'confirmo', 'confirma', 'sim', 'yes', 'confirm', 'pode']],
  ['cancel', ['cancelar', 'cancela', 'nao', 'no', 'cancel', 'esquece']],
];

// ---------------------------------------------------------------------------
// Normalização
// ---------------------------------------------------------------------------

export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/0-0-0|o-o-o/g, ' roque longo ')
    .replace(/0-0|o-o/g, ' roque curto ')
    .replace(/[×:→]/g, ' x ')
    .replace(/->/g, ' ')
    .replace(/[.,;!?'"()]/g, ' ')
    .replace(/[-_/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const isNumberToken = (t: string) => /^[1-8]$/.test(t) || t in NUMBERS;
const toDigit = (t: string) => (/^[1-8]$/.test(t) ? t : NUMBERS[t]);

// ---------------------------------------------------------------------------
// Extração de restrições
// ---------------------------------------------------------------------------

interface Interp {
  piece?: string;
  squares: string[];
  capture: boolean;
  promo?: string;
  fromFile?: string;
  fromRank?: string;
  castle?: 'k' | 'q' | 'any';
}

const SAN_GLUED = /^([nbrqk])?([a-h])?([1-8])?(x)?([a-h][1-8])(?:=?([nbrq]))?[+#]?$/;
const UCI_GLUED = /^([a-h][1-8])([a-h][1-8])(?:=?([nbrq]))?$/;

/** Converte a fala normalizada em uma ou mais interpretações (alternativas). */
export function extractInterps(norm: string): Interp[] {
  // roque
  if (/\broque\b|\bcastle\b|\bcastles\b|\bcastling\b/.test(norm)) {
    let castle: Interp['castle'] = 'any';
    if (/\b(curto|pequeno|menor|short|king|kingside|lado do rei)\b/.test(norm)) castle = 'k';
    else if (/\b(longo|grande|maior|long|queen|queenside|lado da dama)\b/.test(norm)) castle = 'q';
    return [{ squares: [], capture: false, castle }];
  }

  const tokens = norm.split(' ').filter(Boolean);
  const base: Interp = { squares: [], capture: false };
  const alternatives: Interp[] = [];
  let expectPromo = false;
  let pendingCaptureBeforePiece = false;

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const next = tokens[i + 1];

    // UCI colado: e2e4, e7e8q
    const uci = UCI_GLUED.exec(t);
    if (uci) {
      base.squares.push(uci[1], uci[2]);
      if (uci[3]) base.promo = uci[3];
      continue;
    }

    // Casa colada "e4" / SAN colado "nf3", "exd5", "bxc3", "e8=q"
    const glued = t.length >= 2 ? SAN_GLUED.exec(t) : null;
    if (glued && !(t in PIECES) && !(t in NUMBERS) && !(t in FILE_STRICT) && !(t in FILE_LOOSE)) {
      const [, piece, file, rank, x, sq, promo] = glued;
      base.squares.push(sq);
      if (x) base.capture = true;
      if (promo) base.promo = promo;
      if (piece && !base.piece) base.piece = piece;
      if (file) base.fromFile = file;
      if (rank) base.fromRank = rank;
      // "bxc3": pode ser peão da coluna b OU bispo
      if (piece === 'b' && x && !file && !rank) {
        const alt: Interp = { ...base, squares: [...base.squares], piece: undefined, fromFile: 'b' };
        alternatives.push(alt);
      }
      continue;
    }

    if (t === '=') {
      expectPromo = true;
      continue;
    }

    // peça
    if (t in PIECES) {
      const p = PIECES[t];
      if (expectPromo) {
        base.promo = p;
        expectPromo = false;
      } else if (!base.piece && base.squares.length === 0 && !pendingCaptureBeforePiece) {
        base.piece = p;
      } else if (base.squares.length >= 1 && !base.promo && 'qrbn'.includes(p)) {
        const last = base.squares[base.squares.length - 1];
        const rankChar = last[1];
        const prev = tokens[i - 1];
        if ((rankChar === '8' || rankChar === '1') && !CAPTURE_WORDS.has(prev)) base.promo = p;
      }
      continue;
    }

    if (CAPTURE_WORDS.has(t)) {
      base.capture = true;
      if (base.squares.length === 0) pendingCaptureBeforePiece = true;
      continue;
    }
    if (PROMO_WORDS.has(t)) {
      expectPromo = true;
      continue;
    }

    // letra + número => casa ("e quatro", "bê 4", "efe três")
    const fileWord = t in FILE_STRICT ? FILE_STRICT[t] : t in FILE_LOOSE ? FILE_LOOSE[t] : undefined;
    if (fileWord && next && isNumberToken(next)) {
      base.squares.push(fileWord + toDigit(next));
      i++;
      continue;
    }

    // Coluna sozinha: dica de origem se é inequívoca, ou se antecede "toma"
    if (fileWord) {
      const strict = t in FILE_STRICT || /^[a-h]$/.test(t);
      const beforeCapture = next !== undefined && CAPTURE_WORDS.has(next);
      const afterPiece = base.piece !== undefined && base.squares.length === 0;
      if ((strict && (beforeCapture || afterPiece)) || (beforeCapture && base.squares.length === 0)) {
        base.fromFile = fileWord;
      }
      continue;
    }

    // Linha sozinha (somente dígito) => dica de origem
    if (/^[1-8]$/.test(t) && base.squares.length === 0 && base.piece) {
      base.fromRank = t;
      continue;
    }
    // demais palavras (para, pra, em, vai, de, ...) são ignoradas
  }

  if (base.squares.length === 0) return [];
  return [base, ...alternatives];
}

// ---------------------------------------------------------------------------
// Casamento com lances legais
// ---------------------------------------------------------------------------

function filterMoves(moves: Move[], it: Interp, level: number): Move[] {
  return moves.filter((m) => {
    const to = it.squares[it.squares.length - 1];
    if (m.to !== to) return false;
    if (it.squares.length >= 2 && m.from !== it.squares[it.squares.length - 2]) return false;
    if (it.piece) {
      if (m.piece !== it.piece) return false;
    } else if (it.squares.length < 2 && level < 3) {
      // sem peça falada e sem casa de origem => peão
      if (m.piece !== 'p') return false;
    }
    if (level < 1 && it.capture && !m.captured) return false;
    if (level < 2) {
      if (it.fromFile && m.from[0] !== it.fromFile) return false;
      if (it.fromRank && m.from[1] !== it.fromRank) return false;
    }
    if (it.promo) {
      if (m.promotion !== it.promo) return false;
    } else if (m.promotion && m.promotion !== 'q') {
      return false; // promoção padrão: dama
    }
    return true;
  });
}

function matchInterp(moves: Move[], it: Interp): Move[] {
  if (it.castle) {
    const side = (m: Move) => (m.flags.includes('k') ? 'k' : m.flags.includes('q') ? 'q' : null);
    return moves.filter((m) => side(m) !== null && (it.castle === 'any' || side(m) === it.castle));
  }
  for (let level = 0; level <= 3; level++) {
    const found = filterMoves(moves, it, level);
    if (found.length > 0) return found;
  }
  return [];
}

function detectAction(norm: string): VoiceAction | null {
  const padded = ` ${norm} `;
  for (const [action, phrases] of ACTIONS) {
    for (const ph of phrases) {
      if (padded.includes(` ${ph} `)) return action;
    }
  }
  return null;
}

/** Interpreta UMA transcrição. */
export function parseOne(transcript: string, fen: string): VoiceResult {
  const heard = transcript.trim();
  const norm = normalize(transcript);
  if (!norm) return { kind: 'unknown', heard };

  const interps = extractInterps(norm);
  if (interps.length === 0) {
    const action = detectAction(norm);
    return action ? { kind: 'action', action, heard } : { kind: 'unknown', heard };
  }

  let moves: Move[];
  try {
    moves = new Chess(fen).moves({ verbose: true });
  } catch {
    return { kind: 'unknown', heard };
  }

  let firstAmbiguous: Move[] | null = null;
  for (const it of interps) {
    const found = matchInterp(moves, it);
    if (found.length === 1) return { kind: 'move', move: found[0], heard };
    if (found.length > 1 && !firstAmbiguous) firstAmbiguous = found;
  }
  if (firstAmbiguous) {
    // Cobre lances duplicados por promoção (mesma casa, peças diferentes) sem ruído
    return { kind: 'ambiguous', candidates: firstAmbiguous, heard };
  }

  const it = interps[0];
  const what = it.castle
    ? 'Esse roque não é possível agora'
    : `Lance ilegal: ${it.piece ? pieceName(it.piece) + ' ' : ''}${it.squares.join(' → ')}`;
  return { kind: 'illegal', heard, reason: what };
}

/**
 * Interpreta várias hipóteses de reconhecimento (SpeechRecognition devolve alternativas)
 * e escolhe a melhor: primeiro um lance inequívoco, depois ação, ambiguidade, ilegal.
 */
export function parseVoice(transcripts: string[], fen: string): VoiceResult {
  const results = transcripts.filter((t) => t.trim()).map((t) => parseOne(t, fen));
  if (results.length === 0) return { kind: 'unknown', heard: '' };
  const order: VoiceResult['kind'][] = ['move', 'action', 'ambiguous', 'illegal', 'unknown'];
  for (const k of order) {
    const r = results.find((x) => x.kind === k);
    if (r) return r;
  }
  return results[0];
}

export function pieceName(p: string): string {
  return { p: 'peão', n: 'cavalo', b: 'bispo', r: 'torre', q: 'dama', k: 'rei' }[p] ?? p;
}

// ---------------------------------------------------------------------------
// Fala (TTS)
// ---------------------------------------------------------------------------

const FILE_SPOKEN: Record<string, string> = {
  a: 'a', b: 'bê', c: 'cê', d: 'dê', e: 'é', f: 'efe', g: 'gê', h: 'agá',
};

export function spokenSquare(sq: string): string {
  return `${FILE_SPOKEN[sq[0]] ?? sq[0]} ${sq[1]}`;
}

/** Descreve um lance em português para ser lido em voz alta. */
export function spokenMove(m: Move): string {
  let text: string;
  if (m.flags.includes('k')) text = 'Roque curto';
  else if (m.flags.includes('q')) text = 'Roque longo';
  else {
    const verb = m.captured ? ' toma em ' : ' ';
    text = `${capitalize(pieceName(m.piece))}${verb}${spokenSquare(m.to)}`;
    if (m.promotion) text += `, promove para ${pieceName(m.promotion)}`;
  }
  if (m.san.endsWith('#')) text += ', xeque-mate';
  else if (m.san.endsWith('+')) text += ', xeque';
  return text;
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Texto curto para exibir uma opção ambígua. */
export function describeCandidate(m: Move): string {
  if (m.flags.includes('k')) return 'Roque curto';
  if (m.flags.includes('q')) return 'Roque longo';
  return `${capitalize(pieceName(m.piece))} ${m.from} → ${m.to}${m.captured ? ' (captura)' : ''}`;
}
