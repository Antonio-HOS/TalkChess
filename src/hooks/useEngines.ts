import { useEffect, useRef, useState } from 'react';
import { UciEngine } from '../lib/engine';

/**
 * Cria dois workers do Stockfish:
 *  - `player`: o adversário (força limitada pelo rating escolhido)
 *  - `analyst`: força máxima, usado para avaliação, dicas e revisão
 */
export function useEngines() {
  const playerRef = useRef<UciEngine | null>(null);
  const analystRef = useRef<UciEngine | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    try {
      const player = new UciEngine();
      const analyst = new UciEngine();
      playerRef.current = player;
      analystRef.current = analyst;
      Promise.all([player.ready(), analyst.ready()])
        .then(async () => {
          await analyst.setOption('Hash', 32);
          await player.setOption('Hash', 16);
          if (!cancelled) setReady(true);
        })
        .catch((e) => !cancelled && setError(String(e)));
    } catch (e) {
      setError(`Não foi possível iniciar o Stockfish: ${String(e)}`);
    }
    return () => {
      cancelled = true;
      playerRef.current?.destroy();
      analystRef.current?.destroy();
      playerRef.current = null;
      analystRef.current = null;
      setReady(false);
    };
  }, []);

  return { player: playerRef, analyst: analystRef, ready, error };
}
