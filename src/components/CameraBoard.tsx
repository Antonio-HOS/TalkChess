import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { Move } from 'chess.js';
import type { Color } from '../lib/game';
import {
  changedSquares,
  quadPoint,
  readSamples,
  squarePolygon,
  type Corners,
  type Point,
  type SquareSample,
} from '../lib/vision/geometry';
import { initialPhase, squaresTouched, stepTracker, type TrackPhase } from '../lib/vision/track';

interface Props {
  fen: string;
  playerColor: Color;
  paused: boolean;
  pausedText: string;
  onPlayerMove: (move: Move) => boolean;
  onRepeat: () => void;
}

const STORE_KEY = 'talkchess.camera';
const STABLE_FRAMES = 5;
const TICK_MS = 120;

const DEFAULT_CORNERS: Corners = [
  { x: 0.16, y: 0.1 },
  { x: 0.84, y: 0.1 },
  { x: 0.94, y: 0.9 },
  { x: 0.06, y: 0.9 },
];

interface Stored {
  corners: Corners;
  whiteAtBottom: boolean;
  rigor: number;
}

function thresholdOf(rigor: number): number {
  return 0.12 + (rigor - 1) * 0.055;
}

function loadStored(): Stored | null {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<Stored> & { corners?: Point[] };
    if (!Array.isArray(p.corners) || p.corners.length !== 4) return null;
    const corners = p.corners.map((c) => ({ x: Number(c.x), y: Number(c.y) }));
    if (corners.some((c) => !Number.isFinite(c.x) || !Number.isFinite(c.y) || c.x < 0 || c.x > 1 || c.y < 0 || c.y > 1)) {
      return null;
    }
    const rigor = Number(p.rigor);
    return {
      corners: corners as Corners,
      whiteAtBottom: p.whiteAtBottom !== false,
      rigor: rigor >= 1 && rigor <= 5 ? rigor : 3,
    };
  } catch {
    return null;
  }
}

function cameraError(e: unknown): string {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    return 'Este navegador não libera a câmera. Use Chrome ou Edge em localhost ou HTTPS.';
  }
  const name = e instanceof DOMException ? e.name : '';
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
    return 'Permissão da câmera negada. Libere o acesso nas configurações do navegador.';
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'Nenhuma câmera encontrada.';
  if (name === 'NotReadableError') return 'A câmera está em uso por outro programa.';
  return 'Não consegui abrir a câmera.';
}

async function openCamera(video: HTMLVideoElement): Promise<MediaStream> {
  const tries: MediaStreamConstraints[] = [
    { video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false },
    { video: true, audio: false },
  ];
  let last: unknown;
  for (const constraints of tries) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      video.srcObject = stream;
      await video.play();
      return stream;
    } catch (e) {
      last = e;
    }
  }
  throw last;
}

function stopStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((t) => t.stop());
}

/**
 * Câmera sobre o tabuleiro físico. A grade é ajustada à mão; o lance é a
 * diferença estável entre a imagem e a posição confirmada.
 */
