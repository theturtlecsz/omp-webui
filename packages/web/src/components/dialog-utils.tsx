import { useEffect, useRef, useState } from 'react';

const focusableSelector = 'button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export function useFocusTrap(ref: React.RefObject<HTMLDivElement | null>, onCancel: () => void, onConfirm?: () => void) {
  const onCancelRef = useRef(onCancel);
  const onConfirmRef = useRef(onConfirm);
  onCancelRef.current = onCancel;
  onConfirmRef.current = onConfirm;

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const previous = document.activeElement as HTMLElement | null;
    const focusables = () => [...node.querySelectorAll<HTMLElement>(focusableSelector)];
    focusables()[0]?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onCancelRef.current();
      }
      if (event.key === 'Enter' && onConfirmRef.current && !(event.target instanceof HTMLTextAreaElement)) {
        event.preventDefault();
        onConfirmRef.current();
      }
      if (event.key === 'Tab') {
        const items = focusables();
        if (!items.length) return;
        const current = items.indexOf(document.activeElement as HTMLElement);
        event.preventDefault();
        items[(current + (event.shiftKey ? -1 : 1) + items.length) % items.length].focus();
      }
    };
    node.addEventListener('keydown', key);
    return () => {
      node.removeEventListener('keydown', key);
      previous?.focus();
    };
  }, [ref]);
}

export function useOverlayFocus(ref: React.RefObject<HTMLElement | null>, open: boolean, onClose: () => void, maxWidth = 1280) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const node = ref.current;
    if (!open || !node || window.innerWidth > maxWidth) return;
    const previous = document.activeElement as HTMLElement | null;
    const focusables = () => [...node.querySelectorAll<HTMLElement>(focusableSelector)];
    focusables()[0]?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusables();
      if (!items.length) return;
      const current = items.indexOf(document.activeElement as HTMLElement);
      event.preventDefault();
      items[(current + (event.shiftKey ? -1 : 1) + items.length) % items.length].focus();
    };
    node.addEventListener('keydown', key);
    return () => {
      node.removeEventListener('keydown', key);
      previous?.focus();
    };
  }, [ref, open, maxWidth]);
}

export function TimeoutCountdown({ timeout }: { timeout: unknown }) {
  const raw = typeof timeout === 'number' ? timeout : Number(timeout);
  const [remaining, setRemaining] = useState(() => Number.isFinite(raw) ? (raw > Date.now() ? raw - Date.now() : raw) : null);
  useEffect(() => {
    if (remaining === null) return;
    const timer = setInterval(() => setRemaining((value) => value === null ? null : Math.max(0, value - 1000)), 1000);
    return () => clearInterval(timer);
  }, [remaining]);
  if (remaining === null) return null;
  return <p className="timeout-countdown" aria-live="polite">Decision timeout: {Math.ceil(remaining / 1000)} seconds remaining</p>;
}
