import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Chess, type Move } from 'chess.js';
import { BoardView, type BoardArrow } from './components/BoardView';
import { EvalBar } from './components/EvalBar';
import { LichessPanel } from './components/LichessPanel';
import { MovesPanel } from './components/MovesPanel';
import { PlayerBar } from './components/PlayerBar';
import { HelpPanel, SettingsPanel } from './components/SettingsPanel';
import { VoicePanel, type VoiceLogItem } from './components/VoicePanel';
import { useEngines } from './hooks/useEngines';
import { usePersistentState } from './hooks/usePersistentState';
import { MAX_ELO, MIN_ELO, strengthForElo } from './lib/engine';
import {
  START_FEN,
  evalLabel,
  exportPgn,
  gameFromPgn,
  gameReducer,
  initialGame,
  materialOf,
  pvToSan,
  randomLegalMove,
  resultOf,
  resultText,
  toWhitePerspective,
  uciToMove,
  type Color,
  type Evaluation,
  type GameState,
} from './lib/game';
import { analysisUrl, importToLichess, type LichessPuzzle } from './lib/lichess';
import { DEFAULT_SETTINGS, TIME_CONTROLS, eloLabel, parseTimeControl, type Settings } from './lib/settings';
import { playSound } from './lib/sound';
import { parseVoice, spokenMove, type VoiceAction } from './lib/voice/parser';
import { cancelSpeech, speak, useSpeechRecognition } from './lib/voice/speech';

type Mode = 'play' | 'review' | 'puzzle';
type Tab = 'partida' | 'lichess' | 'ajustes' | 'ajuda';

interface PuzzleState {
  data: LichessPuzzle;
  idx: number;
  status: 'solving' | 'solved';
  mistakes: number;
  color: Color;
}
interface SavedPlay {
  game: GameState;
  playerColor: Color;
}
interface ReviewMeta {
  title: string;
  white: string;
  black: string;
  whiteElo?: string;
  blackElo?: string;
}
interface TimeControl {
  baseMs: number;
  incMs: number;
}

const opposite = (c: Color): Color => (c === 'white' ? 'black' : 'white');
const turnOf = (fen: string): Color => (fen.split(' ')[1] === 'b' ? 'black' : 'white');
const ARROW_HINT = 'rgba(0, 160, 80, 0.85)';
const ARROW_BEST = 'rgba(60, 120, 220, 0.8)';