export function CameraBoard({ fen, playerColor, paused, pausedText, onPlayerMove, onRepeat }: Props) {
  const storedRef = useRef<Stored | null | undefined>(undefined);
  if (storedRef.current === undefined) storedRef.current = loadStored();
  const stored = storedRef.current;
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const offRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const cornersRef = useRef<Corners>(stored?.corners ?? DEFAULT_CORNERS);
  const whiteRef = useRef(stored?.whiteAtBottom ?? true);
  const rigorRef = useRef(stored?.rigor ?? 3);
  const thresholdRef = useRef(thresholdOf(rigorRef.current));
  const phaseRef = useRef<TrackPhase>({ kind: 'align' });
  const referenceRef = useRef<Record<string, SquareSample> | null>(null);
  const changedRef = useRef<string[]>([]);
  const fenRef = useRef(fen);
  const colorRef = useRef(playerColor);
  const pausedRef = useRef(paused);
  const onMoveRef = useRef(onPlayerMove);
  const dragRef = useRef<number | null>(null);
  const stableKey = useRef('');
  const stableCount = useRef(0);
  const countRef = useRef(0);
  const statusRef = useRef('Ajuste os cantos e confirme a posição do tabuleiro.');

  fenRef.current = fen;
  colorRef.current = playerColor;
  pausedRef.current = paused;
  onMoveRef.current = onPlayerMove;

  const [status, setStatus] = useState(statusRef.current);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [aligned, setAligned] = useState(false);
  const [changedCount, setChangedCount] = useState(0);
  const [whiteAtBottom, setWhiteAtBottom] = useState(whiteRef.current);
  const [rigor, setRigor] = useState(rigorRef.current);
  const [aspect, setAspect] = useState(4 / 3);
  const [attempt, setAttempt] = useState(0);

  whiteRef.current = whiteAtBottom;
  rigorRef.current = rigor;
  thresholdRef.current = thresholdOf(rigor);

  const publish = useCallback((text: string) => {
    if (statusRef.current === text) return;
    statusRef.current = text;
    setStatus(text);
  }, []);

  const save = useCallback(() => {
    const data: Stored = {
      corners: cornersRef.current,
      whiteAtBottom: whiteRef.current,
      rigor: rigorRef.current,
    };
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(data));
    } catch {
      /* armazenamento cheio ou bloqueado */
    }
  }, []);

  const dropAlign = useCallback(
    (text: string) => {
      phaseRef.current = { kind: 'align' };
      referenceRef.current = null;
      changedRef.current = [];
      stableKey.current = '';
      stableCount.current = 0;
      countRef.current = 0;
      setChangedCount(0);
      setAligned(false);
      publish(text);
    },
    [publish],
  );

  const capture = useCallback((): Record<string, SquareSample> | null => {
    const video = videoRef.current;
    if (!video || video.readyState < 2 || !video.videoWidth) return null;
    let off = offRef.current;
    if (!off) {
      off = document.createElement('canvas');
      offRef.current = off;
    }
    const scale = Math.min(1, 640 / video.videoWidth);
    const w = Math.max(1, Math.round(video.videoWidth * scale));
    const h = Math.max(1, Math.round(video.videoHeight * scale));
    if (off.width !== w) off.width = w;
    if (off.height !== h) off.height = h;
    const ctx = off.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, w, h);
    const img = ctx.getImageData(0, 0, w, h);
    return readSamples({ data: img.data, width: w, height: h }, cornersRef.current, whiteRef.current);
  }, []);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video || !video.videoWidth) return;
    if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    const corners = cornersRef.current;
    const white = whiteRef.current;
    const px = (p: Point) => p.x * W;
    const py = (p: Point) => p.y * H;

    const fillSq = (sq: string, color: string) => {
      const poly = squarePolygon(corners, sq, white);
      ctx.beginPath();
      poly.forEach((p, i) => (i === 0 ? ctx.moveTo(px(p), py(p)) : ctx.lineTo(px(p), py(p))));
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
    };

    if (phaseRef.current.kind === 'engine') {
      for (const sq of squaresTouched(phaseRef.current.move)) fillSq(sq, 'rgba(91, 155, 213, 0.4)');
    }
    if (referenceRef.current) {
      for (const sq of changedRef.current) fillSq(sq, 'rgba(217, 164, 65, 0.4)');
    }

    ctx.strokeStyle = 'rgba(143, 208, 90, 0.92)';
    ctx.lineWidth = Math.max(1.5, W / 420);
    for (let i = 0; i <= 8; i++) {
      const top = quadPoint(corners, i / 8, 0);
      const bot = quadPoint(corners, i / 8, 1);
      ctx.beginPath();
      ctx.moveTo(px(top), py(top));
      ctx.lineTo(px(bot), py(bot));
      ctx.stroke();
      const left = quadPoint(corners, 0, i / 8);
      const right = quadPoint(corners, 1, i / 8);
      ctx.beginPath();
      ctx.moveTo(px(left), py(left));
      ctx.lineTo(px(right), py(right));
      ctx.stroke();
    }

    const radius = Math.max(8, W / 70);
    corners.forEach((p, i) => {
      ctx.beginPath();
      ctx.arc(px(p), py(p), radius, 0, Math.PI * 2);
      ctx.fillStyle = dragRef.current === i ? '#8fd05a' : '#f4f1ea';
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#1b3d0c';
      ctx.stroke();
    });
  }, []);

  useEffect(() => {
    if (paused) publish(pausedText);
  }, [paused, pausedText, publish]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let dead = false;
    let timer = 0;

    void (async () => {
      try {
        const stream = await openCamera(video);
        if (dead) {
          stopStream(stream);
          return;
        }
        streamRef.current = stream;
        setError(null);
        setReady(true);
        if (video.videoWidth) setAspect(video.videoWidth / video.videoHeight);
      } catch (e) {
        if (!dead) {
          setReady(false);
          setError(cameraError(e));
        }
      }
    })();

    const tick = () => {
      if (dead) return;
      try {
        draw();
        if (pausedRef.current || phaseRef.current.kind === 'align' || !referenceRef.current) {
          if (changedRef.current.length) {
            changedRef.current = [];
            countRef.current = 0;
            setChangedCount(0);
          }
          return;
        }
        const samples = capture();
        if (!samples) return;
        const changed = changedSquares(samples, referenceRef.current, thresholdRef.current);
        changedRef.current = changed;
        if (changed.length !== countRef.current) {
          countRef.current = changed.length;
          setChangedCount(changed.length);
        }
        const key = changed.join(',');
        if (key === stableKey.current) stableCount.current += 1;
        else {
          stableKey.current = key;
          stableCount.current = 1;
        }
        const { phase, event } = stepTracker(phaseRef.current, {
          liveFen: fenRef.current,
          changed,
          stable: changed.length > 0 && stableCount.current >= STABLE_FRAMES,
          playerColor: colorRef.current,
        });

        if (event?.type === 'player-move') {
          const ok = onMoveRef.current(event.move);
          if (!ok) {
            phaseRef.current = { kind: 'align' };
            referenceRef.current = null;
            changedRef.current = [];
            setAligned(false);
            publish('Não apliquei o lance. Confirme a posição de novo.');
            return;
          }
          referenceRef.current = samples;
          stableKey.current = '';
          stableCount.current = 0;
          changedRef.current = [];
          countRef.current = 0;
          setChangedCount(0);
        } else if (event?.type === 'engine-seen') {
          referenceRef.current = samples;
          stableKey.current = '';
          stableCount.current = 0;
          changedRef.current = [];
          countRef.current = 0;
          setChangedCount(0);
        } else if (event?.type === 'need-align') {
          referenceRef.current = null;
          changedRef.current = [];
          countRef.current = 0;
          setChangedCount(0);
          setAligned(false);
        }
        phaseRef.current = phase;
        if (event) publish(event.text);
      } finally {
        if (!dead) timer = window.setTimeout(tick, TICK_MS);
      }
    };

    timer = window.setTimeout(tick, TICK_MS);
    return () => {
      dead = true;
      window.clearTimeout(timer);
      stopStream(streamRef.current);
      streamRef.current = null;
      if (videoRef.current) videoRef.current.srcObject = null;
    };
  }, [attempt, capture, draw, publish]);

  const confirm = () => {
    const samples = capture();
    if (!samples) {
      publish('A câmera ainda não está pronta.');
      return;
    }
    referenceRef.current = samples;
    stableKey.current = '';
    stableCount.current = 0;
    changedRef.current = [];
    countRef.current = 0;
    setChangedCount(0);
    const phase = initialPhase(fenRef.current, colorRef.current);
    phaseRef.current = phase;
    setAligned(true);
    publish(
      phase.kind === 'player'
        ? 'Sua vez — mova uma peça no tabuleiro.'
        : phase.kind === 'wait'
          ? 'Aguardando o lance do Stockfish…'
          : 'Partida encerrada.',
    );
  };

  const norm = (e: ReactPointerEvent<HTMLCanvasElement>): Point => {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height)),
    };
  };

  const hitCorner = (p: Point): number | null => {
    let best = -1;
    let bestD = 0.06;
    cornersRef.current.forEach((c, i) => {
      const d = Math.hypot(c.x - p.x, c.y - p.y);
      if (d <= bestD) {
        best = i;
        bestD = d;
      }
    });
    return best >= 0 ? best : null;
  };

  return (
    <div className="cam-panel">
      <div className="cam-stage" style={{ ['--cam-aspect' as string]: String(aspect) }}>
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          onLoadedMetadata={() => {
            const v = videoRef.current;
            if (v?.videoWidth) setAspect(v.videoWidth / v.videoHeight);
          }}
        />
        <canvas
          ref={canvasRef}
          className="cam-overlay"
          onPointerDown={(e) => {
            const idx = hitCorner(norm(e));
            if (idx === null) return;
            dragRef.current = idx;
            e.currentTarget.setPointerCapture(e.pointerId);
            if (referenceRef.current) dropAlign('Cantos movidos. Confirme a posição de novo.');
          }}
          onPointerMove={(e) => {
            const idx = dragRef.current;
            if (idx === null) return;
            const p = norm(e);
            const next = cornersRef.current.slice() as Corners;
            next[idx] = p;
            cornersRef.current = next;
            draw();
          }}
          onPointerUp={() => {
            if (dragRef.current === null) return;
            dragRef.current = null;
            save();
            draw();
          }}
        />
      </div>

      <p className="cam-status" role="status">
        {status}
      </p>
      <p className="small muted">
        {aligned
          ? `${changedCount} ${changedCount === 1 ? 'casa diferente' : 'casas diferentes'} da posição confirmada. Em repouso deve ficar 0. Amarelo marca o que mudou; azul, o lance do Stockfish.`
          : 'Deixe o tabuleiro físico igual ao da tela. Arraste os quatro pontos até os cantos das 64 casas e confirme.'}
      </p>

      <div className="seg" role="group" aria-label="Lado perto da câmera">
        <button
          className={whiteAtBottom ? 'active' : ''}
          onClick={() => {
            if (whiteAtBottom) return;
            whiteRef.current = true;
            setWhiteAtBottom(true);
            dropAlign('Lado trocado. Confirme a posição de novo.');
            save();
          }}
        >
          Brancas perto de mim
        </button>
        <button
          className={!whiteAtBottom ? 'active' : ''}
          onClick={() => {
            if (!whiteAtBottom) return;
            whiteRef.current = false;
            setWhiteAtBottom(false);
            dropAlign('Lado trocado. Confirme a posição de novo.');
            save();
          }}
        >
          Pretas perto de mim
        </button>
      </div>

      <label className="field">
        <span>
          Rigor da leitura: <b>{rigor}</b>
        </span>
        <input
          type="range"
          min={1}
          max={5}
          step={1}
          value={rigor}
          onChange={(e) => {
            const n = Number(e.target.value);
            rigorRef.current = n;
            thresholdRef.current = thresholdOf(n);
            setRigor(n);
            save();
          }}
        />
      </label>
      <p className="small muted">Aumente se uma casa vazia pisca. Diminua se o seu lance não é lido.</p>

      {error && <p className="err small">{error}</p>}

      <div className="row">
        <button className="primary" onClick={confirm} disabled={!ready || paused}>
          {aligned ? 'Realinhar' : 'Confirmar posição'}
        </button>
        <button onClick={onRepeat}>Ouvir último lance</button>
        <button
          onClick={() => {
            cornersRef.current = DEFAULT_CORNERS.map((p) => ({ ...p })) as Corners;
            dropAlign('Cantos resetados. Ajuste e confirme a posição.');
            save();
            draw();
          }}
        >
          Resetar cantos
        </button>
        {error && (
          <button
            onClick={() => {
              setError(null);
              setAttempt((n) => n + 1);
            }}
          >
            Tentar câmera de novo
          </button>
        )}
      </div>
    </div>
  );
}
