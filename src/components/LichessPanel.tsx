import { useState } from 'react';
import {
  cleanUsername,
  fetchDailyPuzzle,
  fetchGamePgn,
  fetchRecentGames,
  fetchUser,
  lichessUrls,
  type LichessGameSummary,
  type LichessPuzzle,
  type LichessUser,
} from '../lib/lichess';

interface Props {
  username: string;
  onUsernameChange: (v: string) => void;
  onReviewPgn: (pgn: string, title: string) => void;
  onPuzzle: (p: LichessPuzzle) => void;
}

const PERF_LABELS: Record<string, string> = {
  bullet: 'Bullet',
  blitz: 'Blitz',
  rapid: 'Rápida',
  classical: 'Clássica',
  puzzle: 'Puzzles',
  correspondence: 'Correspondência',
};

function summaryToPgn(g: LichessGameSummary): string {
  const name = (c: 'white' | 'black') => g.players[c].user?.name ?? (g.players[c].aiLevel ? `Stockfish nível ${g.players[c].aiLevel}` : 'Anônimo');
  const result = g.winner === 'white' ? '1-0' : g.winner === 'black' ? '0-1' : g.status === 'draw' || g.status === 'stalemate' ? '1/2-1/2' : '*';
  const sans = g.moves.split(' ').filter(Boolean);
  let text = '';
  sans.forEach((s, i) => {
    text += (i % 2 === 0 ? `${i / 2 + 1}. ` : '') + s + ' ';
  });
  const h = [
    ['Event', `Lichess ${g.speed}`],
    ['Site', lichessUrls.game(g.id)],
    ['White', name('white')],
    ['Black', name('black')],
    ['WhiteElo', String(g.players.white.rating ?? '?')],
    ['BlackElo', String(g.players.black.rating ?? '?')],
    ['Result', result],
  ]
    .map(([k, v]) => `[${k} "${v}"]`)
    .join('\n');
  return `${h}\n\n${text}${result}`;
}

function resultBadge(g: LichessGameSummary, me: string): { text: string; cls: string } {
  if (!g.winner) return { text: '½', cls: 'draw' };
  const meColor = g.players.white.user?.name?.toLowerCase() === me.toLowerCase() ? 'white' : 'black';
  return g.winner === meColor ? { text: 'V', cls: 'win' } : { text: 'D', cls: 'loss' };
}

export function LichessPanel({ username, onUsernameChange, onReviewPgn, onPuzzle }: Props) {
  const [user, setUser] = useState<LichessUser | null>(null);
  const [games, setGames] = useState<LichessGameSummary[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importText, setImportText] = useState('');
  const [gamesNote, setGamesNote] = useState<string | null>(null);

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const loadProfile = () =>
    run('perfil', async () => {
      const name = cleanUsername(username);
      const [u, g] = await Promise.allSettled([fetchUser(name), fetchRecentGames(name, 12)]);
      if (u.status === 'rejected') throw u.reason;
      setUser(u.value);
      onUsernameChange(u.value.username);
      if (g.status === 'fulfilled') {
        setGames(g.value);
        setGamesNote(null);
      } else {
        setGames([]);
        setGamesNote(g.reason instanceof Error ? g.reason.message : String(g.reason));
      }
    });

  const importGame = () =>
    run('importar', async () => {
      const t = importText.trim();
      if (!t) return;
      const looksLikePgn = /\[\w+\s+"/.test(t) || /\b1\.\s*\S+/.test(t);
      const pgn = looksLikePgn ? t : await fetchGamePgn(t);
      onReviewPgn(pgn, looksLikePgn ? 'PGN importado' : 'Partida do Lichess');
      setImportText('');
    });

  return (
    <div className="panel-section">
      <h3>Conta Lichess</h3>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          void loadProfile();
        }}
      >
        <input
          value={username}
          onChange={(e) => onUsernameChange(e.target.value)}
          placeholder="Seu usuário no Lichess"
          aria-label="Usuário do Lichess"
        />
        <button type="submit" disabled={!username.trim() || !!busy}>
          {busy === 'perfil' ? '…' : 'Buscar'}
        </button>
      </form>
      {error && <p className="err">{error}</p>}

      {user && (
        <div className="lichess-profile">
          <div className="lichess-head">
            <a href={lichessUrls.user(user.username)} target="_blank" rel="noreferrer">
              {user.title && <b className="title-badge">{user.title}</b>} {user.username}
            </a>
            <span className={`dot ${user.online ? 'online' : ''}`} title={user.online ? 'Online' : 'Offline'} />
          </div>
          <div className="perf-grid">
            {Object.entries(user.perfs ?? {})
              .filter(([k, v]) => PERF_LABELS[k] && v.games > 0)
              .map(([k, v]) => (
                <div className="perf" key={k}>
                  <span className="perf-name">{PERF_LABELS[k]}</span>
                  <span className="perf-rating">
                    {v.rating}
                    {v.prov ? '?' : ''}
                  </span>
                  <span className="perf-games">{v.games} jogos</span>
                </div>
              ))}
          </div>
          {user.count && (
            <p className="muted small">
              {user.count.all} partidas · {user.count.win} vitórias · {user.count.draw} empates · {user.count.loss} derrotas
            </p>
          )}
        </div>
      )}

      {user && gamesNote && (
        <p className="muted small">
          {gamesNote} Para revisar uma partida sua, cole o link ou o ID dela em “Importar partida” abaixo.
        </p>
      )}

      {games.length > 0 && (
        <>
          <h3>Partidas recentes</h3>
          <ul className="game-list">
            {games.map((g) => {
              const b = resultBadge(g, user?.username ?? username);
              return (
                <li key={g.id}>
                  <span className={`badge ${b.cls}`}>{b.text}</span>
                  <div className="game-meta">
                    <div>
                      {g.players.white.user?.name ?? 'Anônimo'} <span className="muted">vs</span> {g.players.black.user?.name ?? 'Anônimo'}
                    </div>
                    <div className="muted small">
                      {g.speed} · {g.opening?.name ?? 'Abertura desconhecida'}
                    </div>
                  </div>
                  <button onClick={() => onReviewPgn(summaryToPgn(g), `${g.players.white.user?.name ?? '?'} vs ${g.players.black.user?.name ?? '?'}`)}>
                    Revisar
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}

      <h3>Puzzle do dia</h3>
      <div className="row">
        <button
          disabled={!!busy}
          onClick={() =>
            run('puzzle', async () => {
              onPuzzle(await fetchDailyPuzzle());
            })
          }
        >
          {busy === 'puzzle' ? 'Carregando…' : '🧩 Resolver puzzle do dia'}
        </button>
      </div>
      <p className="muted small">Resolva clicando ou falando o lance (ex.: “cavalo para efe sete”).</p>

      <h3>Importar partida</h3>
      <textarea
        value={importText}
        onChange={(e) => setImportText(e.target.value)}
        placeholder="Cole um PGN, o link ou o ID de uma partida do Lichess (ex.: lichess.org/abcd1234)"
        rows={3}
      />
      <div className="row">
        <button disabled={!importText.trim() || !!busy} onClick={() => void importGame()}>
          {busy === 'importar' ? 'Importando…' : 'Abrir para revisão'}
        </button>
      </div>
    </div>
  );
}
