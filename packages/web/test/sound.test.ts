import { describe, expect, it, beforeEach } from 'vitest';
import { DEFAULT_CONFIG, DEFAULT_SETTINGS, loadSettings, play, saveSettings, __resetAudioForTest, type SoundSettings } from '../src/lib/sound';

type ScheduledOsc = { type: string; freq: number; startedAt: number; stoppedAt: number };

function makeFakeCtx(): { ctx: unknown; scheduled: ScheduledOsc[] } {
  const scheduled: ScheduledOsc[] = [];
  const destination = {};
  const currentTime = 100;
  const ctx = {
    currentTime,
    destination,
    state: 'running',
    resume: () => Promise.resolve(),
    createOscillator() {
      const state: ScheduledOsc = { type: 'sine', freq: 0, startedAt: 0, stoppedAt: 0 };
      scheduled.push(state);
      return {
        set type(v: string) { state.type = v; },
        get type() { return state.type; },
        frequency: { set value(v: number) { state.freq = v; }, get value() { return state.freq; } },
        connect() {},
        start(t: number) { state.startedAt = t; },
        stop(t: number) { state.stoppedAt = t; },
        onended: null,
      };
    },
    createGain() {
      return {
        gain: {
          value: 0,
          setValueAtTime() {},
          linearRampToValueAtTime() {},
          exponentialRampToValueAtTime() {},
        },
        connect() {},
        disconnect() {},
      };
    },
  };
  return { ctx, scheduled };
}

beforeEach(() => {
  try { globalThis.localStorage?.clear(); } catch { /* ignore */ }
});

describe('sound settings', () => {
  it('loadSettings returns defaults when nothing is stored', () => {
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('saveSettings round-trips and clamps volume to nearest 5', () => {
    saveSettings({ ...DEFAULT_SETTINGS, enabled: true, volume: 47, perEvent: { question: false, done: true, error: true, start: false } });
    const round = loadSettings();
    expect(round.enabled).toBe(true);
    expect(round.volume).toBe(45); // 47 -> 45
    expect(round.perEvent.question).toBe(false);
    expect(round.perEvent.done).toBe(true);
  });

  it('legacy per-boolean enableSound key overrides the JSON blob for backwards compatibility', () => {
    saveSettings({ ...DEFAULT_SETTINGS, enabled: false });
    globalThis.localStorage?.setItem('omp-webui.enableSound', 'true');
    expect(loadSettings().enabled).toBe(true);
  });
});

describe('sound.play()', () => {
  it('does nothing when disabled', () => {
    const { ctx, scheduled } = makeFakeCtx();
    __resetAudioForTest(ctx as never);
    const s: SoundSettings = { ...DEFAULT_SETTINGS, enabled: false, perEvent: { question: true, done: true, error: true, start: true } };
    expect(play('question', s)).toBe(false);
    expect(scheduled).toHaveLength(0);
    __resetAudioForTest(null);
  });

  it('does nothing when the specific event is muted', () => {
    const { ctx, scheduled } = makeFakeCtx();
    __resetAudioForTest(ctx as never);
    const s: SoundSettings = { ...DEFAULT_SETTINGS, enabled: true, volume: 50, perEvent: { question: false, done: true, error: true, start: true } };
    expect(play('question', s)).toBe(false);
    expect(scheduled).toHaveLength(0);
    __resetAudioForTest(null);
  });

  it('schedules one oscillator per tone with the configured type and frequency', () => {
    const { ctx, scheduled } = makeFakeCtx();
    __resetAudioForTest(ctx as never);
    const s: SoundSettings = { ...DEFAULT_SETTINGS, enabled: true, volume: 60, perEvent: { question: true, done: true, error: true, start: true } };
    expect(play('done', s)).toBe(true);
    expect(scheduled).toHaveLength(DEFAULT_CONFIG.done.tones.length);
    expect(scheduled[0].type).toBe(DEFAULT_CONFIG.done.type);
    expect(scheduled[0].freq).toBe(DEFAULT_CONFIG.done.tones[0][0]);
    // Second tone starts strictly after the first
    expect(scheduled[1].startedAt).toBeGreaterThan(scheduled[0].startedAt);
    __resetAudioForTest(null);
  });

  it('does nothing gracefully when AudioContext is unavailable', () => {
    __resetAudioForTest(null);
    const s: SoundSettings = { ...DEFAULT_SETTINGS, enabled: true, volume: 100, perEvent: { question: true, done: true, error: true, start: true } };
    // No fake ctx was installed and makeCtx() returns null (jsdom).
    expect(play('done', s)).toBe(false);
  });
});
