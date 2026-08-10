import { describe, expect, it } from 'bun:test';
import { resolveToolRenderer } from '../../web/src/tool-render/registry.js';

describe('unknown tool browser fallback', () => {
  it('returns a populated generic renderer model rather than a blank entry', () => {
    const model = resolveToolRenderer('vendor__future_tool')({
      toolCallId: 'unknown_1',
      toolName: 'vendor__future_tool',
      args: { target: 'fixture' },
      result: { content: [{ type: 'text', text: 'completed' }] },
      state: 'completed',
    }) as { displayText: string; prettyArgs: string; rawJson: string };

    expect(model.displayText).toContain('completed');
    expect(model.prettyArgs).toContain('fixture');
    expect(model.rawJson).toContain('vendor__future_tool');
  });
});
