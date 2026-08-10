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

  it('does not create executable nodes or unsafe URI attributes for hostile markdown variants', () => {
    const payload = [
      '<svg><animate onbegin="window.__xss=1" attributeName="x" /></svg>',
      '<svg onload="window.__xss=1"><a href="javascript:alert(1)">x</a></svg>',
      '<iframe srcdoc="<script>window.__xss=1</script>"></iframe><form action="https://evil.test"><input name=x></form>',
      '[javascript entity](java&#x73;cript:alert(1))',
      '[data html](data:text/html;base64,PHNjcmlwdD4=)',
      '[nested ![image](javascript:alert(1))](javascript:alert(1))',
      '![data image](data:text/html;base64,PHNjcmlwdD4=)',
      '```\u202Eevil.js\n<svg onload=alert(1)>\n```',
    ].join('\n\n');
    const { container } = render(<MarkdownMessage>{payload}</MarkdownMessage>);

    expect(container.querySelector('svg:not(.lucide), iframe, form, input, script, animate')).toBeNull();
    for (const element of container.querySelectorAll('*')) {
      for (const attribute of Array.from(element.attributes)) {
        expect(attribute.name.toLowerCase()).not.toMatch(/^on/);
        if (['href', 'src', 'xlink:href', 'action', 'srcdoc'].includes(attribute.name.toLowerCase())) {
          expect(attribute.value.toLowerCase()).not.toMatch(/^\s*(?:javascript|data:text\/html):/);
        }
      }
    }
    expect(container.querySelector('code')?.textContent).toContain('<svg onload=alert(1)>');
  });

  it('renders a long hostile markdown string without runaway sanitizer time', () => {
    const payload = `${'[x](javascript:alert(1)) '.repeat(30_000)}<svg onload=alert(1)>`;
    const started = performance.now();
    const { container } = render(<MarkdownMessage>{payload}</MarkdownMessage>);
    // This is deliberately generous to avoid CI hardware variance. The review
    // report records the measured cost as a DoS concern, rather than relying on
    // a timing-sensitive assertion to enforce XSS safety.
    expect(performance.now() - started).toBeLessThan(12_000);
    expect(container.querySelector('svg:not(.lucide), script')).toBeNull();
  }, 15_000);
});
