import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SlashCommandPalette } from '../src/components/SlashCommandPalette';
import { ExtensionWidget } from '../src/components/ExtensionWidget';
import { applyServerEvent, initialAppState } from '../src/lib/reducer';
import type { SlashCommand } from '../src/lib/types';

const commands: SlashCommand[] = [
  { name: 'security', description: 'Plan, run, inspect, and compare native security scans', input: { hint: '<plan|scan|status>' }, subcommands: [{ name: 'plan', description: 'Create a plan' }, { name: 'scan', description: 'Start a scan' }, { name: 'status', description: 'Show status' }], source: 'builtin' },
  { name: 'model', aliases: ['models'], description: 'Show current model selection', source: 'builtin' },
  { name: 'fast', description: 'Toggle fast mode', source: 'builtin' },
  { name: 'init', description: 'Generate AGENTS.md', source: 'file' },
];

describe('SlashCommandPalette', () => {
  it('renders no rows when closed', () => {
    render(<SlashCommandPalette open={false} commands={commands} onSelect={vi.fn()} onClose={vi.fn()} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('lists all commands when open with empty query', () => {
    render(<SlashCommandPalette open commands={commands} onSelect={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByRole('dialog', { name: 'Slash command palette' })).toBeInTheDocument();
    expect(screen.getAllByRole('option').length).toBe(4);
  });

  it('filters by prefix', async () => {
    render(<SlashCommandPalette open commands={commands} onSelect={vi.fn()} onClose={vi.fn()} />);
    const input = screen.getByLabelText('Filter slash commands');
    await userEvent.type(input, 'secu');
    const rows = screen.getAllByRole('option');
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain('security');
  });

  it('finds a command by alias when the name does not match', async () => {
    render(<SlashCommandPalette open commands={commands} onSelect={vi.fn()} onClose={vi.fn()} />);
    const input = screen.getByLabelText('Filter slash commands');
    // "models" is only present as an alias of the "model" command.
    await userEvent.type(input, 'models');
    const rows = screen.getAllByRole('option');
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].textContent).toContain('model');
  });

  it('expands subcommands via ArrowRight then submits the sub', async () => {
    const onSelect = vi.fn();
    render(<SlashCommandPalette open commands={commands} onSelect={onSelect} onClose={vi.fn()} />);
    const input = screen.getByLabelText('Filter slash commands');
    // First row is "security" (first in list). ArrowRight expands.
    fireEvent.keyDown(input, { key: 'ArrowRight' });
    // Now the subcommands should be listed under it
    const rows = screen.getAllByRole('option');
    expect(rows.some((r) => r.textContent?.includes('plan'))).toBe(true);
    // Move cursor down onto "plan"
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith('/security plan');
  });

  it('Enter on a command that has subcommands first expands, second selects command itself', () => {
    const onSelect = vi.fn();
    render(<SlashCommandPalette open commands={commands} onSelect={onSelect} onClose={vi.fn()} />);
    const input = screen.getByLabelText('Filter slash commands');
    // security is at row 0. Enter -> expand.
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSelect).not.toHaveBeenCalled();
    // Now Enter again -> should submit /security (since it's still expanded)
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith('/security');
  });

  it('Escape closes when not expanded, collapses when expanded', () => {
    const onClose = vi.fn();
    render(<SlashCommandPalette open commands={commands} onSelect={vi.fn()} onClose={onClose} />);
    const input = screen.getByLabelText('Filter slash commands');
    fireEvent.keyDown(input, { key: 'ArrowRight' }); // expand security
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});

describe('ExtensionWidget', () => {
  it('renders known widget key with registry label', () => {
    render(<ExtensionWidget widget={{ method: 'setWidget', widgetKey: 'autoresearch' }} />);
    expect(screen.getByLabelText(/Autoresearch/)).toBeInTheDocument();
  });
  it('renders neutral fallback for unknown widget keys', () => {
    render(<ExtensionWidget widget={{ method: 'setWidget', widgetKey: 'mystery' }} />);
    expect(screen.getByRole('status')).toHaveAttribute('data-widget-key', 'mystery');
  });
  it('renders nothing when widget is missing or wrong method', () => {
    const { container: emptyContainer } = render(<ExtensionWidget widget={undefined} />);
    expect(emptyContainer.textContent).toBe('');
    const { container: wrongMethodContainer } = render(<ExtensionWidget widget={{ method: 'notify' } as never} />);
    expect(wrongMethodContainer.textContent).toBe('');
  });
});

describe('reducer session.updated', () => {
  const event = (type: string, payload: unknown, extra: Record<string, unknown> = {}) => ({ protocolVersion: 1, type, payload, ...extra } as never);
  it('captures availableCommands array', () => {
    const next = applyServerEvent(initialAppState, event('session.updated', { availableCommands: commands }));
    expect(next.sessionState.availableCommands?.map((c) => c.name)).toEqual(['security', 'model', 'fast', 'init']);
  });
  it('captures extensionUI object', () => {
    const next = applyServerEvent(initialAppState, event('session.updated', { extensionUI: { method: 'setWidget', widgetKey: 'autoresearch' } }));
    expect(next.sessionState.extensionUI?.widgetKey).toBe('autoresearch');
  });
  it('ignores payloads with no known keys', () => {
    const seed = applyServerEvent(initialAppState, event('session.updated', { availableCommands: commands }));
    const next = applyServerEvent(seed, event('session.updated', { commandOutput: { random: 1 } }));
    // Ignored payloads must not mutate sessionState; the outer envelope may still
    // shift for bookkeeping (seenEvents/lastSequences), so compare only the slice.
    expect(next.sessionState).toEqual(seed.sessionState);
    expect(next.sessionState.availableCommands).toBe(seed.sessionState.availableCommands);
  });
  it('preserves commands across replays and unrelated updates', () => {
    let s = applyServerEvent(initialAppState, event('session.updated', { availableCommands: commands }));
    s = applyServerEvent(s, event('status.updated', { isStreaming: true }));
    expect(s.sessionState.availableCommands?.length).toBe(4);
    expect(s.sessionState.isStreaming).toBe(true);
  });
});
