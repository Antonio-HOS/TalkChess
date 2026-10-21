/**
 * Wrapper UCI em torno do Stockfish (WASM) rodando em um Web Worker.
 * Uma instância executa uma busca por vez; iniciar outra cancela a anterior.
 */

export interface EngineInfo {
  depth: number;
  /** centipeões do ponto de vista de quem joga (side to move) */
  cp?: number;
  /** mate em N (positivo = quem joga dá mate) */
  mate?: number;
  pv: string[];
}

export interface SearchResult {
  /** movimento em UCI (ex.: "e2e4", "e7e8q") ou null se cancelado/sem lance */
  move: string | null;
  ponder?: string;
  info?: EngineInfo;
  cancelled: boolean;
}

export interface SearchOptions {
  movetime?: number;
  depth?: number;
  /** restringe a busca a estes lances (UCI) */
  searchMoves?: string[];
}

export interface Strength {
  /** Elo alvo exibido ao usuário */
  elo: number;
  limit: boolean;
  uciElo: number;
  skill: number;
  depth?: number;
  movetime: number;
  /** probabilidade de jogar um lance aleatório (iniciantes) */
  blunderChance: number;
}

export const MIN_ELO = 400;
export const MAX_ELO = 3200;
const SF_MIN_ELO = 1320;
const SF_MAX_ELO = 3190;

/** Converte o rating desejado em parâmetros de força do Stockfish. */
export function strengthForElo(elo: number): Strength {
  const e = Math.max(MIN_ELO, Math.min(MAX_ELO, Math.round(elo)));
  if (e >= SF_MAX_ELO) {
    return { elo: e, limit: false, uciElo: SF_MAX_ELO, skill: 20, movetime: 1500, blunderChance: 0 };
  }
  if (e >= SF_MIN_ELO) {
    // Quanto mais forte, mais tempo de busca (o limitador do SF já controla a qualidade).
    const movetime = Math.round(400 + ((e - SF_MIN_ELO) / (SF_MAX_ELO - SF_MIN_ELO)) * 1100);
    return { elo: e, limit: true, uciElo: e, skill: 20, movetime, blunderChance: 0 };
  }
  // Abaixo de 1320 o UCI_Elo não alcança: usamos Skill Level + profundidade rasa + erros ocasionais.
  const t = (e - MIN_ELO) / (SF_MIN_ELO - MIN_ELO); // 0..1
  const skill = Math.round(t * 5);
  const depth = e < 600 ? 1 : e < 800 ? 2 : e < 1000 ? 3 : e < 1150 ? 4 : 5;
  const blunderChance = e < 1000 ? Math.round((1 - (e - MIN_ELO) / 600) * 0.3 * 100) / 100 : 0;
  return { elo: e, limit: false, uciElo: SF_MIN_ELO, skill, depth, movetime: 250, blunderChance };
}

export function engineUrl(): string {
  return `${import.meta.env.BASE_URL}stockfish/stockfish-19-lite-single.js`;
}

type Line = (line: string) => void;

export class UciEngine {
  private worker: Worker;
  private listeners = new Set<Line>();
  private readyPromise: Promise<void>;
  private searching: { resolve: (r: SearchResult) => void; cancel: () => void } | null = null;
  private destroyed = false;

  constructor(url: string = engineUrl()) {
    this.worker = new Worker(url);
    this.worker.onmessage = (ev: MessageEvent) => {
      const line = typeof ev.data === 'string' ? ev.data : String(ev.data);
      this.listeners.forEach((l) => l(line));
    };
    this.worker.onerror = (ev) => {
      console.error('[stockfish] erro no worker', ev.message);
    };
    this.readyPromise = this.handshake();
  }

  private send(cmd: string) {
    if (!this.destroyed) this.worker.postMessage(cmd);
  }

  private waitFor(match: (line: string) => boolean): Promise<void> {
    return new Promise((resolve) => {
      const l: Line = (line) => {
        if (match(line)) {
          this.listeners.delete(l);
          resolve();
        }
      };
      this.listeners.add(l);
    });
  }

