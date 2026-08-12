/**
 * Minimal i18n scaffold — modeled on pi-web-ui's approach:
 * a keyed dictionary per language, a Context provider that persists the
 * selected language to localStorage under `omp-webui.lang` and syncs
 * document.documentElement.lang, and a `useT()` hook returning a `t(key, vars?)`
 * function.
 *
 * Coverage note: pi-web-ui translates shell/settings/dialogs but leaves
 * conversation content and command output untranslated (those are the model's
 * output). We follow the same convention. Every key added below MUST have an
 * entry in every language; missing keys fall back to the key literal so tests
 * catch drift.
 */
import { createContext, createElement, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

export type Lang = 'en' | 'zh';

export const SUPPORTED_LANGS: readonly Lang[] = ['en', 'zh'];

const STORAGE_KEY = 'omp-webui.lang';

type Dict = Record<string, string>;

const en: Dict = {
  'lang.name.en': 'English',
  'lang.name.zh': '中文',
  'settings.title': 'Settings',
  'settings.language': 'Language',
  'settings.sound.title': 'Sounds',
  'settings.sound.enable': 'Enable sound effects',
  'settings.sound.volume': 'Volume',
  'settings.sound.test': 'Test',
  'settings.sound.event.question': 'Question prompt',
  'settings.sound.event.done': 'Turn complete',
  'settings.sound.event.error': 'Error',
  'settings.sound.event.start': 'Turn start',
  'settings.attachments.title': 'Attachments',
  'settings.attachments.referenceMode': 'Send files as references (path only)',
  'settings.attachments.referenceModeHelp': 'Instead of inlining file contents, send the workspace path so omp reads it directly. Useful for large files.',
  'settings.close': 'Close',
  'settings.open': 'Settings',
  'composer.attach.reference': 'Reference (path only)',
  'composer.attach.inline': 'Inline (send contents)',
  'attachment.badge.reference': 'ref',
  'attachment.badge.inline': 'inline',
};

const zh: Dict = {
  'lang.name.en': 'English',
  'lang.name.zh': '中文',
  'settings.title': '设置',
  'settings.language': '语言',
  'settings.sound.title': '声音',
  'settings.sound.enable': '启用音效',
  'settings.sound.volume': '音量',
  'settings.sound.test': '试听',
  'settings.sound.event.question': '提问提示',
  'settings.sound.event.done': '完成',
  'settings.sound.event.error': '错误',
  'settings.sound.event.start': '开始',
  'settings.attachments.title': '附件',
  'settings.attachments.referenceMode': '以引用方式发送文件（仅路径）',
  'settings.attachments.referenceModeHelp': '不将文件内容内联发送，只发送工作区路径，让 omp 直接读取。适合大文件。',
  'settings.close': '关闭',
  'settings.open': '设置',
  'composer.attach.reference': '引用（仅路径）',
  'composer.attach.inline': '内联（发送内容）',
  'attachment.badge.reference': '引用',
  'attachment.badge.inline': '内联',
};

const DICTS: Record<Lang, Dict> = { en, zh };

/** All keys present in every dictionary — used by tests and dev warnings. */
export const KNOWN_KEYS = Object.freeze(Object.keys(en) as readonly string[]);

export function detectDefaultLang(): Lang {
  if (typeof globalThis === 'undefined') return 'en';
  try {
    const stored = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (stored && (SUPPORTED_LANGS as readonly string[]).includes(stored)) return stored as Lang;
  } catch {
    /* localStorage may throw in privacy modes */
  }
  const nav = (globalThis as { navigator?: { language?: string } }).navigator;
  const tag = nav?.language?.toLowerCase() ?? '';
  if (tag.startsWith('zh')) return 'zh';
  return 'en';
}

/** Substitute {name} placeholders. Missing vars are left as `{name}` so tests spot them. */
function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, name: string) => (name in vars ? String(vars[name]) : `{${name}}`));
}

/** Pure translation — used by tests and non-hook callers. Returns key literal on miss. */
export function translate(lang: Lang, key: string, vars?: Record<string, string | number>): string {
  const dict = DICTS[lang] ?? DICTS.en;
  const value = dict[key] ?? DICTS.en[key];
  if (value === undefined) return key;
  return interpolate(value, vars);
}

type LangCtx = {
  lang: Lang;
  setLang: (next: Lang) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
};

const LanguageContext = createContext<LangCtx | undefined>(undefined);

/** Provider — syncs document.documentElement.lang and persists to localStorage. */
export function LanguageProvider({ children, initial }: { children: ReactNode; initial?: Lang }) {
  const [lang, setLangState] = useState<Lang>(initial ?? detectDefaultLang());

  useEffect(() => {
    if (typeof document !== 'undefined' && document.documentElement) {
      document.documentElement.lang = lang;
    }
    try { globalThis.localStorage?.setItem(STORAGE_KEY, lang); } catch { /* ignore */ }
  }, [lang]);

  const setLang = useCallback((next: Lang) => {
    if (!(SUPPORTED_LANGS as readonly string[]).includes(next)) return;
    setLangState(next);
  }, []);

  const t = useCallback(
    (key: string, vars?: Record<string, string | number>) => translate(lang, key, vars),
    [lang],
  );

  return createElement(LanguageContext.Provider, { value: { lang, setLang, t } }, children);
}

export function useT(): LangCtx {
  const ctx = useContext(LanguageContext);
  if (!ctx) {
    // Test-friendly fallback: outside a provider, callers still get English.
    return { lang: 'en', setLang: () => {}, t: (key, vars) => translate('en', key, vars) };
  }
  return ctx;
}

/** Test/CLI helper. */
export const __DICTS = DICTS;
