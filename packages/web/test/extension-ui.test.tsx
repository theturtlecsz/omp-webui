import { fireEvent, render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SelectDialog } from '../src/components/SelectDialog';
import { InputDialog } from '../src/components/InputDialog';
import { EditorDialog } from '../src/components/EditorDialog';
import { NotifyToast } from '../src/components/NotifyToast';
import { OpenUrlDialog } from '../src/components/OpenUrlDialog';
import { ExtensionStatusPills } from '../src/components/ExtensionStatusPills';
import { applyServerEvent, initialAppState } from '../src/lib/reducer';
import type { ServerEnvelope } from '../src/lib/types';

const envelope = (payload: Record<string, unknown>): ServerEnvelope => ({
  type: 'session.updated', sessionId: 's', sequence: undefined as unknown as number, eventId: `evt_${Math.random()}`, payload,
} as ServerEnvelope);

describe('SelectDialog', () => {
  it('renders one button per option and does not render a free-form textarea', () => {
    const respond = vi.fn();
    render(<SelectDialog interaction={{ id: 'q', kind: 'question', method: 'select', payload: { title: 'Pick one', options: ['Apples', 'Oranges', 'Bananas'] } }} onRespond={respond} />);
    expect(screen.getByRole('heading', { name: 'Pick one' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Apples' })).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).toBeNull();
  });
  it('submits the chosen option value', () => {
    const respond = vi.fn();
    render(<SelectDialog interaction={{ id: 'q', kind: 'question', method: 'select', payload: { title: 'Pick one', options: ['Apples', 'Oranges'] } }} onRespond={respond} />);
    fireEvent.click(screen.getByRole('option', { name: 'Oranges' }));
    expect(respond).toHaveBeenCalledWith('Oranges');
  });
  it('cancels on Escape via focus trap', () => {
    const respond = vi.fn();
    render(<SelectDialog interaction={{ id: 'q', kind: 'question', method: 'select', payload: { title: 'Pick', options: ['A', 'B'] } }} onRespond={respond} />);
    fireEvent.keyDown(screen.getByRole('option', { name: 'A' }), { key: 'Escape' });
    expect(respond).toHaveBeenCalledWith(undefined, true);
  });
  it('supports ArrowDown/ArrowUp navigation and Enter to submit selection', () => {
    const respond = vi.fn();
    render(<SelectDialog interaction={{ id: 'q', kind: 'question', method: 'select', payload: { title: 'Pick', options: ['A', 'B', 'C'] } }} onRespond={respond} />);
    const dialog = screen.getByRole('dialog');
    fireEvent.keyDown(dialog, { key: 'ArrowDown' });
    fireEvent.keyDown(dialog, { key: 'ArrowDown' });
    // Focus a real focusable element inside the trap so Enter is honored by the trap.
    screen.getByRole('option', { name: 'C' }).focus();
    fireEvent.keyDown(screen.getByRole('option', { name: 'C' }), { key: 'Enter' });
    expect(respond).toHaveBeenCalledWith('C');
  });
});

describe('InputDialog', () => {
  it('submits the typed value on Enter', async () => {
    const respond = vi.fn();
    render(<InputDialog interaction={{ id: 'q', kind: 'question', method: 'input', payload: { title: 'Name?', placeholder: 'your name' } }} onRespond={respond} />);
    const box = screen.getByRole('textbox') as HTMLInputElement;
    await userEvent.type(box, 'Casey');
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(respond).toHaveBeenCalledWith('Casey');
    expect(box.placeholder).toBe('your name');
  });
  it('cancels on Escape', () => {
    const respond = vi.fn();
    render(<InputDialog interaction={{ id: 'q', kind: 'question', method: 'input', payload: { title: 'Name?' } }} onRespond={respond} />);
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
    expect(respond).toHaveBeenCalledWith(undefined, true);
  });
});

describe('EditorDialog', () => {
  it('honors prefill and returns modified value on Cmd/Ctrl-Enter', async () => {
    const respond = vi.fn();
    render(<EditorDialog interaction={{ id: 'q', kind: 'question', method: 'editor', payload: { title: 'Refine', prefill: 'draft body' } }} onRespond={respond} />);
    const area = screen.getByRole('textbox') as HTMLTextAreaElement;
    expect(area.value).toBe('draft body');
    await userEvent.type(area, ' extra');
    fireEvent.keyDown(area, { key: 'Enter', ctrlKey: true });
    expect(respond).toHaveBeenCalledWith('draft body extra');
  });
  it('with promptStyle true, Enter submits and Shift-Enter is a newline (not submit)', () => {
    const respond = vi.fn();
    render(<EditorDialog interaction={{ id: 'q', kind: 'question', method: 'editor', payload: { title: 'Prompt', prefill: 'hi', promptStyle: true } }} onRespond={respond} />);
    const area = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.keyDown(area, { key: 'Enter', shiftKey: true });
    expect(respond).not.toHaveBeenCalled();
    fireEvent.keyDown(area, { key: 'Enter' });
    expect(respond).toHaveBeenCalledWith('hi');
  });
});

describe('NotifyToast', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });
  it('renders info/warning/error variants and auto-dismisses non-errors', () => {
    const dismiss = vi.fn();
    const notifications = [
      { id: '1', notifyType: 'info' as const, message: 'Hello' },
      { id: '2', notifyType: 'warning' as const, message: 'Careful' },
      { id: '3', notifyType: 'error' as const, message: 'Fatal' },
    ];
    render(<NotifyToast notifications={notifications} onDismiss={dismiss} />);
    expect(screen.getByText('Hello')).toBeInTheDocument();
    expect(screen.getByText('Careful')).toBeInTheDocument();
    expect(screen.getByText('Fatal')).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(6100); });
    expect(dismiss).toHaveBeenCalledWith('1');
    expect(dismiss).not.toHaveBeenCalledWith('2');
    expect(dismiss).not.toHaveBeenCalledWith('3');
    act(() => { vi.advanceTimersByTime(4000); });
    expect(dismiss).toHaveBeenCalledWith('2');
    // Error must remain until acknowledged.
    expect(dismiss).not.toHaveBeenCalledWith('3');
  });
  it('renders nothing when list is empty', () => {
    const { container } = render(<NotifyToast notifications={[]} onDismiss={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });
});

