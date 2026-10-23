import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import { parseOne, parseVoice, spokenMove } from './parser';

const START = new Chess().fen();

function san(text: string, fen = START): string {
  const r = parseOne(text, fen);
  if (r.kind !== 'move') throw new Error(`"${text}" => ${r.kind}`);
  return r.move.san;
}

function play(...sans: string[]): string {
  const c = new Chess();
  sans.forEach((s) => c.move(s));
  return c.fen();
}

describe('lances simples', () => {
  it('casa colada', () => expect(san('e4')).toBe('e4'));
  it('casa em maiúsculas', () => expect(san('E4')).toBe('e4'));
  it('letra e número por extenso', () => expect(san('e quatro')).toBe('e4'));
  it('letra e dígito separados', () => expect(san('e 4')).toBe('e4'));
  it('nome pronunciado: dê quatro', () => expect(san('dê quatro')).toBe('d4'));
  it('nome pronunciado: cê quatro', () => expect(san('cê quatro')).toBe('c4'));
  it('nome pronunciado: bê três', () => expect(san('bê três')).toBe('b3'));
  it('nome pronunciado: agá três', () => expect(san('agá três')).toBe('h3'));
  it('peão e4', () => expect(san('peão e quatro')).toBe('e4'));
  it('origem e destino', () => expect(san('e2 e4')).toBe('e4'));
  it('origem para destino', () => expect(san('e dois para e quatro')).toBe('e4'));
  it('uci colado', () => expect(san('e2e4')).toBe('e4'));
  it('cavalo f3', () => expect(san('cavalo f3')).toBe('Nf3'));
  it('cavalo para efe três', () => expect(san('cavalo para efe três')).toBe('Nf3'));
  it('cavalo de g1 para f3', () => expect(san('cavalo de g1 para f3')).toBe('Nf3'));
  it('SAN colado', () => expect(san('Nf3')).toBe('Nf3'));
  it('inglês', () => expect(san('knight to f3')).toBe('Nf3'));
  it('inglês com casas por extenso', () => expect(san('pawn e four')).toBe('e4'));
});

describe('capturas, roque e xeque', () => {
  const afterE4D5 = play('e4', 'd5');
  it('peão toma d5', () => expect(san('peão toma d5', afterE4D5)).toBe('exd5'));
  it('e toma d5', () => expect(san('e toma d5', afterE4D5)).toBe('exd5'));
  it('exd5 colado', () => expect(san('exd5', afterE4D5)).toBe('exd5'));
  it('e4 toma d5 (origem e destino)', () => expect(san('e4 toma d5', afterE4D5)).toBe('exd5'));

  const beforeCastle = play('e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5');
  it('roque curto', () => expect(san('roque curto', beforeCastle)).toBe('O-O'));
  it('roque pequeno', () => expect(san('roque pequeno', beforeCastle)).toBe('O-O'));
  it('rock curto', () => expect(san('rock curto', beforeCastle)).toBe('O-O'));
  it('rock sozinho', () => expect(san('rock', beforeCastle)).toBe('O-O'));
  it('O-O', () => expect(san('O-O', beforeCastle)).toBe('O-O'));
  it('roque longo ilegal', () => expect(parseOne('roque longo', beforeCastle).kind).toBe('illegal'));
  it('rock longo ilegal', () => expect(parseOne('rock longo', beforeCastle).kind).toBe('illegal'));
  it('bispo toma f7', () => expect(san('bispo toma f7', beforeCastle)).toBe('Bxf7+'));
});

