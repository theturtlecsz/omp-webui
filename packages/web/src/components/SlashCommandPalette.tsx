import { useEffect, useMemo, useRef, useState } from 'react';
import type { SlashCommand, SlashSubcommand } from '../lib/types';

type Props = {
  open: boolean;
  commands: SlashCommand[];
  initialQuery?: string;
  onSelect: (text: string) => void;
  onClose: () => void;
};

type Row =
  | { kind: 'command'; command: SlashCommand; matchScore: number; matchIndex: number }
  | { kind: 'subcommand'; command: SlashCommand; sub: SlashSubcommand; matchScore: number; matchIndex: number };

/** Cheap non-fancy scorer: substring match on command name gets a low index score;
 *  aliases and descriptions match with a penalty. Lower score = better rank. */
function scoreCommand(command: SlashCommand, query: string): number {
  if (!query) return 0;
  const q = query.toLowerCase();
  const name = command.name.toLowerCase();
  if (name === q) return -1;
  if (name.startsWith(q)) return 0;
  const nameHit = name.indexOf(q);
  if (nameHit >= 0) return nameHit;
  for (const alias of command.aliases ?? []) {
    const aliasHit = alias.toLowerCase().indexOf(q);
    if (aliasHit >= 0) return 100 + aliasHit;
  }
  const description = (command.description ?? '').toLowerCase();
  const descriptionHit = description.indexOf(q);
  if (descriptionHit >= 0) return 200 + descriptionHit;
  return Number.POSITIVE_INFINITY;
}

function rowsForCommands(commands: SlashCommand[], query: string, expanded?: string): Row[] {
  const q = query.toLowerCase();
  const seen = new Set<string>();
  const rows: Row[] = [];
  commands.forEach((command, index) => {
    if (seen.has(command.name)) return;
    seen.add(command.name);
    const score = scoreCommand(command, q);
    if (Number.isFinite(score)) {
      rows.push({ kind: 'command', command, matchScore: score, matchIndex: index });
      if (expanded === command.name) {
        (command.subcommands ?? []).forEach((sub, subIndex) => {
          rows.push({ kind: 'subcommand', command, sub, matchScore: score, matchIndex: index * 100 + subIndex + 1 });
        });
      }
    } else if (command.subcommands?.some((sub) => sub.name.toLowerCase().includes(q) || (sub.description ?? '').toLowerCase().includes(q))) {
      rows.push({ kind: 'command', command, matchScore: 300, matchIndex: index });
      command.subcommands
        .filter((sub) => sub.name.toLowerCase().includes(q) || (sub.description ?? '').toLowerCase().includes(q))
        .forEach((sub, subIndex) => rows.push({ kind: 'subcommand', command, sub, matchScore: 300, matchIndex: index * 100 + subIndex + 1 }));
    }
  });
  rows.sort((a, b) => a.matchScore - b.matchScore || a.matchIndex - b.matchIndex);
  return rows;
}

export function SlashCommandPalette({ open, commands, initialQuery = '', onSelect, onClose }: Props) {
  const [query, setQuery] = useState(initialQuery);
  const [cursor, setCursor] = useState(0);
  const [expanded, setExpanded] = useState<string | undefined>();
  const listRef = useRef<HTMLUListElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (open) { setQuery(initialQuery); setCursor(0); setExpanded(undefined); } }, [open, initialQuery]);
  useEffect(() => { if (open) queueMicrotask(() => inputRef.current?.focus()); }, [open]);

  const rows = useMemo(() => rowsForCommands(commands, query, expanded), [commands, query, expanded]);
  useEffect(() => { if (cursor >= rows.length) setCursor(Math.max(0, rows.length - 1)); }, [rows, cursor]);
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLLIElement>(`[data-row="${cursor}"]`);
    if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  if (!open) return null;

  const choose = (row: Row) => {
    if (row.kind === 'command') {
      // If command has subcommands and user hasn't expanded, expand instead of submit.
      if (row.command.subcommands && row.command.subcommands.length > 0 && expanded !== row.command.name) {
        setExpanded(row.command.name);
        return;
      }
      onSelect(`/${row.command.name}`);
    } else {
      onSelect(`/${row.command.name} ${row.sub.name}`);
    }
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') { event.preventDefault(); setCursor((c) => Math.min(rows.length - 1, c + 1)); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setCursor((c) => Math.max(0, c - 1)); }
    else if (event.key === 'Enter') { event.preventDefault(); const row = rows[cursor]; if (row) choose(row); }
    else if (event.key === 'Escape') { event.preventDefault(); if (expanded) setExpanded(undefined); else onClose(); }
    else if (event.key === 'ArrowLeft' && expanded) { event.preventDefault(); setExpanded(undefined); }
    else if (event.key === 'ArrowRight' && rows[cursor]?.kind === 'command' && rows[cursor].command.subcommands?.length) {
      event.preventDefault(); setExpanded(rows[cursor].command.name);
    }
  };

  return (
    <div className="slash-palette-backdrop" role="presentation" onClick={onClose}>
      <div className="slash-palette" role="dialog" aria-label="Slash command palette" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="slash-palette__input"
          type="text"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setCursor(0); }}
          onKeyDown={onKeyDown}
          placeholder="Filter slash commands…"
          aria-label="Filter slash commands"
          aria-autocomplete="list"
          aria-controls="slash-palette-list"
          aria-activedescendant={rows[cursor] ? `slash-row-${cursor}` : undefined}
        />
        {rows.length === 0 ? (
          <p className="slash-palette__empty">No matching commands.</p>
        ) : (
          <ul id="slash-palette-list" ref={listRef} role="listbox" className="slash-palette__list">
            {rows.map((row, index) => (
              <li
                key={row.kind === 'command' ? `cmd-${row.command.name}` : `sub-${row.command.name}-${row.sub.name}`}
                id={`slash-row-${index}`}
                data-row={index}
                role="option"
                aria-selected={index === cursor}
                className={`slash-palette__row ${index === cursor ? 'is-active' : ''} ${row.kind === 'subcommand' ? 'is-sub' : ''}`}
                onMouseEnter={() => setCursor(index)}
                onClick={() => choose(row)}
              >
                <span className="slash-palette__name">
                  {row.kind === 'command'
                    ? <>/{row.command.name}{row.command.input?.hint ? <em className="slash-palette__hint"> {row.command.input.hint}</em> : null}</>
                    : <>↳ {row.sub.name}</>}
                </span>
                <span className="slash-palette__desc">{row.kind === 'command' ? row.command.description : row.sub.description}</span>
                {row.kind === 'command' && row.command.source && row.command.source !== 'builtin' && (
                  <small className="slash-palette__badge">{row.command.source}</small>
                )}
              </li>
            ))}
          </ul>
        )}
        <footer className="slash-palette__foot">
          <small>↵ select · → expand · ← back · esc close</small>
        </footer>
      </div>
    </div>
  );
}
