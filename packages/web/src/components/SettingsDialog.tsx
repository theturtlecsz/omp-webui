/**
 * SettingsDialog — language, sounds, and attachment reference-mode in one place.
 * Mirrors pi-web-ui's settings surface (which uses a right-hand drawer);
 * we use a modal dialog to stay consistent with our other dialogs.
 */
import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { SUPPORTED_LANGS, translate, useT, type Lang } from '../lib/i18n';
import { useAttachmentSettings, useSoundSettings } from '../lib/settings';
import { play, primeAudio, SOUND_EVENTS, type SoundEvent } from '../lib/sound';
import { useFocusTrap } from './dialog-utils';

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const { lang, setLang, t } = useT();
  const [sound, setSound] = useSoundSettings();
  const [attachments, setAttachments] = useAttachmentSettings();
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, onClose);

  // Prime audio on first interaction with any button inside the dialog.
  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    const prime = () => { void primeAudio(); };
    el.addEventListener('click', prime, { once: true });
    return () => el.removeEventListener('click', prime);
  }, []);

  const testSound = (event: SoundEvent) => {
    void primeAudio().then(() => play(event, { ...sound, enabled: true, perEvent: { ...sound.perEvent, [event]: true } }));
  };

  return <div className="modal-backdrop" role="presentation" onClick={onClose}>
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-title"
      className="modal modal--wide settings-dialog"
      onClick={(event) => event.stopPropagation()}
    >
      <header className="settings-dialog__header">
        <h2 id="settings-title">{t('settings.title')}</h2>
        <button type="button" className="icon-button" aria-label={t('settings.close')} onClick={onClose}><X size={16} /></button>
      </header>

      <section className="settings-section" aria-labelledby="settings-language-heading">
        <h3 id="settings-language-heading">{t('settings.language')}</h3>
        <div role="radiogroup" aria-labelledby="settings-language-heading" className="settings-lang-group">
          {SUPPORTED_LANGS.map((option) => (
            <label key={option} className={`settings-radio${lang === option ? ' settings-radio--active' : ''}`}>
              <input
                type="radio"
                name="omp-webui-lang"
                value={option}
                checked={lang === option}
                onChange={() => setLang(option as Lang)}
              />
              <span>{translate(option, `lang.name.${option}`)}</span>
            </label>
          ))}
        </div>
      </section>

      <section className="settings-section" aria-labelledby="settings-sound-heading">
        <h3 id="settings-sound-heading">{t('settings.sound.title')}</h3>
        <label className="settings-toggle">
          <input
            type="checkbox"
            checked={sound.enabled}
            onChange={(event) => setSound({ ...sound, enabled: event.target.checked })}
          />
          <span>{t('settings.sound.enable')}</span>
        </label>
        <label className="settings-range">
          <span>{t('settings.sound.volume')}</span>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={sound.volume}
            disabled={!sound.enabled}
            onChange={(event) => setSound({ ...sound, volume: Number(event.target.value) })}
            aria-label={t('settings.sound.volume')}
          />
          <output>{sound.volume}</output>
        </label>
        <ul className="settings-sound-list">
          {SOUND_EVENTS.map((event) => (
            <li key={event}>
              <label className="settings-toggle settings-toggle--compact">
                <input
                  type="checkbox"
                  checked={sound.perEvent[event]}
                  disabled={!sound.enabled}
                  onChange={(change) => setSound({ ...sound, perEvent: { ...sound.perEvent, [event]: change.target.checked } })}
                />
                <span>{t(`settings.sound.event.${event}`)}</span>
              </label>
              <button
                type="button"
                className="button button--quiet"
                disabled={!sound.enabled || !sound.perEvent[event]}
                onClick={() => testSound(event)}
              >{t('settings.sound.test')}</button>
            </li>
          ))}
        </ul>
      </section>

      <section className="settings-section" aria-labelledby="settings-attachments-heading">
        <h3 id="settings-attachments-heading">{t('settings.attachments.title')}</h3>
        <label className="settings-toggle">
          <input
            type="checkbox"
            checked={attachments.referenceMode}
            onChange={(event) => setAttachments({ ...attachments, referenceMode: event.target.checked })}
          />
          <span>{t('settings.attachments.referenceMode')}</span>
        </label>
        <p className="settings-help">{t('settings.attachments.referenceModeHelp')}</p>
      </section>

      <footer className="modal__actions">
        <button type="button" className="button button--primary" onClick={onClose}>{t('settings.close')}</button>
      </footer>
    </div>
  </div>;
}
