import { useState, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import { Copy } from 'lucide-react';
import 'highlight.js/styles/github-dark.css';

const schema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    code: [...(defaultSchema.attributes?.code ?? []), ['className', /^language-[\w-]+$/]],
  },
};

function textOf(value: ReactNode): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map(textOf).join('');
  if (value && typeof value === 'object' && 'props' in value) return textOf((value as { props?: { children?: ReactNode } }).props?.children ?? '');
  return '';
}

function CopyablePre({ children }: { children?: ReactNode }) {
  const [notice, setNotice] = useState('');
  const text = textOf(children).replace(/\n$/, '');
  const copy = async () => {
    try {
      await navigator.clipboard?.writeText(text);
      setNotice('Code copied.');
    } catch {
      setNotice('Could not copy code.');
    }
  };
  return <pre className="markdown-code"><button type="button" className="markdown-code__copy" onClick={() => void copy()} aria-label="Copy code"><Copy size={14} /> Copy</button>{children}<span className="u-sr-only" role="status" aria-live="polite">{notice}</span></pre>;
}

export function MarkdownMessage({ children }: { children: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      // Sanitize untrusted markdown first. Highlighting subsequently adds only
      // trusted token spans; input code classes remain limited by `schema`.
      rehypePlugins={[[rehypeSanitize, schema], rehypeHighlight]}
      components={{ pre: CopyablePre }}
    >
      {children}
    </ReactMarkdown>
  );
}
