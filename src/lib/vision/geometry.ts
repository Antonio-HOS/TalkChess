/**
 * Geometria do tabuleiro visto pela câmera.
 *
 * Os quatro cantos estão normalizados (0..1) na imagem, nesta ordem:
 * topo-esquerdo, topo-direito, base-direita, base-esquerda — do quad
 * como a câmera vê, não das casas do xadrez.
 */

export interface Point {
  x: number;
  y: number;
}

export type Corners = [Point, Point, Point, Point];

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export interface SquareSample {
  r: number;
  g: number;
  b: number;
  lum: number;
  /** desvio-padrão da luminância — casa vazia é lisa, peça tem textura */
  spread: number;
}

export interface PixelFrame {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

const FILES = 'abcdefgh';

export const SQUARES: string[] = [];
for (let rank = 1; rank <= 8; rank++) {
  for (const f of FILES) SQUARES.push(`${f}${rank}`);
}

export function lerp(a: Point, b: Point, t: number): Point {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/** u: esquerda → direita, v: topo → base, ambos 0..1 dentro do quad. */
export function quadPoint(corners: Corners, u: number, v: number): Point {
  const [tl, tr, br, bl] = corners;
  return lerp(lerp(tl, tr, u), lerp(bl, br, u), v);
}

function placement(square: string, whiteAtBottom: boolean): { col: number; rowFromTop: number } {
  const file = FILES.indexOf(square[0]);
  const rank = Number(square[1]) - 1;
  const col = whiteAtBottom ? file : 7 - file;
  const rowFromTop = whiteAtBottom ? 7 - rank : rank;
  return { col, rowFromTop };
}

/** Centro da casa, no mesmo espaço dos cantos. */
export function squareCenter(corners: Corners, square: string, whiteAtBottom: boolean): Point {
  const { col, rowFromTop } = placement(square, whiteAtBottom);
  return quadPoint(corners, (col + 0.5) / 8, (rowFromTop + 0.5) / 8);
}

/** Quatro cantos da casa, começando pelo topo-esquerdo do quad. */
export function squarePolygon(corners: Corners, square: string, whiteAtBottom: boolean): Point[] {
  const { col, rowFromTop } = placement(square, whiteAtBottom);
  const u0 = col / 8;
  const v0 = rowFromTop / 8;
  const u1 = (col + 1) / 8;
  const v1 = (rowFromTop + 1) / 8;
  return [quadPoint(corners, u0, v0), quadPoint(corners, u1, v0), quadPoint(corners, u1, v1), quadPoint(corners, u0, v1)];
}

const SAMPLE_STEPS = [0.32, 0.44, 0.56, 0.68];

export function samplePoints(corners: Corners, square: string, whiteAtBottom: boolean): Point[] {
  const { col, rowFromTop } = placement(square, whiteAtBottom);
  const pts: Point[] = [];
  for (const du of SAMPLE_STEPS) {
    for (const dv of SAMPLE_STEPS) {
      pts.push(quadPoint(corners, (col + du) / 8, (rowFromTop + dv) / 8));
    }
  }
  return pts;
}

function median(values: number[]): number {
  const s = values.slice().sort((a, b) => a - b);
  const i = s.length >> 1;
  return s.length % 2 === 1 ? s[i] : (s[i - 1] + s[i]) / 2;
}

export function summarize(pixels: Rgb[]): SquareSample {
  if (pixels.length === 0) return { r: 0, g: 0, b: 0, lum: 0, spread: 0 };
  const lums = pixels.map((p) => 0.2126 * p.r + 0.7152 * p.g + 0.0722 * p.b);
  const mean = lums.reduce((a, b) => a + b, 0) / lums.length;
  const variance = lums.reduce((a, b) => a + (b - mean) ** 2, 0) / lums.length;
  return {
    r: median(pixels.map((p) => p.r)),
    g: median(pixels.map((p) => p.g)),
    b: median(pixels.map((p) => p.b)),
    lum: mean,
    spread: Math.sqrt(variance),
  };
}

/** 0 = idêntico, ~1 = cores opostas. Textura alta também conta (peça clara em casa clara). */
export function sampleDistance(a: SquareSample, b: SquareSample): number {
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  const color = Math.sqrt(dr * dr + dg * dg + db * db) / 441.67295593;
  const spread = Math.min(1, Math.abs(a.spread - b.spread) / 48);
  return Math.max(color, spread * 0.85);
}

export function readSamples(frame: PixelFrame, corners: Corners, whiteAtBottom: boolean): Record<string, SquareSample> {
  const { data, width, height } = frame;
  const out: Record<string, SquareSample> = {};
  for (const sq of SQUARES) {
    const pixels: Rgb[] = [];
    for (const p of samplePoints(corners, sq, whiteAtBottom)) {
      const x = Math.max(0, Math.min(width - 1, Math.round(p.x * (width - 1))));
      const y = Math.max(0, Math.min(height - 1, Math.round(p.y * (height - 1))));
      const i = (y * width + x) * 4;
      pixels.push({ r: data[i], g: data[i + 1], b: data[i + 2] });
    }
    out[sq] = summarize(pixels);
  }
  return out;
}

export function changedSquares(
  current: Record<string, SquareSample>,
  reference: Record<string, SquareSample>,
  threshold: number,
): string[] {
  const out: string[] = [];
  for (const sq of SQUARES) {
    const a = current[sq];
    const b = reference[sq];
    if (!a || !b) continue;
    if (sampleDistance(a, b) >= threshold) out.push(sq);
  }
  return out;
}
