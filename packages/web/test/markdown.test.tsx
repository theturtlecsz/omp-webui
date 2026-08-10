import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MarkdownMessage } from '../src/components/MarkdownMessage';

describe('MarkdownMessage sanitization', () => {
  it('neutralizes raw HTML and unsafe URL schemes', () => {
    const payload = [
      '<script>window.__xss = true</script>',
      '<img src=x onerror="window.__xss = true">',
      '[javascript](javascript:alert(1))',
      '[data](data:text/html;base64,PHNjcmlwdD4=)',
      '[safe](https://example.test/ok)',
    ].join('\n\n');
    const { container } = render(<MarkdownMessage>{payload}</MarkdownMessage>);

    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(screen.queryByRole('link', { name: 'javascript' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'data' })).toBeNull();
    expect(screen.getByRole('link', { name: 'safe' })).toHaveAttribute('href', 'https://example.test/ok');
  });

  it('renders GFM code safely with a copy control', () => {
    render(<MarkdownMessage>{'| Name | Value |\n| --- | --- |\n| A | B |\n\n```ts\nconst answer = 42;\n```'}</MarkdownMessage>);
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy code' })).toBeInTheDocument();
    expect(document.querySelector('pre code')?.textContent).toContain('const answer = 42;');
  });
});
