'use client';

import { useEffect, useRef, useState } from 'react';
import { App, Button } from 'antd';
import { CheckOutlined, CopyOutlined } from '@ant-design/icons';

/**
 * Documentation snippets are meant to be taken, not read, so every block owns a
 * copy button rather than relying on the reader selecting text, which on a
 * phone means a long-press and two drag handles inside a horizontally scrolling
 * element.
 *
 * React 19 hoists this into <head> and deduplicates it by `href`, so a page with
 * a dozen snippets still ships one stylesheet.
 */
const CODE_CSS = `
.tf-code {
  border: 1px solid var(--tf-border);
  border-radius: 10px;
  background: var(--tf-surface-raised);
  overflow: hidden;
  margin-block: 0.85rem;
}
.tf-code__bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.2rem 0.3rem 0.2rem 0.8rem;
  border-bottom: 1px solid var(--tf-border);
  background: var(--tf-border-subtle);
}
.tf-code__label {
  font-size: 0.72rem;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: var(--tf-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* The only element on the page allowed to scroll sideways. The alternative is
   wrapped shell commands, which are no longer copy-pasteable. */
.tf-code__pre {
  margin: 0;
  padding: 0.85rem 1rem;
  overflow-x: auto;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.8125rem;
  line-height: 1.65;
  color: var(--tf-text);
  tab-size: 2;
}
.tf-code__pre code {
  font: inherit;
  background: none;
  padding: 0;
  color: inherit;
}
`;

/** Long enough for the tick to register, short enough not to look stuck. */
const FEEDBACK_MS = 2000;

export function CodeBlock({
  code,
  language = 'text',
  label,
}: {
  code: string;
  /** Shown in the bar and used to name the copy button for screen readers. */
  language?: string;
  /** Overrides the language in the bar, e.g. "Response" or "Request". */
  label?: string;
}) {
  const { message } = App.useApp();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const caption = label ?? language;

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), FEEDBACK_MS);
    } catch {
      // Blocked on insecure origins and inside some embedded browsers. The code
      // is still on screen and selectable, so this is a nudge, not a failure.
      message.error('Copying failed. Select the snippet and copy it by hand');
    }
  }

  return (
    <div className="tf-code">
      <style href="tf-code-block" precedence="default">
        {CODE_CSS}
      </style>

      <div className="tf-code__bar">
        <span className="tf-code__label">{caption}</span>
        <Button
          type="text"
          size="small"
          icon={copied ? <CheckOutlined /> : <CopyOutlined />}
          onClick={() => void copy()}
          aria-label={`Copy the ${caption} snippet`}
        >
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>

      {/* A region that scrolls has to be reachable by keyboard, or a snippet
          wider than the viewport is simply unreadable without a mouse. The
          tab stop is what lets the arrow keys move it (WCAG 2.1.1). */}
      <pre className="tf-code__pre" tabIndex={0} role="region" aria-label={`${caption} snippet`}>
        <code>{code}</code>
      </pre>
    </div>
  );
}
