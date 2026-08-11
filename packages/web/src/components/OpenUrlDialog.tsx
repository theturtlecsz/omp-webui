import { useRef, useState } from 'react';
import { Copy, ExternalLink } from 'lucide-react';
import type { ExtensionOpenUrl } from '../lib/types';
import { useFocusTrap } from './dialog-utils';

type Props = { request: ExtensionOpenUrl; onDismiss: () => void };

/**
 * Renders `extension_ui_request { method: "open_url", url, launchUrl?, instructions? }`
 * from omp. This is used by omp's OAuth login flows: the user must open the
 * link in a browser to complete authentication.
 *
 * omp's schema documents `launchUrl` as the short loopback URL that redirects
 * to `url`, and RECOMMENDS surfacing the loopback as the copy target because
 * terminal viewports may truncate long URLs. We honour that in the web UI too:
 * the copy button copies launchUrl when present, and the anchor still opens
 * the full url in a new tab.
 */
export function OpenUrlDialog({ request, onDismiss }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);
  useFocusTrap(ref, onDismiss, onDismiss);
  const copyTarget = request.launchUrl && request.launchUrl.length > 0 ? request.launchUrl : request.url;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(copyTarget);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard blocked (older browsers or insecure contexts); fall back to selection.
      const range = document.createRange();
      const anchor = ref.current?.querySelector('a[data-open-url]');
      if (anchor) {
        range.selectNodeContents(anchor);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
    }
  };

  return (
    <div className="modal-backdrop">
      <div className="modal" ref={ref} role="dialog" aria-modal="true" aria-labelledby="open-url-title">
        <h2 id="open-url-title">Open link to continue</h2>
        {request.instructions ? <p>{request.instructions}</p> : <p>OMP is asking you to open a link (usually to complete a sign-in).</p>}
        <a data-open-url href={request.url} target="_blank" rel="noreferrer noopener" className="open-url__link">
          <ExternalLink size={14} aria-hidden /><span>{request.url}</span>
        </a>
        <div className="modal__actions">
          <button className="button button--quiet" onClick={copy}>
            <Copy size={14} aria-hidden />{copied ? ' Copied' : ' Copy link'}
          </button>
          <button className="button button--primary" onClick={onDismiss}>Done</button>
        </div>
      </div>
    </div>
  );
}