describe('captura peça contra peça', () => {
  const knightTakesPawn = play('e4', 'e5', 'Nf3', 'Nc6');
  it('cavalo toma peão quando é o único', () => expect(san('cavalo toma peão', knightTakesPawn)).toBe('Nxe5'));
  it('inglês: knight takes pawn', () => expect(san('knight takes pawn', knightTakesPawn)).toBe('Nxe5'));
  it('cavalo x peão', () => expect(san('cavalo x peão', knightTakesPawn)).toBe('Nxe5'));
  it('sem alvo continua desconhecido', () => expect(parseOne('cavalo toma', knightTakesPawn).kind).toBe('unknown'));
  it('inexistente é ilegal', () => {
    const r = parseOne('cavalo toma peão', START);
    expect(r.kind).toBe('illegal');
  });

  const knightFork = '4k3/8/8/4p1b1/8/5N2/8/4K3 w - - 0 1';
  it('distingue a peça capturada', () => {
    expect(san('cavalo toma peão', knightFork)).toBe('Nxe5');
    expect(san('cavalo toma bispo', knightFork)).toBe('Nxg5');
  });

  it('peão toma peão', () => expect(san('peão toma peão', play('e4', 'd5'))).toBe('exd5'));
  it('peão toma peão ambíguo', () => {
    const r = parseOne('peão toma peão', play('e4', 'd5', 'd4', 'e5'));
    expect(r.kind).toBe('ambiguous');
    if (r.kind === 'ambiguous') expect(r.candidates.map((m) => m.san).sort()).toEqual(['dxe5', 'exd5']);
  });
  it('en passant', () => expect(san('peão toma peão', play('e4', 'a6', 'e5', 'd5'))).toBe('exd6'));

  it('bispo toma a dama', () => expect(san('bispo toma a dama', '4k3/8/8/8/2B5/3q4/8/4K3 w - - 0 1')).toBe('Bxd3'));
  it('dama toma torre', () => expect(san('rainha toma torre', '3rk3/8/8/8/8/8/8/3QK3 w - - 0 1')).toBe('Qxd8+'));
  it('torre toma dama', () => expect(san('torre toma dama', 'q3k3/8/8/8/8/8/8/R3K3 w - - 0 1')).toBe('Rxa8+'));
  it('rei toma peão', () => expect(san('rei toma peão', '4k3/8/8/8/8/8/3p4/4K3 w - - 0 1')).toBe('Kxd2'));
  it('peão toma torre e promove', () => expect(san('peão toma torre', '3r4/4P3/8/8/8/8/8/4K2k w - - 0 1')).toBe('exd8=Q'));
  it('peão toma torre vira cavalo', () => expect(san('peão toma torre vira cavalo', '3r4/4P3/8/8/8/8/8/4K2k w - - 0 1')).toBe('exd8=N'));

  const twoKnights = '4k3/8/8/8/4p3/8/3N1N2/4K3 w - - 0 1';
  it('ambíguo entre dois cavalos', () => {
    const r = parseOne('cavalo toma peão', twoKnights);
    expect(r.kind).toBe('ambiguous');
    if (r.kind === 'ambiguous') expect(r.candidates.map((m) => m.san).sort()).toEqual(['Ndxe4', 'Nfxe4']);
  });
  it('desambigua pela coluna', () => {
    expect(san('cavalo dê toma peão', twoKnights)).toBe('Ndxe4');
    expect(san('cavalo efe toma peão', twoKnights)).toBe('Nfxe4');
  });
});

describe('ambiguidade e desambiguação', () => {
  // Dois cavalos podem ir para d2? Posição com cavalos em b1 e f3 e d2 livre
  const fen = play('Nf3', 'Nf6', 'd3', 'd5', 'Nc3', 'Nc6', 'Bd2', 'e5', 'Qc1');
  it('detecta ambiguidade', () => {
    const f = new Chess('4k3/8/8/8/8/8/8/1N3N1K w - - 0 1').fen();
    const r = parseOne('cavalo d2', f);
    expect(r.kind).toBe('ambiguous');
  });
  it('resolve pela origem', () => {
    const f = new Chess('4k3/8/8/8/8/8/8/1N3N1K w - - 0 1').fen();
    expect(san('cavalo b1 para d2', f)).toBe('Nbd2');
    expect(san('cavalo f1 d2', f)).toBe('Nfd2');
  });
  it('resolve pela coluna falada', () => {
    const f = new Chess('4k3/8/8/8/8/8/8/1N3N1K w - - 0 1').fen();
    expect(san('cavalo b d2', f)).toBe('Nbd2');
  });
  it('fen irrelevante não quebra', () => expect(fen).toBeTruthy());
});

describe('promoção', () => {
  const f = '8/4P2k/8/8/8/8/8/K7 w - - 0 1';
  it('padrão: dama', () => expect(san('e8', f)).toBe('e8=Q'));
  it('peão e8 promove para cavalo', () => expect(san('peão e8 promove para cavalo', f)).toBe('e8=N'));
  it('e8 torre', () => expect(san('e8 torre', f)).toBe('e8=R'));
  it('e8=q colado', () => expect(san('e8=q', f)).toBe('e8=Q'));
});

describe('comandos', () => {
  it.each([
    ['desfazer', 'undo'],
    ['nova partida', 'new'],
    ['desistir', 'resign'],
    ['dica', 'hint'],
    ['girar tabuleiro', 'flip'],
    ['oferecer empate', 'draw'],
    ['repetir', 'repeat'],
    ['sim', 'confirm'],
    ['cancelar', 'cancel'],
  ])('%s', (text, action) => {
    const r = parseOne(text, START);
    expect(r).toMatchObject({ kind: 'action', action });
  });
  it('lixo é desconhecido', () => expect(parseOne('bom dia pessoal', START).kind).toBe('unknown'));
});

describe('alternativas de reconhecimento', () => {
  it('escolhe a alternativa que forma um lance legal', () => {
    const r = parseVoice(['blá blá', 'e quatro'], START);
    expect(r.kind).toBe('move');
  });
});

describe('fala', () => {
  it('descreve o lance em português', () => {
    const c = new Chess();
    const m = c.move('Nf3');
    expect(spokenMove(m)).toBe('Cavalo efe 3');
  });
});
