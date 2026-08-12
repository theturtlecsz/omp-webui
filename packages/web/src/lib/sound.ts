/**
 * WebAudio sound effects — modeled on pi-web-ui: no audio files, all synthesized
 * via AudioContext + OscillatorNode + GainNode with envelope.
 *
 * Four events keyed to omp lifecycle:
 *   - `question` : extension asks the user something (approval/question/input)
 *   - `done`     : turn completes
 *   - `error`    : turn fails or a notify(error) arrives
 *   - `start`    : (opt-in) turn starts
 *
 * Settings are persisted under `omp-webui.sound` (JSON) and `omp-webui.enableSound`.
 * The AudioContext is lazily constructed and resumed on first user gesture
 * (browsers block autoplay until then). Server/test environments without
 * AudioContext get a no-op backend.
 */

export type SoundEvent = 'question' | 'done' | 'error' | 'start';

export const SOUND_EVENTS: readonly SoundEvent[] = ['question', 'done', 'error', 'start'];

export type SoundConfig = {
  type: OscillatorType;
  /** peak volume 0..1 (multiplied by global volume) */
  peak: number;
  /** ordered tones: [frequencyHz, delayMs, durationMs] */
  tones: readonly [number, number, number][];
};

/** Defaults tuned to be short, distinct, not annoying. */
export const DEFAULT_CONFIG: Record<SoundEvent, SoundConfig> = {
  question: { type: 'sine',     peak: 0.35, tones: [[880, 0, 80], [1175, 80, 80]] },
  done:     { type: 'triangle', peak: 0.35, tones: [[523, 0, 60], [659, 60, 60], [784, 120, 100]] },
  error:    { type: 'square',   peak: 0.30, tones: [[220, 0, 90], [180, 100, 140]] },
  start:    { type: 'sine',     peak: 0.25, tones: [[440, 0, 60]] },
};

export type SoundSettings = {
  enabled: boolean;
  /** 0..100 stepped in 5 */
  volume: number;
  perEvent: Record<SoundEvent, boolean>;
};

const STORAGE_ENABLED = 'omp-webui.enableSound';
const STORAGE_SETTINGS = 'omp-webui.sound';

export const DEFAULT_SETTINGS: SoundSettings = {
  enabled: false,
  volume: 40,
  perEvent: { question: true, done: true, error: true, start: false },
};

function coerceSettings(raw: unknown): SoundSettings {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_SETTINGS };
  const r = raw as Partial<SoundSettings>;
  const volumeRaw = typeof r.volume === 'number' && Number.isFinite(r.volume) ? r.volume : DEFAULT_SETTINGS.volume;
  const volume = Math.max(0, Math.min(100, Math.round(volumeRaw / 5) * 5));
  const perEventIn = r.perEvent && typeof r.perEvent === 'object' ? r.perEvent as Partial<Record<SoundEvent, unknown>> : {};
  const perEvent = { ...DEFAULT_SETTINGS.perEvent };
  for (const key of SOUND_EVENTS) {
    if (typeof perEventIn[key] === 'boolean') perEvent[key] = perEventIn[key] as boolean;
  }
  return {
    enabled: typeof r.enabled === 'boolean' ? r.enabled : DEFAULT_SETTINGS.enabled,
    volume,
    perEvent,
  };
}

export function loadSettings(): SoundSettings {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_SETTINGS);
    const parsed = raw ? JSON.parse(raw) : undefined;
    const settings = coerceSettings(parsed);
    // legacy per-boolean gate
    try {
      const legacy = globalThis.localStorage?.getItem(STORAGE_ENABLED);
      if (legacy != null) settings.enabled = legacy === 'true' || legacy === '1';
    } catch { /* ignore */ }
    return settings;
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: SoundSettings): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_SETTINGS, JSON.stringify(settings));
    globalThis.localStorage?.setItem(STORAGE_ENABLED, settings.enabled ? 'true' : 'false');
  } catch { /* ignore */ }
}

/** Minimal AudioContext surface we depend on. */
type AudioCtxLike = {
  currentTime: number;
  destination: unknown;
  state: string;
  resume(): Promise<void>;
  createOscillator(): OscillatorLike;
  createGain(): GainLike;
};
type OscillatorLike = { type: OscillatorType; frequency: { value: number }; connect(dst: unknown): void; start(t?: number): void; stop(t?: number): void; onended?: (() => void) | null };
type GainLike = { gain: { value: number; setValueAtTime(v: number, t: number): void; linearRampToValueAtTime(v: number, t: number): void; exponentialRampToValueAtTime(v: number, t: number): void }; connect(dst: unknown): void; disconnect(): void };

type PlayEnv = {
  ctx: AudioCtxLike | null;
  primed: boolean;
};

const env: PlayEnv = { ctx: null, primed: false };

function makeCtx(): AudioCtxLike | null {
  const AC = (globalThis as { AudioContext?: unknown; webkitAudioContext?: unknown }).AudioContext
    ?? (globalThis as { AudioContext?: unknown; webkitAudioContext?: unknown }).webkitAudioContext;
  if (typeof AC !== 'function') return null;
  try { return new (AC as { new (): AudioCtxLike })(); } catch { return null; }
}

/** Must be called from a user gesture (click/keydown). Safe to call repeatedly. */
export async function primeAudio(): Promise<void> {
  if (!env.ctx) env.ctx = makeCtx();
  if (env.ctx && env.ctx.state !== 'running') {
    try { await env.ctx.resume(); } catch { /* ignore */ }
  }
  env.primed = true;
}

/** Test-only reset. */
export function __resetAudioForTest(injected?: AudioCtxLike | null): void {
  env.ctx = injected ?? null;
  env.primed = injected != null;
}

/** Play a specific event now, honouring settings. Returns true if a sound was scheduled. */
export function play(event: SoundEvent, settings: SoundSettings, cfg: SoundConfig = DEFAULT_CONFIG[event]): boolean {
  if (!settings.enabled || settings.volume <= 0 || !settings.perEvent[event]) return false;
  const ctx = env.ctx ?? (env.ctx = makeCtx());
  if (!ctx) return false;
  const globalGain = Math.max(0, Math.min(1, settings.volume / 100));
  const now = ctx.currentTime;
  for (const [freq, delayMs, durMs] of cfg.tones) {
    const start = now + delayMs / 1000;
    const end = start + durMs / 1000;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = cfg.type;
    osc.frequency.value = freq;
    const peak = Math.max(0, Math.min(1, cfg.peak * globalGain));
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), start + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, end);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(start);
    osc.stop(end + 0.02);
    osc.onended = () => { try { gain.disconnect(); } catch { /* ignore */ } };
  }
  return true;
}
