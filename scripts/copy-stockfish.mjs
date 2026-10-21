// Copia o Stockfish (WASM, single-thread, "lite") para public/ para ser carregado como Web Worker.
// A versão single-thread não exige cross-origin isolation (COOP/COEP), então roda em qualquer host estático.
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'node_modules', 'stockfish', 'bin');
const dest = join(root, 'public', 'stockfish');
const files = ['stockfish-19-lite-single.js', 'stockfish-19-lite-single.wasm'];

if (!existsSync(src)) {
  console.warn('[copy-stockfish] node_modules/stockfish não encontrado; pulando.');
  process.exit(0);
}
mkdirSync(dest, { recursive: true });
for (const f of files) copyFileSync(join(src, f), join(dest, f));
console.log('[copy-stockfish] motor copiado para public/stockfish');
