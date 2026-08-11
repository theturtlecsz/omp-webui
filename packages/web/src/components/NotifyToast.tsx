import { useEffect } from 'react';
import { AlertTriangle, CircleAlert, Info, X } from 'lucide-react';
import type { ExtensionNotification } from '../lib/types';

type Props = { notifications: ExtensionNotification[]; onDismiss: (id: string) => void };

const ICONS: Record<ExtensionNotification['notifyType'], typeof Info> = {
  info: Info,
  warning: AlertTriangle,
  error: CircleAlert,
};

/**
 * Renders `extension_ui_request { method: "notify" }` frames from omp.
 * Toasts are keyed by request id (see reducer) so repeated notifies for the
 * same id refresh the message instead of stacking. Individual toasts are
 * dismissable and auto-expire after 6 seconds for info, 10 for warning,
 * indefinite for error (user must acknowledge).
 */
export function NotifyToast({ notifications, onDismiss }: Props) {
  useEffect(() => {
    if (!notifications.length) return;
    const timers = notifications
      .filter((toast) => toast.notifyType !== 'error')
      .map((toast) => {
        const delay = toast.notifyType === 'warning' ? 10_000 : 6_000;
        return window.setTimeout(() => onDismiss(toast.id), delay);
      });
    return () => { timers.forEach((timer) => window.clearTimeout(timer)); };
  }, [notifications, onDismiss]);

  if (!notifications.length) return null;
  return (
    <div className="notify-toast-stack" role="region" aria-label="OMP notifications" aria-live="polite">
      {notifications.map((toast) => {
        const Icon = ICONS[toast.notifyType] ?? Info;
        return (
          <div key={toast.id} className={`notify-toast notify-toast--${toast.notifyType}`} role="status">
            <Icon size={16} aria-hidden />
            <span className="notify-toast__message">{toast.message}</span>
            <button
              type="button"
              className="notify-toast__dismiss"
              aria-label="Dismiss notification"
              onClick={() => onDismiss(toast.id)}
            ><X size={14} aria-hidden /></button>
          </div>
        );
      })}
    </div>
  );
}
