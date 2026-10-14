// Tiny sound feedback, generated in the browser. Nothing to install; works offline.
let ctx: AudioContext | null = null;
let enabled = true;
try { enabled = localStorage.getItem('pos_sounds') !== 'off'; } catch { /* fine */ }

export function soundsEnabled(): boolean { return enabled; }
export function setSoundsEnabled(on: boolean): void {
  enabled = on;
  try { localStorage.setItem('pos_sounds', on ? 'on' : 'off'); } catch { /* fine */ }
  if (on) play('tap');
}

function ac(): AudioContext | null {
  if (!ctx) { try { ctx = new AudioContext(); } catch { return null; } }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

function tone(freq: number, startMs: number, lenMs: number, type: OscillatorType, gain: number) {
  const c = ac(); if (!c) return;
  const o = c.createOscillator(); const g = c.createGain();
  const t0 = c.currentTime + startMs / 1000; const t1 = t0 + lenMs / 1000;
  o.type = type; o.frequency.setValueAtTime(freq, t0);
  g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(gain, t0 + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t1);
  o.connect(g); g.connect(c.destination); o.start(t0); o.stop(t1 + 0.02);
}

export type Sound = 'tap' | 'ok' | 'bad' | 'done';
export function play(kind: Sound): void {
  if (!enabled) return;
  switch (kind) {
    case 'tap': tone(1800, 0, 35, 'sine', 0.12); break;                 // soft click on any button
    case 'ok': tone(1200, 0, 60, 'sine', 0.16); tone(1700, 60, 80, 'sine', 0.16); break; // item added / scan took
    case 'bad': tone(220, 0, 160, 'square', 0.08); break;                // unknown barcode, under age, error
    case 'done': tone(900, 0, 70, 'sine', 0.16); tone(1300, 80, 70, 'sine', 0.16); tone(1800, 160, 120, 'sine', 0.16); break; // sale complete
  }
}

/** Plays the tap sound for every real button press on the page. */
export function installTapSound(): () => void {
  const h = (e: PointerEvent) => {
    const el = (e.target as HTMLElement | null)?.closest('button');
    if (el && !el.disabled) play('tap');
  };
  window.addEventListener('pointerdown', h, true);
  return () => window.removeEventListener('pointerdown', h, true);
}