  private async handshake() {
    const uciok = this.waitFor((l) => l.startsWith('uciok'));
    this.send('uci');
    await uciok;
    await this.sync();
  }

  private async sync() {
    const ok = this.waitFor((l) => l.startsWith('readyok'));
    this.send('isready');
    await ok;
  }

  ready(): Promise<void> {
    return this.readyPromise;
  }

  async setOption(name: string, value: string | number | boolean) {
    await this.readyPromise;
    this.send(`setoption name ${name} value ${value}`);
  }

  async applyStrength(s: Strength) {
    await this.readyPromise;
    this.send(`setoption name UCI_LimitStrength value ${s.limit}`);
    if (s.limit) this.send(`setoption name UCI_Elo value ${s.uciElo}`);
    this.send(`setoption name Skill Level value ${s.skill}`);
    await this.sync();
  }

  async newGame() {
    await this.stop();
    this.send('ucinewgame');
    await this.sync();
  }

  /** Cancela a busca atual (se houver) e aguarda o engine terminar. */
  async stop() {
    const cur = this.searching;
    if (!cur) return;
    cur.cancel();
  }

  /** Busca o melhor lance para a posição. Cancela qualquer busca anterior. */
  async search(
    fen: string,
    opts: SearchOptions,
    onInfo?: (info: EngineInfo) => void,
  ): Promise<SearchResult> {
    await this.readyPromise;
    if (this.searching) {
      const prev = this.searching;
      const done = new Promise<void>((r) => {
        const orig = prev.resolve;
        prev.resolve = (res) => {
          orig(res);
          r();
        };
      });
      prev.cancel();
      await done;
    }
    if (this.destroyed) return { move: null, cancelled: true };

    return new Promise<SearchResult>((resolve) => {
      let last: EngineInfo | undefined;
      let cancelled = false;

      const l: Line = (line) => {
        if (line.startsWith('info ') && line.includes(' pv ')) {
          const info = parseInfo(line);
          if (info) {
            last = info;
            onInfo?.(info);
          }
        } else if (line.startsWith('bestmove')) {
          this.listeners.delete(l);
          this.searching = null;
          const parts = line.split(/\s+/);
          const mv = parts[1] && parts[1] !== '(none)' && parts[1] !== '0000' ? parts[1] : null;
          const ponderIdx = parts.indexOf('ponder');
          const ponder = ponderIdx > 0 ? parts[ponderIdx + 1] : undefined;
          this.searching = null;
          entry.resolve({ move: cancelled ? null : mv, ponder, info: last, cancelled });
        }
      };

      const entry = {
        resolve,
        cancel: () => {
          cancelled = true;
          this.send('stop');
        },
      };
      this.searching = entry;
      this.listeners.add(l);

      this.send(`position fen ${fen}`);
      let go = 'go';
      if (opts.searchMoves?.length) go += ` searchmoves ${opts.searchMoves.join(' ')}`;
      if (opts.depth) go += ` depth ${opts.depth}`;
      if (opts.movetime) go += ` movetime ${opts.movetime}`;
      if (!opts.depth && !opts.movetime) go += ' movetime 1000';
      this.send(go);
    });
  }

  destroy() {
    this.destroyed = true;
    this.listeners.clear();
    this.worker.terminate();
  }
}

export function parseInfo(line: string): EngineInfo | null {
  // ignora linhas parciais de aspiration window
  if (/\b(lowerbound|upperbound)\b/.test(line)) return null;
  const depth = /\bdepth (\d+)/.exec(line);
  const cp = /\bscore cp (-?\d+)/.exec(line);
  const mate = /\bscore mate (-?\d+)/.exec(line);
  const pv = /\bpv (.+)$/.exec(line);
  if (!depth || !pv || (!cp && !mate)) return null;
  return {
    depth: Number(depth[1]),
    cp: cp ? Number(cp[1]) : undefined,
    mate: mate ? Number(mate[1]) : undefined,
    pv: pv[1].trim().split(/\s+/),
  };
}
