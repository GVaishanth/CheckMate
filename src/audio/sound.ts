/**
 * Sound — synthesized via Web Audio API. No audio assets, fully offline.
 *
 * Design: one coherent "wood + tone" family.
 *   move/capture/castle — wooden thocks (capture is deeper and doubled)
 *   check               — a sharper tonal cue over a soft thock
 *   checkmate           — two-stage: the landing thock, pause, resolution
 *   promotion/victory   — restrained ascending tones
 *   defeat/draw         — subdued neutral resolutions
 *   illegal             — a muted, almost subliminal thud (never a buzzer)
 *
 * Every sound has a volume tier (UI < moves < game events), a per-sound
 * cooldown to prevent spam, and game sounds take priority over UI ticks.
 * The AudioContext is created lazily and silently on the first user
 * gesture (autoplay policies); audio failure is never fatal.
 */

export type SoundName =
  | 'move'
  | 'capture'
  | 'castle'
  | 'check'
  | 'checkmate'
  | 'illegal'
  | 'promotion'
  | 'victory'
  | 'defeat'
  | 'draw'
  | 'gameStart'
  | 'wrong'
  | 'solved'
  | 'reveal'
  | 'notify'
  | 'uiTick';

/** Relative loudness per sound — quieter than you think, by design. */
const VOLUME: Record<SoundName, number> = {
  uiTick: 0.16,
  illegal: 0.3,
  move: 0.5,
  castle: 0.52,
  capture: 0.66,
  check: 0.58,
  checkmate: 0.72,
  promotion: 0.58,
  victory: 0.6,
  defeat: 0.46,
  draw: 0.48,
  gameStart: 0.5,
  wrong: 0.4,
  solved: 0.58,
  reveal: 0.52,
  notify: 0.44,
};

/** Minimum gap between repeats of the same sound (ms). */
const COOLDOWN_MS: Partial<Record<SoundName, number>> = {
  illegal: 260,
  uiTick: 70,
  move: 35,
  capture: 35,
  castle: 80,
  check: 150,
  wrong: 150,
  notify: 250,
  promotion: 200,
};

const UI_SOUNDS = new Set<SoundName>(['uiTick']);

class SoundEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private enabled = true;
  private uiSounds = true;
  private volume = 0.7;
  private lastPlayedAt = new Map<SoundName, number>();
  private lastGameSoundAt = 0;

  setEnabled(on: boolean): void {
    this.enabled = on;
  }

  setUiSounds(on: boolean): void {
    this.uiSounds = on;
  }

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.master) this.master.gain.value = this.volume * 0.9;
  }

  /** Must be called from a user gesture at least once. Creates the context silently. */
  unlock(): void {
    this.ensureCtx();
  }

  private ensureCtx(): AudioContext | null {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return this.ctx;
    }
    try {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume * 0.9;
      this.master.connect(this.ctx.destination);
      return this.ctx;
    } catch {
      return null;
    }
  }

  play(name: SoundName): void {
    if (!this.enabled) return;
    if (UI_SOUNDS.has(name) && !this.uiSounds) return;
    const now = performance.now();

    const cd = COOLDOWN_MS[name];
    if (cd !== undefined && now - (this.lastPlayedAt.get(name) ?? -Infinity) < cd) return;
    // A UI tick right after a chess event would just be noise.
    if (UI_SOUNDS.has(name) && now - this.lastGameSoundAt < 90) return;

    const ctx = this.ensureCtx();
    if (!ctx || !this.master) return;
    if (ctx.state === 'suspended') void ctx.resume();
    if (ctx.state !== 'running') return;

    this.lastPlayedAt.set(name, now);
    if (!UI_SOUNDS.has(name)) this.lastGameSoundAt = now;
    try {
      this.dispatch(name, ctx, this.master, VOLUME[name]);
    } catch {
      /* audio failure is never fatal */
    }
  }

  private dispatch(name: SoundName, ctx: AudioContext, out: GainNode, tier: number): void {
    const t = ctx.currentTime;
    switch (name) {
      case 'move':
        this.thock(ctx, out, t, 175, 0.55 * tier, 0.055);
        this.noise(ctx, out, t, 0.03, 0.1 * tier, 3200);
        break;
      case 'capture':
        this.thock(ctx, out, t, 118, 0.85 * tier, 0.08);
        this.noise(ctx, out, t, 0.055, 0.2 * tier, 1900);
        break;
      case 'castle':
        // Two pieces landing — the second is a touch softer and higher.
        this.thock(ctx, out, t, 160, 0.55 * tier, 0.05);
        this.thock(ctx, out, t + 0.085, 195, 0.42 * tier, 0.045);
        break;
      case 'check':
        this.thock(ctx, out, t, 150, 0.3 * tier, 0.05);
        this.tone(ctx, out, t, 660, 0.08, 0.11 * tier, 'sine');
        this.tone(ctx, out, t + 0.075, 880, 0.11, 0.1 * tier, 'sine');
        break;
      case 'checkmate':
        // Stage 1: the move lands. Stage 2 (after a breath): resolution.
        this.thock(ctx, out, t, 118, 0.6 * tier, 0.07);
        this.tone(ctx, out, t + 0.19, 392, 0.4, 0.13 * tier, 'sine');
        this.tone(ctx, out, t + 0.25, 311, 0.45, 0.13 * tier, 'sine');
        this.tone(ctx, out, t + 0.31, 233, 0.6, 0.15 * tier, 'sine');
        break;
      case 'illegal':
        this.thock(ctx, out, t, 92, 0.4 * tier, 0.04);
        break;
      case 'promotion':
        this.tone(ctx, out, t, 523, 0.1, 0.1 * tier, 'triangle');
        this.tone(ctx, out, t + 0.09, 784, 0.16, 0.1 * tier, 'triangle');
        break;
      case 'victory':
        this.tone(ctx, out, t, 392, 0.14, 0.1 * tier, 'sine');
        this.tone(ctx, out, t + 0.11, 523, 0.14, 0.1 * tier, 'sine');
        this.tone(ctx, out, t + 0.22, 659, 0.34, 0.11 * tier, 'sine');
        break;
      case 'defeat':
        this.tone(ctx, out, t, 330, 0.2, 0.09 * tier, 'sine');
        this.tone(ctx, out, t + 0.16, 220, 0.4, 0.09 * tier, 'sine');
        break;
      case 'draw':
        this.tone(ctx, out, t, 349, 0.42, 0.09 * tier, 'sine');
        break;
      case 'gameStart':
        this.tone(ctx, out, t, 392, 0.1, 0.08 * tier, 'sine');
        this.tone(ctx, out, t + 0.09, 523, 0.16, 0.08 * tier, 'sine');
        break;
      case 'wrong':
        this.tone(ctx, out, t, 233, 0.12, 0.12 * tier, 'triangle');
        this.tone(ctx, out, t + 0.09, 185, 0.16, 0.1 * tier, 'triangle');
        break;
      case 'solved':
        this.tone(ctx, out, t, 523, 0.12, 0.11 * tier, 'sine');
        this.tone(ctx, out, t + 0.1, 784, 0.22, 0.11 * tier, 'sine');
        break;
      case 'reveal':
        this.swell(ctx, out, t, 262, 0.22, 0.08 * tier);
        this.swell(ctx, out, t + 0.18, 392, 0.26, 0.09 * tier);
        this.swell(ctx, out, t + 0.36, 523, 0.4, 0.1 * tier);
        break;
      case 'notify':
        this.tone(ctx, out, t, 587, 0.09, 0.09 * tier, 'sine');
        this.tone(ctx, out, t + 0.08, 784, 0.12, 0.08 * tier, 'sine');
        break;
      case 'uiTick':
        this.tone(ctx, out, t, 1200, 0.025, 0.05 * tier, 'sine');
        break;
      default:
        break;
    }
  }

  /** Wooden "thock" — damped sine with pitch drop. */
  private thock(ctx: AudioContext, out: GainNode, t: number, freq: number, gain: number, decay: number): void {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(40, freq * 0.55), t + decay);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + decay + 0.03);
    osc.connect(g).connect(out);
    osc.start(t);
    osc.stop(t + decay + 0.05);
  }

  private tone(ctx: AudioContext, out: GainNode, t: number, freq: number, dur: number, gain: number, type: OscillatorType): void {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g).connect(out);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  /** Slow-attack tone — for reveals, not taps. */
  private swell(ctx: AudioContext, out: GainNode, t: number, freq: number, dur: number, gain: number): void {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + dur * 0.45);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g).connect(out);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  private noise(ctx: AudioContext, out: GainNode, t: number, dur: number, gain: number, cutoff: number): void {
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = cutoff;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(filter).connect(g).connect(out);
    src.start(t);
  }
}

/** Sound cue for a recorded move — castling is a double tap, promotion rises. */
export function moveSoundName(
  record: { capture: boolean; check: boolean; san?: string },
): 'move' | 'capture' | 'castle' | 'check' | 'promotion' {
  if (record.check) return 'check';
  if (record.san?.startsWith('O')) return 'castle';
  if (record.san?.includes('=')) return 'promotion';
  return record.capture ? 'capture' : 'move';
}

/**
 * End-of-game sound. Mate gets the two-stage resolution; decisive results are
 * heard from the local player's perspective; draws and resignations stay
 * subdued. Pass no `myColor` for shared-screen (pass & play) games.
 */
export function endSoundFor(
  end: { reason: string; winner: 'white' | 'black' | null } | null | undefined,
  myColor?: 'white' | 'black',
): SoundName {
  if (!end) return 'draw';
  if (end.reason === 'checkmate') return 'checkmate';
  if (end.winner === null) return 'draw';
  if (myColor === undefined) return end.reason === 'resign' || end.reason === 'disconnect' ? 'defeat' : 'victory';
  return end.winner === myColor ? 'victory' : 'defeat';
}


export const sound = new SoundEngine();
