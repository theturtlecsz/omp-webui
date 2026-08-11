import { useCallback, useEffect, useState } from 'react';
import { ArrowUp, FileText, Folder, Link2, Plus, RefreshCw } from 'lucide-react';
import { daemonClient } from '../lib/client';
import { FilePreviewDialog } from './FilePreviewDialog';
import type { AttachmentRange } from '../lib/attachments';

interface DirEntry { name: string; path: string; kind: 'file' | 'dir' | 'symlink'; size: number; modifiedMs: number }
interface Listing { path: string; entries: DirEntry[]; truncated: boolean }
interface FilePreview { path: string; content: string; truncated?: boolean; binary?: boolean; lineCount?: number }

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Navigable workspace file tree (one level at a time, dirs first). The daemon
 * watches the listed directory and pushes file.changed; we re-list on demand. */
export function FileTreePanel({ workspaceId, onAdd }: { workspaceId?: string; onAdd: (path: string, range?: AttachmentRange) => void }) {
  const [dir, setDir] = useState('');
  const [listing, setListing] = useState<Listing>();
  const [error, setError] = useState<string>();
  const [preview, setPreview] = useState<FilePreview>();

  const refresh = useCallback((target: string) => {
    if (!workspaceId) return;
    daemonClient.command<Listing>('file.list', { workspaceId, path: target })
      .then((value) => { setListing(value); setError(undefined); })
      .catch((err: Error) => setError(err.message));
  }, [workspaceId]);

  useEffect(() => { refresh(dir); }, [dir, refresh]);

  // Live refresh: the daemon's fs.watch fires when the visible dir changes.
  useEffect(() => {
    const unsubscribe = daemonClient.onEvent((e) => {
      if (e.type === 'file.changed') {
        const payload = (e.payload ?? {}) as { workspaceId?: string; path?: string };
        if (payload.workspaceId === workspaceId && payload.path === dir) refresh(dir);
      }
    });
    return () => { unsubscribe(); };
  }, [workspaceId, dir, refresh]);

  const open = (entry: DirEntry) => {
    if (entry.kind === 'dir') { setDir(entry.path); return; }
    daemonClient.command<FilePreview>('file.read', { workspaceId, path: entry.path })
      .then(setPreview)
      .catch(() => setPreview({ path: entry.path, content: 'Could not read this file.' }));
  };

  const parent = dir.includes('/') ? dir.slice(0, dir.lastIndexOf('/')) : '';

  return (
    <section className="panel" aria-label="Workspace files">
      <header><h2>Files</h2></header>
      {!workspaceId && <p className="empty-panel">Open a workspace to browse its files.</p>}
      {workspaceId && <>
        <nav className="file-tree__bar" aria-label="Current directory">
          <button className="icon-button" aria-label="Go to parent directory" disabled={!dir} onClick={() => setDir(parent)}><ArrowUp size={15} /></button>
          <code className="file-tree__cwd" aria-label="Directory path">{dir || '/'}</code>
          <button className="icon-button" aria-label="Refresh file list" onClick={() => refresh(dir)}><RefreshCw size={14} /></button>
        </nav>
        {error && <p role="alert" className="empty-panel">{error}</p>}
        <ul className="file-tree" aria-label="Directory contents">
          {(listing?.entries ?? []).map((entry) => (
            <li key={entry.path} className="file-preview__row">
              <button className="file-preview__entry" onClick={() => open(entry)}>
                {entry.kind === 'dir' ? <Folder size={15} /> : entry.kind === 'symlink' ? <Link2 size={15} /> : <FileText size={15} />}
                <code>{entry.name}</code>
                <span>{entry.kind === 'dir' ? 'Open folder' : `${fmtSize(entry.size)} · preview`}</span>
              </button>
              <button type="button" className="icon-button" aria-label={`Add ${entry.path} to conversation`} title="Add file to conversation" onClick={() => onAdd(entry.path)}><Plus size={16} /></button>
            </li>
          ))}
        </ul>
        {listing?.truncated && <p className="empty-panel">Showing first 500 entries.</p>}
        {listing && listing.entries.length === 0 && <p className="empty-panel">Empty directory.</p>}
      </>}
      {preview && <FilePreviewDialog preview={preview} onClose={() => setPreview(undefined)} onAdd={(range) => { onAdd(preview.path, range); setPreview(undefined); }} />}
    </section>
  );
}
