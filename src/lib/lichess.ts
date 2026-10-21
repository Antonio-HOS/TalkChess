/**
 * Cliente mínimo da API pública do Lichess (https://lichess.org/api).
 * Os endpoints usados aqui têm CORS liberado e não exigem autenticação.
 */

const BASE = 'https://lichess.org';

export interface LichessPerf {
  games: number;
  rating: number;
  rd?: number;
  prog?: number;
  prov?: boolean;
}

export interface LichessUser {
  id: string;
  username: string;
  title?: string;
  online?: boolean;
  createdAt?: number;
  seenAt?: number;
  url: string;
  count?: { all: number; win: number; loss: number; draw: number; rated: number };
  perfs?: Record<string, LichessPerf>;
  profile?: { bio?: string; country?: string; realName?: string };
  playTime?: { total: number; tv: number };
}

export interface LichessGameSummary {
  id: string;
  rated: boolean;
  speed: string;
  perf: string;
  createdAt: number;
  status: string;
  winner?: 'white' | 'black';
  moves: string; // SAN separado por espaço
  players: {
    white: { user?: { name: string; title?: string }; rating?: number; aiLevel?: number };
    black: { user?: { name: string; title?: string }; rating?: number; aiLevel?: number };
  };
  opening?: { eco: string; name: string; ply: number };
}

export interface LichessPuzzle {
  gameId: string;
  pgn: string;
  initialPly: number;
  /** solução em UCI; o primeiro lance é do jogador */
  solution: string[];
  rating: number;
  plays: number;
  themes: string[];
  id: string;
}

async function getJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { Accept: 'application/json', ...(init?.headers ?? {}) },
  });
  if (res.status === 404) throw new Error('Não encontrado no Lichess.');
  if (res.status === 429) throw new Error('Muitas requisições ao Lichess. Aguarde um minuto e tente de novo.');
  if (!res.ok) throw new Error(`Lichess respondeu ${res.status}.`);
  return (await res.json()) as T;
}

export function cleanUsername(raw: string): string {
  return raw.trim().replace(/^@/, '').replace(/^https?:\/\/lichess\.org\/@\//i, '').replace(/\/.*$/, '');
}

export async function fetchUser(username: string): Promise<LichessUser> {
  const name = cleanUsername(username);
  if (!/^[A-Za-z0-9_-]{2,30}$/.test(name)) throw new Error('Nome de usuário inválido.');
  const u = await getJson<LichessUser>(`/api/user/${encodeURIComponent(name)}`);
  if ((u as unknown as { closed?: boolean }).closed) throw new Error('Esta conta do Lichess está fechada.');
  return u;
}

export async function fetchRecentGames(username: string, max = 12): Promise<LichessGameSummary[]> {
  const name = cleanUsername(username);
  const res = await fetch(
    `${BASE}/api/games/user/${encodeURIComponent(name)}?max=${max}&moves=true&opening=true&finished=true`,
    { headers: { Accept: 'application/x-ndjson' } },
  );
  if (res.status === 404) throw new Error('O Lichess não permite listar partidas recentes sem login.');
  if (res.status === 429) throw new Error('Muitas requisições ao Lichess. Aguarde um minuto.');
  if (!res.ok) throw new Error(`Lichess respondeu ${res.status}.`);
  const text = await res.text();
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l) as LichessGameSummary);
}

export async function fetchDailyPuzzle(): Promise<LichessPuzzle> {
  const d = await getJson<{
    game: { id: string; pgn: string };
    puzzle: { id: string; rating: number; plays: number; solution: string[]; themes: string[]; initialPly: number };
  }>('/api/puzzle/daily');
  return {
    gameId: d.game.id,
    pgn: d.game.pgn,
    initialPly: d.puzzle.initialPly,
    solution: d.puzzle.solution,
    rating: d.puzzle.rating,
    plays: d.puzzle.plays,
    themes: d.puzzle.themes,
    id: d.puzzle.id,
  };
}

export async function fetchPuzzleById(id: string): Promise<LichessPuzzle> {
  const d = await getJson<{
    game: { id: string; pgn: string };
    puzzle: { id: string; rating: number; plays: number; solution: string[]; themes: string[]; initialPly: number };
  }>(`/api/puzzle/${encodeURIComponent(id)}`);
  return {
    gameId: d.game.id,
    pgn: d.game.pgn,
    initialPly: d.puzzle.initialPly,
    solution: d.puzzle.solution,
    rating: d.puzzle.rating,
    plays: d.puzzle.plays,
    themes: d.puzzle.themes,
    id: d.puzzle.id,
  };
}

/** Baixa o PGN de uma partida do Lichess (aceita ID ou URL). */
export async function fetchGamePgn(idOrUrl: string): Promise<string> {
  const m = /lichess\.org\/([A-Za-z0-9]{8})/.exec(idOrUrl) ?? /^([A-Za-z0-9]{8})(?:[A-Za-z0-9]{4})?$/.exec(idOrUrl.trim());
  if (!m) throw new Error('Informe o ID (8 caracteres) ou o link de uma partida do Lichess.');
  // /game/export/{id} exige login; o export por lista de IDs funciona anonimamente.
  const res = await fetch(`${BASE}/api/games/export/_ids`, {
    method: 'POST',
    headers: { Accept: 'application/x-chess-pgn' },
    body: m[1],
  });
  if (res.status === 429) throw new Error('Muitas requisições ao Lichess. Aguarde um minuto.');
  if (!res.ok) throw new Error(`Lichess respondeu ${res.status}.`);
  const text = (await res.text()).trim();
  if (!text) throw new Error('Partida não encontrada.');
  return text;
}

/**
 * Importa um PGN no Lichess (anônimo) e devolve a URL da partida para análise.
 * Se a importação falhar (rede/CORS), cai para a análise por FEN.
 */
export async function importToLichess(pgn: string, fen: string): Promise<string> {
  try {
    const res = await fetch(`${BASE}/api/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({ pgn }).toString(),
    });
    if (res.ok) {
      const j = (await res.json()) as { url?: string };
      if (j.url) return j.url;
    }
  } catch {
    /* cai para o fallback */
  }
  return analysisUrl(fen);
}

export function analysisUrl(fen: string, color?: 'white' | 'black'): string {
  const path = fen.replace(/ /g, '_');
  return `${BASE}/analysis/${path}${color ? `?color=${color}` : ''}`;
}

export const lichessUrls = {
  home: BASE,
  puzzle: (id: string) => `${BASE}/training/${id}`,
  game: (id: string) => `${BASE}/${id}`,
  user: (name: string) => `${BASE}/@/${name}`,
};