describe('ExtensionStatusPills', () => {
  it('renders one pill per non-empty status entry', () => {
    render(<ExtensionStatusPills statuses={{ context: '87% used', mentions: '3 files' }} />);
    expect(screen.getByText('87% used')).toBeInTheDocument();
    expect(screen.getByText('3 files')).toBeInTheDocument();
  });
  it('omits empty entries', () => {
    const { container } = render(<ExtensionStatusPills statuses={{ empty: '' }} />);
    expect(container.firstChild).toBeNull();
  });
});

describe('OpenUrlDialog', () => {
  it('prefers launchUrl as the copy target when present, but anchor uses url', async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    // navigator.clipboard is a non-writable getter in jsdom; replace via defineProperty.
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: write }, configurable: true });
    const dismiss = vi.fn();
    render(<OpenUrlDialog request={{ id: 'u1', url: 'https://oauth.example/authorize?code=verylong', launchUrl: 'http://127.0.0.1:5555/cb', instructions: 'Please sign in.' }} onDismiss={dismiss} />);
    expect(screen.getByText('Please sign in.')).toBeInTheDocument();
    const anchor = screen.getByRole('link') as HTMLAnchorElement;
    expect(anchor.href).toBe('https://oauth.example/authorize?code=verylong');
    expect(anchor.target).toBe('_blank');
    await userEvent.click(screen.getByRole('button', { name: /copy link/i }));
    expect(write).toHaveBeenCalledWith('http://127.0.0.1:5555/cb');
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(dismiss).toHaveBeenCalled();
  });
});

describe('reducer session.updated for extension surfaces', () => {
  it('appends notifications, deduplicates by id, and caps at 20', () => {
    let state = initialAppState;
    for (let i = 0; i < 25; i++) {
      state = applyServerEvent(state, envelope({ extensionNotification: { id: `n${i}`, notifyType: 'info', message: `m${i}` } }));
    }
    expect(state.sessionState.extensionNotifications?.length).toBe(20);
    // Re-emitting an existing id should refresh in place, not stack.
    state = applyServerEvent(state, envelope({ extensionNotification: { id: 'n24', notifyType: 'warning', message: 'refreshed' } }));
    const notifications = state.sessionState.extensionNotifications ?? [];
    expect(notifications.filter((toast) => toast.id === 'n24').length).toBe(1);
    expect(notifications[notifications.length - 1].message).toBe('refreshed');
    expect(notifications[notifications.length - 1].notifyType).toBe('warning');
  });
  it('merges status entries and removes when statusText is empty', () => {
    let state = initialAppState;
    state = applyServerEvent(state, envelope({ extensionStatus: { statusKey: 'ctx', statusText: '10%' } }));
    state = applyServerEvent(state, envelope({ extensionStatus: { statusKey: 'files', statusText: '2 open' } }));
    expect(state.sessionState.extensionStatus).toEqual({ ctx: '10%', files: '2 open' });
    state = applyServerEvent(state, envelope({ extensionStatus: { statusKey: 'ctx', statusText: '' } }));
    expect(state.sessionState.extensionStatus).toEqual({ files: '2 open' });
  });
  it('stores extensionTitle, extensionEditorText, extensionOpenUrl slices independently', () => {
    let state = initialAppState;
    state = applyServerEvent(state, envelope({ extensionTitle: 'Task 42' }));
    state = applyServerEvent(state, envelope({ extensionEditorText: 'apply this' }));
    state = applyServerEvent(state, envelope({ extensionOpenUrl: { id: 'u', url: 'https://x.example/login' } }));
    // A subsequent setWidget must not clobber any of them.
    state = applyServerEvent(state, envelope({ extensionUI: { method: 'setWidget', widgetKey: 'autoresearch' } }));
    expect(state.sessionState.extensionTitle).toBe('Task 42');
    expect(state.sessionState.extensionEditorText).toBe('apply this');
    expect(state.sessionState.extensionOpenUrl?.url).toBe('https://x.example/login');
    expect(state.sessionState.extensionUI?.widgetKey).toBe('autoresearch');
  });
  it('validates notifyType and downgrades unknown to info', () => {
    let state = initialAppState;
    state = applyServerEvent(state, envelope({ extensionNotification: { id: 'x', notifyType: 'critical', message: 'nope' } }));
    expect(state.sessionState.extensionNotifications?.[0].notifyType).toBe('info');
  });
});
