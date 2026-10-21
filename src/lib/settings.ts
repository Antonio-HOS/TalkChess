import type { BoardThemeKey } from '../components/BoardView';

export type SidePref = 'white' | 'black' | 'random';

export interface Settings {
  side: SidePref;
  elo: number;
  timeControl: string; // 'none' | 'MIN+INC'
  voiceLang: string;
  speakMoves: boolean;
  sounds: boolean;
  theme: BoardThemeKey;
  showLegal: boolean;
  showEval: boolean;
  animate: boolean;
  lichessUser: string;
}

export const DEFAULT_SETTINGS: Settings = {
  side: 'white',
  elo: 1500,
  timeControl: 'none',
  voiceLang: 'pt-BR',
  speakMoves: true,
  sounds: true,
  theme: 'verde',
  showLegal: true,
  showEval: false,
  animate: true,
  lichessUser: '',
};

export const TIME_CONTROLS: Array<{ value: string; label: string }> = [
  { value: 'none', label: 'Sem relógio' },
  { value: '3+0', label: '3 min' },
  { value: '5+0', label: '5 min' },
  { value: '10+0', label: '10 min' },
  { value: '15+10', label: '15 + 10' },
  { value: '30+0', label: '30 min' },
];

export function parseTimeControl(v: string): { baseMs: number; incMs: number } | null {
  if (v === 'none') return null;
  const [m, i] = v.split('+').map(Number);
  if (!Number.isFinite(m)) return null;
  return { baseMs: m * 60_000, incMs: (i || 0) * 1000 };
}

export const VOICE_LANGS = [
  { value: 'pt-BR', label: 'Português (Brasil)' },
  { value: 'pt-PT', label: 'Português (Portugal)' },
  { value: 'en-US', label: 'English (US)' },
  { value: 'en-GB', label: 'English (UK)' },
];

export function eloLabel(elo: number): string {
  if (elo < 800) return 'Iniciante';
  if (elo < 1200) return 'Casual';
  if (elo < 1600) return 'Intermediário';
  if (elo < 2000) return 'Avançado';
  if (elo < 2400) return 'Mestre de clube';
  if (elo < 2800) return 'Mestre';
  if (elo < 3190) return 'Grande Mestre';
  return 'Stockfish total';
}
