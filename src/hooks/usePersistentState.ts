import { useEffect, useState } from 'react';

/**
 * useState com persistência em localStorage.
 * Para objetos, mescla com os valores padrão (novas chaves de config não quebram dados antigos).
 */
export function usePersistentState<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(`talkchess:${key}`);
      if (raw === null) return initial;
      const parsed = JSON.parse(raw) as T;
      const isObj = (v: unknown): v is object => typeof v === 'object' && v !== null && !Array.isArray(v);
      return isObj(initial) && isObj(parsed) ? ({ ...initial, ...parsed } as T) : parsed;
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(`talkchess:${key}`, JSON.stringify(value));
    } catch {
      /* ignore */
    }
  }, [key, value]);
  return [value, setValue] as const;
}