export default function App() {
  const [settings, setSettings] = usePersistentState<Settings>('settings', DEFAULT_SETTINGS);
  const patch = useCallback((p: Partial<Settings>) => setSettings((s) => ({ ...s, ...p })), [setSettings]);
  const engines = useEngines();

  const [game, dispatch] = useReducer(gameReducer, undefined, () => initialGame());
  const [mode, setMode] = useState<Mode>('play');
  const [tab, setTab] = useState<Tab>('partida');
  const [playerColor, setPlayerColor] = useState<Color>('white');
  const [orientation, setOrientation] = useState<Color>('white');
  const [viewPly, setViewPly] = useState<number | null>(null);
  const [thinking, setThinking] = useState(false);
  const [evaluation, setEvaluation] = useState<(Evaluation & { fen: string }) | null>(null);
  const [hint, setHint] = useState<BoardArrow | null>(null);
  const [options, setOptions] = useState<Move[]>([]);
  const [log, setLog] = useState<VoiceLogItem[]>([]);
  const [confirmAction, setConfirmAction] = useState<'new' | 'resign' | null>(null);
  const [puzzle, setPuzzle] = useState<PuzzleState | null>(null);
  const [reviewMeta, setReviewMeta] = useState<ReviewMeta | null>(null);
  const [gameTc, setGameTc] = useState<TimeControl | null>(null);
  const [clocks, setClocks] = useState({ white: 0, black: 0 });
  const [toast, setToast] = useState<string | null>(null);

  const savedPlay = useRef<SavedPlay | null>(null);
  const thinkToken = useRef(0);
  const logId = useRef(0);
  const puzzleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevLen = useRef(0);

  // ------------------------------------------------------------------ derivados
  const lastIdx = game.fens.length - 1;
  const liveFen = game.fens[lastIdx];
  const shownPly = Math.min(viewPly ?? lastIdx, lastIdx);
  const viewFen = game.fens[shownPly];
  const atLive = shownPly === lastIdx;
  const liveTurn = turnOf(liveFen);
  const result = useMemo(() => resultOf(game), [game]);
  const lastMove = shownPly > 0 ? game.moves[shownPly - 1] : null;
  const sans = useMemo(() => game.moves.map((m) => m.san), [game.moves]);
  const material = useMemo(() => materialOf(viewFen), [viewFen]);
  const evalActive = settings.showEval || mode === 'review';

  // espelho do estado para callbacks assíncronos (voz, timers)
  const stateRef = useRef({ mode, game, liveFen, liveTurn, playerColor, result, puzzle, settings, viewFen, confirmAction });
  stateRef.current = { mode, game, liveFen, liveTurn, playerColor, result, puzzle, settings, viewFen, confirmAction };

  // ------------------------------------------------------------------ feedback / fala
  const say = useCallback((text: string, tone: VoiceLogItem['tone'] = 'ok', heard = '') => {
    setLog((l) => [{ id: ++logId.current, heard, text, tone }, ...l].slice(0, 10));
  }, []);

  const voiceHandlerRef = useRef<(alts: string[]) => void>(() => {});
  const mic = useSpeechRecognition({ lang: settings.voiceLang, onFinal: (alts) => voiceHandlerRef.current(alts) });

  const micRef = useRef(mic);
  micRef.current = mic;

  const speakText = useCallback(async (text: string) => {
    if (!stateRef.current.settings.speakMoves) return;
    micRef.current.setPaused(true);
    try {
      await speak(text, stateRef.current.settings.voiceLang);
    } finally {
      micRef.current.setPaused(false);
    }
  }, []);

  // ------------------------------------------------------------------ novo jogo / modos
  const clearTransient = useCallback(() => {
    setHint(null);
    setOptions([]);
    setConfirmAction(null);
    setToast(null);
    if (puzzleTimer.current) clearTimeout(puzzleTimer.current);
    puzzleTimer.current = null;
  }, []);

  const startNewGame = useCallback(
    (opts?: { fen?: string; color?: Color }) => {
      const s = stateRef.current.settings;
      const color = opts?.color ?? (s.side === 'random' ? (Math.random() < 0.5 ? 'white' : 'black') : s.side);
      thinkToken.current++;
      void engines.player.current?.stop();
      void engines.player.current?.newGame();
      savedPlay.current = null;
      clearTransient();
      dispatch({ type: 'reset', fen: opts?.fen });
      setMode('play');
      setPuzzle(null);
      setReviewMeta(null);
      setPlayerColor(color);
      setOrientation(color);
      setViewPly(null);
      setThinking(false);
      setEvaluation(null);
      const tc = parseTimeControl(s.timeControl);
      setGameTc(tc);
      setClocks({ white: tc?.baseMs ?? 0, black: tc?.baseMs ?? 0 });
      setTab('partida');
    },
    [engines.player, clearTransient],
  );

  // primeira partida
  useEffect(() => {
    startNewGame();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const exitToPlay = useCallback(() => {
    const saved = savedPlay.current;
    if (!saved) {
      startNewGame();
      return;
    }
    savedPlay.current = null;
    clearTransient();
    dispatch({ type: 'set', state: saved.game });
    setPlayerColor(saved.playerColor);
    setOrientation(saved.playerColor);
    setMode('play');
    setPuzzle(null);
    setReviewMeta(null);
    setViewPly(null);
    setEvaluation(null);
  }, [startNewGame, clearTransient]);

  const stashPlay = useCallback(() => {
    const s = stateRef.current;
    if (s.mode === 'play' && !savedPlay.current) savedPlay.current = { game: s.game, playerColor: s.playerColor };
    thinkToken.current++;
    void engines.player.current?.stop();
    setThinking(false);
  }, [engines.player]);

  const loadReview = useCallback(
    (pgn: string, title: string) => {
      try {
        const { state, headers } = gameFromPgn(pgn);
        stashPlay();
        clearTransient();
        dispatch({ type: 'set', state });
        setMode('review');
        setPuzzle(null);
        setReviewMeta({
          title,
          white: headers.White ?? 'Brancas',
          black: headers.Black ?? 'Pretas',
          whiteElo: headers.WhiteElo,
          blackElo: headers.BlackElo,
        });
        setViewPly(0);
        setOrientation('white');
        setTab('partida');
        say(`Revisão carregada: ${state.moves.length} lances`, 'ok');
      } catch (e) {
        say(`Não consegui ler o PGN: ${e instanceof Error ? e.message : String(e)}`, 'err');
        setToast('PGN inválido');
      }
    },
    [stashPlay, clearTransient, say],
  );

  const startPuzzle = useCallback(
    (p: LichessPuzzle) => {
      try {
        const c = new Chess();
        c.loadPgn(p.pgn);
        const canPlayFirst = (ch: Chess) => {
          try {
            new Chess(ch.fen()).move(uciToMove(p.solution[0]));
            return true;
          } catch {
            return false;
          }
        };
        if (!canPlayFirst(c)) {
          c.undo();
          if (!canPlayFirst(c)) throw new Error('formato de puzzle inesperado');
        }
        const hist = c.history({ verbose: true });
        const state: GameState = { startFen: START_FEN, moves: hist, fens: [START_FEN, ...hist.map((m) => m.after)], manualResult: null };
        const color: Color = c.turn() === 'w' ? 'white' : 'black';
        stashPlay();
        clearTransient();
        dispatch({ type: 'set', state });
        setMode('puzzle');
        setReviewMeta(null);
        setPuzzle({ data: p, idx: 0, status: 'solving', mistakes: 0, color });
        setPlayerColor(color);
        setOrientation(color);
        setViewPly(null);
        setTab('partida');
        const msg = `Puzzle: ${color === 'white' ? 'brancas' : 'pretas'} jogam e ganham vantagem`;
        say(msg, 'ok');
        void speakText(msg);
      } catch (e) {
        say(`Não consegui carregar o puzzle: ${e instanceof Error ? e.message : String(e)}`, 'err');
      }
    },
    [stashPlay, clearTransient, say, speakText],
  );

  // ------------------------------------------------------------------ lances do jogador
  const puzzleMove = useCallback(
    (from: string, to: string, promotion?: string): boolean => {
      const s = stateRef.current;
      const pz = s.puzzle;
      if (!pz || pz.status === 'solved' || s.liveTurn !== pz.color) return false;
      const c = new Chess(s.liveFen);
      let mv: Move;
      try {
        mv = c.move({ from, to, promotion });
      } catch {
        return false;
      }
      const expected = pz.data.solution[pz.idx];
      const uci = mv.from + mv.to + (mv.promotion ?? '');
      if (uci !== expected && !c.isCheckmate()) {
        setPuzzle({ ...pz, mistakes: pz.mistakes + 1 });
        say(`${mv.san} não é o lance do puzzle. Tente de novo!`, 'warn');
        if (s.settings.sounds) playSound('error');
        void speakText('Não é esse. Tente de novo.');
        return false;
      }
      dispatch({ type: 'move', from, to, promotion: mv.promotion });
      setViewPly(null);
      setHint(null);
      setOptions([]);
      const next = pz.idx + 1;
      if (next >= pz.data.solution.length || c.isCheckmate()) {
        setPuzzle({ ...pz, idx: next, status: 'solved' });
        say(`Puzzle resolvido! (${pz.mistakes} erro${pz.mistakes === 1 ? '' : 's'})`, 'ok');
        void speakText('Puzzle resolvido! Parabéns.');
      } else {
        setPuzzle({ ...pz, idx: next + 1 });
        const reply = pz.data.solution[next];
        say(`${mv.san} — correto!`, 'ok');
        puzzleTimer.current = setTimeout(() => {
          const r = uciToMove(reply);
          dispatch({ type: 'move', from: r.from, to: r.to, promotion: r.promotion });
        }, 600);
      }
      return true;
    },
    [say, speakText],
  );

  const playerMove = useCallback(
    (from: string, to: string, promotion?: string): boolean => {
      const s = stateRef.current;
      if (s.result) return false;
      if (s.mode === 'puzzle') return puzzleMove(from, to, promotion);
      if (s.mode !== 'play' || s.liveTurn !== s.playerColor) return false;
      const legal = new Chess(s.liveFen)
        .moves({ verbose: true })
        .find((m) => m.from === from && m.to === to && (!m.promotion || m.promotion === (promotion ?? 'q')));
      if (!legal) return false;
      dispatch({ type: 'move', from, to, promotion: legal.promotion });
      setViewPly(null);
      setHint(null);
      setOptions([]);
      setConfirmAction(null);
      return true;
    },
    [puzzleMove],
  );

  // ------------------------------------------------------------------ resposta do Stockfish
  const resultKey = result ? `${result.reason}-${result.winner}` : '';
  useEffect(() => {
    if (mode !== 'play' || !engines.ready || resultKey || liveTurn === playerColor) return;
    const player = engines.player.current;
    if (!player) return;
    const token = ++thinkToken.current;
    const fen = liveFen;
    setThinking(true);

    (async () => {
      const s = strengthForElo(stateRef.current.settings.elo);
      await player.applyStrength(s);
      if (token !== thinkToken.current) return;
      const started = performance.now();

      let chosen: { from: string; to: string; promotion?: string } | null = null;
      if (s.blunderChance > 0 && Math.random() < s.blunderChance && stateRef.current.game.moves.length >= 2) {
        chosen = randomLegalMove(fen);
      } else {
        const remaining = gameTc ? clocks[turnOf(fen)] : Infinity;
        const movetime = Math.max(80, Math.min(s.movetime, remaining / 25));
        const res = await player.search(fen, { movetime, depth: s.depth });
        if (token !== thinkToken.current || res.cancelled || !res.move) return;
        chosen = uciToMove(res.move);
      }
      if (!chosen) return;

      // pequena pausa para o lance não parecer instantâneo
      const wait = 450 - (performance.now() - started);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      if (token !== thinkToken.current) return;

      let spoken = '';
      try {
        spoken = spokenMove(new Chess(fen).move(chosen));
      } catch {
        return;
      }
      dispatch({ type: 'move', from: chosen.from, to: chosen.to, promotion: chosen.promotion });
      setThinking(false);
      void speakText(spoken);
    })().catch((e) => {
      console.error(e);
      setThinking(false);
    });

    return () => {
      thinkToken.current++;
      void player.stop();
      setThinking(false);
    };
    // O relógio é lido apenas no instante da jogada.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, engines.ready, liveFen, playerColor, resultKey]);

  // ------------------------------------------------------------------ avaliação (analista)
  useEffect(() => {
    const analyst = engines.analyst.current;
    if (!analyst || !engines.ready) return;
    if (!evalActive) {
      void analyst.stop();
      setEvaluation(null);
      return;
    }
    const fen = viewFen;
    const chess = new Chess(fen);
    if (chess.isCheckmate()) {
      setEvaluation({ fen, cp: chess.turn() === 'w' ? -10000 : 10000, depth: 0, pv: [] });
      return;
    }
    if (chess.isDraw() || chess.isStalemate()) {
      setEvaluation({ fen, cp: 0, depth: 0, pv: [] });
      return;
    }
    let alive = true;
    const t = setTimeout(() => {
      void analyst.search(fen, { movetime: 1800 }, (info) => {
        if (alive) setEvaluation({ fen, ...toWhitePerspective(fen, info) });
      });
    }, 150);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [evalActive, viewFen, engines.ready, engines.analyst]);

  // ------------------------------------------------------------------ relógios
  useEffect(() => {
    if (!gameTc || mode !== 'play' || resultKey || game.moves.length < 2) return;
    const turn = liveTurn;
    let last = performance.now();
    const id = setInterval(() => {
      const now = performance.now();
      const dt = now - last;
      last = now;
      setClocks((c) => ({ ...c, [turn]: Math.max(0, c[turn] - dt) }));
    }, 100);
    return () => clearInterval(id);
  }, [gameTc, mode, resultKey, game.moves.length, liveTurn]);

  const prevMoves = useRef(0);
  useEffect(() => {
    // incremento: quem acabou de jogar (a partir do 3º lance, quando o relógio dele já corria)
    if (gameTc && gameTc.incMs && mode === 'play' && game.moves.length > prevMoves.current && game.moves.length >= 3) {
      const mover = opposite(liveTurn);
      setClocks((c) => ({ ...c, [mover]: c[mover] + gameTc.incMs }));
    }
    prevMoves.current = game.moves.length;
  }, [game.moves.length, gameTc, mode, liveTurn]);

  useEffect(() => {
    if (!gameTc || mode !== 'play' || resultKey || game.moves.length < 2) return;
    if (clocks[liveTurn] <= 0) {
      dispatch({ type: 'result', result: { winner: opposite(liveTurn), reason: 'timeout' } });
    }
  }, [clocks, gameTc, mode, resultKey, game.moves.length, liveTurn]);

  // ------------------------------------------------------------------ sons
  useEffect(() => {
    if (game.moves.length > prevLen.current && settings.sounds && !result) {
      const m = game.moves[game.moves.length - 1];
      playSound(m.san.endsWith('+') ? 'check' : m.captured ? 'capture' : 'move');
    }
    prevLen.current = game.moves.length;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.moves.length]);

  useEffect(() => {
    if (resultKey && settings.sounds) playSound('end');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resultKey]);

  // ------------------------------------------------------------------ ações
  const undoMove = useCallback(() => {
    const s = stateRef.current;
    if (s.mode !== 'play') {
      say('Desfazer só funciona durante a partida contra o Stockfish', 'warn');
      return;
    }
    const n = s.game.moves.length;
    let count = 0;
    if (s.liveTurn === s.playerColor) count = n >= 2 ? 2 : 0;
    else count = n >= 1 ? 1 : 0;
    if (count === 0) {
      say('Nada para desfazer', 'warn');
      return;
    }
    thinkToken.current++;
    void engines.player.current?.stop();
    dispatch({ type: 'undo', count });
    setViewPly(null);
    clearTransient();
    say('Lance desfeito', 'ok');
  }, [say, engines.player, clearTransient]);

  const requestHint = useCallback(async () => {
    const s = stateRef.current;
    const analyst = engines.analyst.current;
    if (s.mode === 'puzzle' && s.puzzle && s.puzzle.status === 'solving') {
      const expected = s.puzzle.data.solution[s.puzzle.idx];
      const { from, to } = uciToMove(expected);
      setHint({ startSquare: from, endSquare: to, color: ARROW_HINT });
      say(`Dica: mova a peça de ${from}`, 'ok');
      void speakText(`Dica: mova a peça de ${from[0]} ${from[1]}`);
      return;
    }
    if (s.mode !== 'play' || s.result || s.liveTurn !== s.playerColor) {
      say('A dica só está disponível na sua vez', 'warn');
      return;
    }
    if (!analyst) return;
    say('Calculando a melhor jogada…', 'warn');
    const res = await analyst.search(s.liveFen, { movetime: 1200 });
    if (res.cancelled || !res.move || stateRef.current.liveFen !== s.liveFen) return;
    const mv = new Chess(s.liveFen).move(uciToMove(res.move));
    setHint({ startSquare: mv.from, endSquare: mv.to, color: ARROW_HINT });
    say(`Dica: ${mv.san}`, 'ok');
    void speakText(`Sugiro: ${spokenMove(mv)}`);
  }, [engines.analyst, say, speakText]);

  const offerDraw = useCallback(async () => {
    const s = stateRef.current;
    const analyst = engines.analyst.current;
    if (s.mode !== 'play' || s.result || !analyst) {
      say('Empate só pode ser proposto durante a partida', 'warn');
      return;
    }
    say('Stockfish está considerando o empate…', 'warn');
    const res = await analyst.search(s.liveFen, { movetime: 900 });
    if (res.cancelled || stateRef.current.liveFen !== s.liveFen) return;
    const info = res.info;
    const cp = info ? (info.mate !== undefined ? (info.mate > 0 ? 10000 : -10000) : (info.cp ?? 0)) : 0;
    const engineCp = s.liveTurn !== s.playerColor ? cp : -cp;
    if (s.game.moves.length >= 20 && engineCp <= 40) {
      dispatch({ type: 'result', result: { winner: null, reason: 'agreement' } });
      say('Stockfish aceitou o empate', 'ok');
      void speakText('Empate aceito.');
    } else {
      const why = s.game.moves.length < 20 ? 'Ainda é cedo para empatar' : 'Estou melhor, recuso o empate';
      say(`Stockfish recusou: ${why}`, 'warn');
      void speakText(why);
    }
  }, [engines.analyst, say, speakText]);

  const resign = useCallback(() => {
    const s = stateRef.current;
    if (s.mode !== 'play' || s.result) return;
    thinkToken.current++;
    void engines.player.current?.stop();
    dispatch({ type: 'result', result: { winner: opposite(s.playerColor), reason: 'resign' } });
    setConfirmAction(null);
  }, [engines.player]);

  const requestNew = useCallback(() => {
    const s = stateRef.current;
    if (s.mode === 'play' && !s.result && s.game.moves.length >= 2) {
      setConfirmAction('new');
      say('Diga “sim” para iniciar uma nova partida ou “cancelar”', 'warn');
      void speakText('Iniciar nova partida? Diga sim ou cancelar.');
    } else startNewGame();
  }, [say, speakText, startNewGame]);

  const requestResign = useCallback(() => {
    const s = stateRef.current;
    if (s.mode !== 'play' || s.result) return;
    setConfirmAction('resign');
    say('Diga “sim” para desistir ou “cancelar”', 'warn');
    void speakText('Deseja desistir? Diga sim ou cancelar.');
  }, [say, speakText]);

  const runConfirm = useCallback(
    (a: 'new' | 'resign') => {
      setConfirmAction(null);
      if (a === 'new') startNewGame();
      else resign();
    },
    [startNewGame, resign],
  );

  const flip = useCallback(() => setOrientation((o) => opposite(o)), []);

  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setToast(`${label} copiado`);
    } catch {
      setToast('Não foi possível copiar');
    }
  };

  const pgnMeta = () => {
    const s = stateRef.current;
    const me = s.settings.lichessUser.trim() || 'Jogador';
    const engineName = `Stockfish (${s.settings.elo})`;
    if (s.mode === 'review' && reviewMeta) return { white: reviewMeta.white, black: reviewMeta.black };
    return s.playerColor === 'white'
      ? { white: me, black: engineName, blackElo: s.settings.elo }
      : { white: engineName, black: me, whiteElo: s.settings.elo };
  };

  const openOnLichess = async () => {
    const w = window.open('', '_blank');
    setToast('Enviando para o Lichess…');
    const pgn = exportPgn(game, pgnMeta());
    const url = game.moves.length > 0 ? await importToLichess(pgn, viewFen) : analysisUrl(viewFen, orientation);
    if (w) w.location.href = url;
    else window.open(url, '_blank');
    setToast(null);
  };

  const playFromHere = () => startNewGame({ fen: viewFen, color: turnOf(viewFen) });

  // ------------------------------------------------------------------ voz
  const runAction = useCallback(
    (a: VoiceAction) => {
      const s = stateRef.current;
      switch (a) {
        case 'undo':
          undoMove();
          break;
        case 'new':
          requestNew();
          break;
        case 'resign':
          requestResign();
          break;
        case 'hint':
          void requestHint();
          break;
        case 'flip':
          flip();
          say('Tabuleiro girado', 'ok');
          break;
        case 'draw':
          void offerDraw();
          break;
        case 'repeat': {
          const last = s.game.moves[s.game.moves.length - 1];
          if (last) {
            say(`Último lance: ${last.san}`, 'ok');
            void speakText(spokenMove(last));
          } else say('Ainda não há lances', 'warn');
          break;
        }
        case 'stop':
          micRef.current.stop();
          say('Microfone desligado', 'ok');
          break;
        case 'confirm': {
          const pending = s.confirmAction;
          if (pending) runConfirm(pending);
          else say('Nada para confirmar', 'warn');
          break;
        }
        case 'cancel':
          setConfirmAction(null);
          say('Cancelado', 'ok');
          break;
      }
    },
    [undoMove, requestNew, requestResign, requestHint, flip, offerDraw, speakText, say, runConfirm],
  );

  voiceHandlerRef.current = (alts: string[]) => {
    const s = stateRef.current;
    const r = parseVoice(alts, s.liveFen);
    if (s.settings.sounds && r.kind === 'move') playSound('listen');
    switch (r.kind) {
      case 'move': {
        if (s.mode === 'review') {
          say('Estou no modo revisão. Use “Jogar a partir daqui” para continuar jogando.', 'warn', r.heard);
          return;
        }
        if (s.result) {
          say('A partida terminou. Diga “nova partida”.', 'warn', r.heard);
          return;
        }
        const turnOk = s.mode === 'puzzle' ? s.puzzle?.color === s.liveTurn : s.liveTurn === s.playerColor;
        if (!turnOk) {
          say('Aguarde a sua vez', 'warn', r.heard);
          return;
        }
        const ok = playerMove(r.move.from, r.move.to, r.move.promotion);
        if (ok && s.mode === 'play') say(`Você jogou ${r.move.san}`, 'ok', r.heard);
        else if (!ok && s.mode === 'play') say('Não consegui executar esse lance', 'err', r.heard);
        return;
      }
      case 'ambiguous': {
        setOptions(r.candidates);
        say('Lance ambíguo — escolha uma opção ou diga a casa de origem', 'warn', r.heard);
        void speakText('Qual peça? Diga a casa de origem.');
        return;
      }
      case 'illegal':
        if (s.settings.sounds) playSound('error');
        say(r.reason, 'err', r.heard);
        void speakText('Lance ilegal.');
        return;
      case 'action':
        say(`Comando: ${r.action}`, 'ok', r.heard);
        runAction(r.action);
        return;
      case 'unknown':
        if (r.heard) say('Não entendi. Tente algo como “cavalo efe três”.', 'warn', r.heard);
        return;
    }
  };

  const pickOption = (m: Move) => {
    const ok = playerMove(m.from, m.to, m.promotion);
    if (ok && stateRef.current.mode === 'play') say(`Você jogou ${m.san}`, 'ok');
    setOptions([]);
  };

  // ------------------------------------------------------------------ teclado
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = t && ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName);
      if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.code === 'Space') {
        e.preventDefault();
        cancelSpeech();
        micRef.current.toggle();
      } else if (e.key === 'ArrowLeft') {
        setViewPly((p) => Math.max(0, (p ?? stateRef.current.game.fens.length - 1) - 1));
      } else if (e.key === 'ArrowRight') {
        setViewPly((p) => {
          const next = (p ?? stateRef.current.game.fens.length - 1) + 1;
          return next >= stateRef.current.game.fens.length - 1 ? null : next;
        });
      } else if (e.key.toLowerCase() === 'f') {
        flip();
      }
    };
    window.addEventListener('keydown', onKey);
    // evita que Espaço reative o último botão clicado
    const onClick = (e: MouseEvent) => (e.target as HTMLElement | null)?.closest('button')?.blur();
    window.addEventListener('click', onClick);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('click', onClick);
    };
  }, [flip]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(t);
  }, [toast]);

  // ------------------------------------------------------------------ apresentação
  const movableColor: Color | null =
    atLive && !result && (mode === 'play' || (mode === 'puzzle' && puzzle?.status === 'solving')) ? playerColor : null;

  const arrows: BoardArrow[] = [];
  if (hint && atLive) arrows.push(hint);
  if (evalActive && evaluation && evaluation.fen === viewFen && evaluation.pv[0] && mode !== 'play') {
    const u = uciToMove(evaluation.pv[0]);
    if (!arrows.some((a) => a.startSquare === u.from && a.endSquare === u.to)) {
      arrows.push({ startSquare: u.from, endSquare: u.to, color: ARROW_BEST });
    }
  }

  const seat = (c: Color) => {
    if (mode === 'review' && reviewMeta) {
      return c === 'white'
        ? { name: reviewMeta.white, detail: reviewMeta.whiteElo, isEngine: false }
        : { name: reviewMeta.black, detail: reviewMeta.blackElo, isEngine: false };
    }
    if (mode === 'puzzle') {
      return c === playerColor
        ? { name: 'Você', detail: puzzle ? `Puzzle · ${puzzle.data.rating}` : undefined, isEngine: false }
        : { name: 'Oponente do puzzle', detail: undefined, isEngine: false };
    }
    return c === playerColor
      ? { name: settings.lichessUser.trim() || 'Você', detail: undefined, isEngine: false }
      : { name: 'Stockfish 19', detail: settings.elo >= 3190 ? 'força total' : `≈ ${settings.elo}`, isEngine: true };
  };

  const bar = (c: Color) => {
    const info = seat(c);
    const captured = c === 'white' ? material.capturedByWhite : material.capturedByBlack;
    const adv = c === 'white' ? material.diff : -material.diff;
    return (
      <PlayerBar
        name={info.name}
        detail={info.detail}
        isEngine={info.isEngine}
        pieceColor={c}
        captured={captured}
        advantage={Math.max(0, adv)}
        clockMs={mode === 'play' && gameTc ? clocks[c] : null}
        clockActive={mode === 'play' && !result && game.moves.length >= 2 && liveTurn === c}
        thinking={mode === 'play' && thinking && info.isEngine}
      />
    );
  };

  const statusText = (() => {
    if (result) return resultText(result, mode === 'play' ? playerColor : undefined);
    if (mode === 'review') return `Revisão: ${reviewMeta?.title ?? ''}`;
    if (mode === 'puzzle') return puzzle?.status === 'solved' ? 'Puzzle resolvido!' : 'Puzzle: encontre o melhor lance';
    if (!engines.ready) return 'Carregando Stockfish…';
    if (thinking) return 'Stockfish está pensando…';
    return liveTurn === playerColor ? 'Sua vez' : 'Vez do Stockfish';
  })();

  const shownEval = evaluation && evaluation.fen === viewFen ? evaluation : null;
  const pvText = shownEval && shownEval.pv.length ? pvToSan(viewFen, shownEval.pv, 6).join(' ') : '';

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo">♞</span>
          <div>
            <h1>TalkChess</h1>
            <p>Xadrez por voz · Stockfish · Lichess</p>
          </div>
        </div>
        <div className="chips">
          <span className={`chip ${engines.ready ? 'ok' : engines.error ? 'err' : 'warn'}`}>
            {engines.error ? 'Motor com erro' : engines.ready ? 'Stockfish pronto' : 'Carregando motor…'}
          </span>
          <span className={`chip ${mic.supported ? 'ok' : 'warn'}`}>{mic.supported ? 'Voz disponível' : 'Sem reconhecimento de voz'}</span>
        </div>
      </header>

      {engines.error && <div className="banner err">{engines.error}</div>}

      <main className="layout">
        <section className={`board-col ${evalActive ? 'with-eval' : ''}`}>
          {bar(opposite(orientation))}
          <div className="board-row">
            {evalActive && <EvalBar evaluation={shownEval} orientation={orientation} />}
            <div className="board-box">
              <BoardView
                fen={viewFen}
                orientation={orientation}
                movableColor={movableColor}
                lastMove={lastMove ? { from: lastMove.from, to: lastMove.to } : null}
                arrows={arrows}
                theme={settings.theme}
                showLegalMoves={settings.showLegal}
                animate={settings.animate}
                onMove={playerMove}
              />
              {result && atLive && (
                <div className="result-overlay">
                  <div className="result-card">
                    <h2>{resultText(result, mode === 'play' ? playerColor : undefined)}</h2>
                    <div className="row">
                      {mode === 'play' && <button className="primary" onClick={() => startNewGame()}>Nova partida</button>}
                      <button onClick={() => void openOnLichess()}>Analisar no Lichess</button>
                      <button onClick={() => { setViewPly(0); }}>Rever lances</button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
          {bar(orientation)}
          <VoicePanel
            supported={mic.supported}
            micState={mic.state}
            interim={mic.interim}
            error={mic.error}
            continuous={mic.continuous}
            log={log}
            options={options}
            onToggleMic={() => {
              cancelSpeech();
              mic.toggle();
            }}
            onToggleContinuous={mic.setContinuous}
            onPickOption={pickOption}
            onText={(t) => voiceHandlerRef.current([t])}
          />
        </section>

        <aside className="side-col">
          <nav className="tabs" role="tablist">
            {(
              [
                ['partida', '♟ Partida'],
                ['lichess', 'Lichess'],
                ['ajustes', 'Ajustes'],
                ['ajuda', 'Voz'],
              ] as Array<[Tab, string]>
            ).map(([k, label]) => (
              <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>
                {label}
              </button>
            ))}
          </nav>

          <div className="tab-body">
            {tab === 'partida' && (
              <div className="panel-section">
                <div className={`status-line ${result ? 'done' : ''}`}>{statusText}</div>

                {mode === 'puzzle' && puzzle && (
                  <div className="card puzzle-card">
                    <div className="card-title">
                      🧩 Puzzle <a href={`https://lichess.org/training/${puzzle.data.id}`} target="_blank" rel="noreferrer">#{puzzle.data.id}</a> · {puzzle.data.rating}
                    </div>
                    <p className="small muted">
                      {puzzle.data.themes.slice(0, 5).join(' · ')} · {puzzle.mistakes} erro(s)
                    </p>
                    <div className="row">
                      <button onClick={() => void requestHint()} disabled={puzzle.status === 'solved'}>💡 Dica</button>
                      <button onClick={exitToPlay}>Voltar à partida</button>
                    </div>
                  </div>
                )}

                {mode === 'review' && (
                  <div className="card">
                    <div className="card-title">🔍 {reviewMeta?.title}</div>
                    <p className="small muted">Use as setas ← → para navegar. A seta azul mostra o melhor lance segundo o Stockfish.</p>
                    <div className="row">
                      <button className="primary" onClick={playFromHere}>Jogar a partir daqui</button>
                      <button onClick={exitToPlay}>Sair da revisão</button>
                    </div>
                  </div>
                )}

                {mode === 'play' && (
                <div className="card">
                  <div className="card-title">Nova partida</div>
                  <div className="seg" role="group" aria-label="Cor">
                    {(
                      [
                        ['white', '♔ Brancas'],
                        ['random', '🎲 Aleatório'],
                        ['black', '♚ Pretas'],
                      ] as const
                    ).map(([v, l]) => (
                      <button key={v} className={settings.side === v ? 'active' : ''} onClick={() => patch({ side: v })}>
                        {l}
                      </button>
                    ))}
                  </div>
                  <label className="field">
                    <span>
                      Força do Stockfish: <b>{settings.elo >= 3190 ? 'Máxima' : settings.elo}</b> · {eloLabel(settings.elo)}
                    </span>
                    <input
                      type="range"
                      min={MIN_ELO}
                      max={MAX_ELO}
                      step={50}
                      value={settings.elo}
                      onChange={(e) => patch({ elo: Number(e.target.value) })}
                    />
                  </label>
                  <label className="field">
                    <span>Relógio</span>
                    <select value={settings.timeControl} onChange={(e) => patch({ timeControl: e.target.value })}>
                      {TIME_CONTROLS.map((t) => (
                        <option key={t.value} value={t.value}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button className="primary wide" onClick={requestNew}>Nova partida</button>
                  <p className="small muted">A força pode ser alterada durante o jogo e vale a partir do próximo lance do Stockfish.</p>
                </div>
                )}

                {confirmAction && (
                  <div className="card confirm">
                    <span>{confirmAction === 'new' ? 'Abandonar a partida atual e começar outra?' : 'Deseja realmente desistir?'}</span>
                    <div className="row">
                      <button className="danger" onClick={() => runConfirm(confirmAction)}>Sim</button>
                      <button onClick={() => setConfirmAction(null)}>Cancelar</button>
                    </div>
                  </div>
                )}

                <MovesPanel sans={sans} viewPly={viewPly} firstMoveBlack={game.startFen.split(' ')[1] === 'b'} onSelect={setViewPly} />

                {evalActive && (
                  <div className="eval-info">
                    <b>{evalLabel(shownEval)}</b>
                    {shownEval && shownEval.depth > 0 && <span className="muted"> · prof. {shownEval.depth}</span>}
                    {pvText && <div className="pv">{pvText}</div>}
                  </div>
                )}

                <div className="actions">
                  <button onClick={undoMove} disabled={mode !== 'play' || game.moves.length === 0}>↶ Desfazer</button>
                  <button onClick={() => void requestHint()} disabled={mode === 'review'}>💡 Dica</button>
                  <button onClick={flip}>⇅ Girar</button>
                  <button onClick={() => void offerDraw()} disabled={mode !== 'play' || !!result}>🤝 Empate</button>
                  <button className="danger" onClick={requestResign} disabled={mode !== 'play' || !!result}>🏳 Desistir</button>
                  <button onClick={() => void copy(exportPgn(game, pgnMeta()), 'PGN')} disabled={game.moves.length === 0}>Copiar PGN</button>
                  <button onClick={() => void copy(viewFen, 'FEN')}>Copiar FEN</button>
                  <button onClick={() => void openOnLichess()}>Analisar no Lichess ↗</button>
                </div>
              </div>
            )}

            {tab === 'lichess' && (
              <LichessPanel
                username={settings.lichessUser}
                onUsernameChange={(v) => patch({ lichessUser: v })}
                onReviewPgn={loadReview}
                onPuzzle={startPuzzle}
              />
            )}
            {tab === 'ajustes' && <SettingsPanel settings={settings} onChange={patch} />}
            {tab === 'ajuda' && <HelpPanel />}
          </div>
        </aside>
      </main>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
