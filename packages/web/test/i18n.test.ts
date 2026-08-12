import { describe, expect, it, afterEach } from 'vitest';
import { detectDefaultLang, KNOWN_KEYS, SUPPORTED_LANGS, translate, __DICTS } from '../src/lib/i18n';

afterEach(() => {
  try { globalThis.localStorage?.removeItem('omp-webui.lang'); } catch { /* ignore */ }
});

describe('i18n dictionaries', () => {
  it('every language has an entry for every known key', () => {
    for (const lang of SUPPORTED_LANGS) {
      const dict = __DICTS[lang];
      const missing = KNOWN_KEYS.filter((key) => !(key in dict));
      expect(missing, `missing keys in ${lang}`).toEqual([]);
    }
  });

  it('translate falls back to English for unknown language and to the key literal for unknown key', () => {
    // Cast around Lang type: SUPPORTED_LANGS is the canonical list; here we
    // deliberately probe the fallback contract with an out-of-range value.
    const enValue = translate('en', 'settings.title');
    expect(translate('zz' as unknown as (typeof SUPPORTED_LANGS)[number], 'settings.title')).toBe(enValue);
    expect(translate('en', 'nope.no.such.key')).toBe('nope.no.such.key');
  });

  it('interpolates {var} placeholders and leaves missing vars intact', () => {
    const src = 'Hello, {name}! You have {count} items.';
    // Test via the public API by adding a fake dict entry only in memory.
    (__DICTS.en as Record<string, string>).__test_interp = src;
    expect(translate('en', '__test_interp', { name: 'Ada', count: 3 })).toBe('Hello, Ada! You have 3 items.');
    expect(translate('en', '__test_interp', { name: 'Ada' })).toBe('Hello, Ada! You have {count} items.');
    delete (__DICTS.en as Record<string, string>).__test_interp;
  });

  it('detectDefaultLang honours stored lang first, then navigator.language, then falls back to en', () => {
    try { globalThis.localStorage?.setItem('omp-webui.lang', 'zh'); } catch { /* ignore */ }
    expect(detectDefaultLang()).toBe('zh');
    try { globalThis.localStorage?.removeItem('omp-webui.lang'); } catch { /* ignore */ }
    // Navigator.language is 'en-US' in jsdom by default → 'en'
    expect(detectDefaultLang()).toBe('en');
  });
});
