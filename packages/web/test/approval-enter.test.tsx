import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { ApprovalDialog as A } from '../src/components/ApprovalDialog';
const i = { id: 'a', kind: 'approval' as const, method: 'confirm', payload: {} };
for (const [name, want] of [['Deny', false], ['Allow once', true]] as const)
  it(`Enter on ${name}`, async () => {
    const r = vi.fn();
    render(<A interaction={i} onRespond={r} />);
    screen.getByRole('button', { name }).focus();
    await userEvent.keyboard('{Enter}');
    expect(r.mock.calls).toEqual([[want]]);
  });
