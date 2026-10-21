let ctx: AudioContext | null = null;

function tone(freq: number, duration: number, type: OscillatorType, gain: number, delay = 0) {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(g).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + duration);
  } catch {
    /* sem áudio disponível */
  }
}

export type SoundKind = 'move' | 'capture' | 'check' | 'end' | 'error' | 'listen';

export function playSound(kind: SoundKind) {
  switch (kind) {
    case 'move':
      tone(320, 0.07, 'triangle', 0.25);
      break;
    case 'capture':
      tone(220, 0.1, 'sawtooth', 0.18);
      tone(160, 0.1, 'triangle', 0.2, 0.03);
      break;
    case 'check':
      tone(520, 0.12, 'square', 0.1);
      tone(660, 0.12, 'square', 0.1, 0.1);
      break;
    case 'end':
      tone(392, 0.2, 'triangle', 0.2);
      tone(330, 0.2, 'triangle', 0.2, 0.18);
      tone(262, 0.35, 'triangle', 0.2, 0.36);
      break;
    case 'error':
      tone(140, 0.18, 'square', 0.12);
      break;
    case 'listen':
      tone(740, 0.06, 'sine', 0.12);
      break;
  }
}
