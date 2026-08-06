/**
 * A deliberately tiny Markdown renderer for administrator-authored legal copy.
 *
 * It supports exactly what the legal documents use (h2/h3, paragraphs, ordered
 * and unordered lists, bold, italic, inline code, links and GFM pipe tables)
 * and nothing else. A general-purpose parser would be a dependency, a bundle
 * cost and a much larger attack surface for a feature whose entire job is to
 * print seven paragraphs of policy text.
 *
 * SECURITY: this builds React elements, never an HTML string, and there is no
 * `dangerouslySetInnerHTML` anywhere in the file. That is the whole safety
 * argument. A document body containing `<script>alert(1)</script>` produces a
 * text node reading `<script>alert(1)</script>`, because React escapes it on the
 * way out, so injected markup is displayed rather than executed. The only place a
 * value reaches an attribute is a link `href`, which is why `safeHref` below is
 * an allowlist rather than a blocklist.
 */
import Link from 'next/link';
import type { CSSProperties, ReactNode } from 'react';

export interface MarkdownHeading {
  id: string;
  text: string;
}

type Align = 'left' | 'center' | 'right' | undefined;

type Block =
  | { kind: 'heading'; level: 2 | 3; id: string; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; ordered: boolean; start: number; items: string[] }
  | { kind: 'table'; header: string[]; align: Align[]; rows: string[][] };

/* -------------------------------------------------------------------------- */
/* Block scanning                                                             */
/* -------------------------------------------------------------------------- */

const HEADING_RE = /^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/;
const UNORDERED_RE = /^ {0,3}[-*+]\s+(.*)$/;
const ORDERED_RE = /^ {0,3}(\d{1,9})[.)]\s+(.*)$/;

/**
 * Split a table row on unescaped pipes. The lookbehind is what lets a document
 * write a literal `\|` inside a cell, which the cookie table needs for the
 * `HttpOnly` note.
 */
function splitRow(line: string): string[] {
  let trimmed = line.trim();
  if (trimmed.startsWith('|')) trimmed = trimmed.slice(1);
  if (trimmed.endsWith('|') && !trimmed.endsWith('\\|')) trimmed = trimmed.slice(0, -1);

  return trimmed.split(/(?<!\\)\|/).map((cell) => cell.replace(/\\\|/g, '|').trim());
}

/** `| --- | :--: |`, the line that turns the row above it into a table header. */
function isTableDelimiter(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.includes('|') || !trimmed.includes('-')) return false;
  if (!/^[|\-:\s]+$/.test(trimmed)) return false;

  const cells = splitRow(trimmed);
  return cells.length > 0 && cells.every((cell) => /^:?-+:?$/.test(cell));
}

function alignOf(cell: string | undefined): Align {
  const trimmed = (cell ?? '').trim();
  const left = trimmed.startsWith(':');
  const right = trimmed.endsWith(':');
  if (left && right) return 'center';
  if (right) return 'right';
  if (left) return 'left';
  return undefined;
}

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'section';
}

/** Ids are anchor targets for the table of contents, so duplicates must not collide. */
function uniqueId(base: string, seen: Map<string, number>): string {
  const count = seen.get(base) ?? 0;
  seen.set(base, count + 1);
  return count === 0 ? base : `${base}-${count + 1}`;
}

/** Inline markers removed, for heading anchors, TOC labels and meta descriptions. */
export function markdownToPlainText(source: string): string {
  return source
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    .replace(/^ {0,3}#{1,6}\s+/gm, '')
    .replace(/^ {0,3}[-*+]\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseBlocks(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  const seenIds = new Map<string, number>();
  let index = 0;

  const startsNewBlock = (line: string, next: string | undefined): boolean =>
    HEADING_RE.test(line) ||
    UNORDERED_RE.test(line) ||
    ORDERED_RE.test(line) ||
    (line.includes('|') && next !== undefined && isTableDelimiter(next));

  while (index < lines.length) {
    const line = lines[index] ?? '';

    if (!line.trim()) {
      index += 1;
      continue;
    }

    const heading = HEADING_RE.exec(line);
    if (heading) {
      const hashes = heading[1] ?? '##';
      const text = heading[2] ?? '';
      /*
       * Everything below h3 collapses into h3 and `#` is promoted to h2: the
       * page already renders the document title as the page's only h1, and a
       * second h1 would break the heading outline screen readers navigate by.
       */
      const level: 2 | 3 = hashes.length >= 3 ? 3 : 2;
      blocks.push({
        kind: 'heading',
        level,
        text,
        id: uniqueId(slugify(markdownToPlainText(text)), seenIds),
      });
      index += 1;
      continue;
    }

    const delimiter = lines[index + 1];
    if (line.includes('|') && delimiter !== undefined && isTableDelimiter(delimiter)) {
      const header = splitRow(line);
      const align = splitRow(delimiter).map(alignOf);
      const rows: string[][] = [];
      index += 2;

      while (index < lines.length) {
        const rowLine = lines[index] ?? '';
        if (!rowLine.trim() || !rowLine.includes('|')) break;
        const cells = splitRow(rowLine);
        // Normalised against the header so a short row cannot shift the columns.
        rows.push(header.map((_, column) => cells[column] ?? ''));
        index += 1;
      }

      blocks.push({ kind: 'table', header, align: header.map((_, c) => align[c]), rows });
      continue;
    }

    const unordered = UNORDERED_RE.exec(line);
    const ordered = ORDERED_RE.exec(line);
    if (unordered || ordered) {
      const isOrdered = ordered !== null;
      const start = isOrdered ? Number.parseInt(ordered?.[1] ?? '1', 10) : 1;
      const items: string[] = [];

      while (index < lines.length) {
        const current = lines[index] ?? '';
        if (!current.trim()) break;

        const itemUnordered = UNORDERED_RE.exec(current);
        const itemOrdered = ORDERED_RE.exec(current);
        const marker = isOrdered ? itemOrdered : itemUnordered;

        if (marker) {
          items.push((isOrdered ? marker[2] : marker[1]) ?? '');
        } else if (itemUnordered || itemOrdered || HEADING_RE.test(current)) {
          break;
        } else {
          // Lazy continuation: a wrapped line belongs to the item above it.
          const last = items.length - 1;
          const previous = items[last];
          if (previous === undefined) break;
          items[last] = `${previous} ${current.trim()}`;
        }

        index += 1;
      }

      blocks.push({ kind: 'list', ordered: isOrdered, start, items });
      continue;
    }

    const paragraph: string[] = [];
    while (index < lines.length) {
      const current = lines[index] ?? '';
      if (!current.trim()) break;
      if (startsNewBlock(current, lines[index + 1])) break;
      paragraph.push(current.trim());
      index += 1;
    }

    if (paragraph.length === 0) {
      index += 1;
      continue;
    }

    // Soft line breaks join with a space, as in CommonMark.
    blocks.push({ kind: 'paragraph', text: paragraph.join(' ') });
  }

  return blocks;
}

/* -------------------------------------------------------------------------- */
/* Inline rendering                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Alternatives are ordered so the greedier marker wins at a given position:
 * code before everything (its contents are literal), then links, then `**`
 * before `*`. The `_` variants refuse to match inside a word, otherwise
 * `tf_consent_cookie` would render as italics.
 */
const INLINE_SOURCE = [
  '(`+)([\\s\\S]*?)\\1',
  '\\[([^\\]]*)\\]\\(\\s*([^\\s()]*)(?:\\s+"[^"]*")?\\s*\\)',
  '\\*\\*([\\s\\S]+?)\\*\\*',
  '__([\\s\\S]+?)__',
  '\\*([^*\\n]+?)\\*',
  '(?<![A-Za-z0-9])_([^_\\n]+?)_(?![A-Za-z0-9])',
].join('|');

const SR_ONLY: CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  overflow: 'hidden',
  clipPath: 'inset(50%)',
  whiteSpace: 'nowrap',
  border: 0,
};

/**
 * The only allowlist in the file, and the reason it is an allowlist: these
 * documents are edited from the admin console, so a compromised or careless
 * administrator account must not be able to turn a policy page into a
 * `javascript:` payload. Anything not matched here is rendered as plain text.
 */
function safeHref(raw: string): string | null {
  const href = raw.trim();
  if (!href) return null;

  // `//evil.example` passes a naive "starts with /" check but leaves the site.
  if (href.startsWith('//')) return null;
  if (href.startsWith('/')) return href;
  if (/^https?:\/\//i.test(href)) return href;
  if (/^mailto:\S+@\S+/i.test(href)) return href;

  return null;
}

function renderLink(label: string, rawHref: string, key: string): ReactNode {
  const href = safeHref(rawHref);
  const children = renderInline(label, `${key}l`);

  if (!href) {
    // A rejected scheme still shows its label, so the sentence stays readable.
    return <span key={key}>{children}</span>;
  }

  if (href.startsWith('/')) {
    return (
      <Link key={key} href={href}>
        {children}
      </Link>
    );
  }

  if (href.startsWith('mailto:')) {
    return (
      <a key={key} href={href}>
        {children}
      </a>
    );
  }

  return (
    <a key={key} href={href} target="_blank" rel="noopener noreferrer">
      {children}
      {/* Sighted users get the new-tab behaviour as a surprise either way;
          screen reader users at least get told before they activate it. */}
      <span style={SR_ONLY}> (opens in a new tab)</span>
    </a>
  );
}

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  // A fresh regex per call: a shared one carries `lastIndex` between the
  // recursive calls below and starts dropping matches.
  const pattern = new RegExp(INLINE_SOURCE, 'g');
  const nodes: ReactNode[] = [];
  let cursor = 0;
  let counter = 0;

  for (let match = pattern.exec(text); match !== null; match = pattern.exec(text)) {
    if (match.index > cursor) nodes.push(text.slice(cursor, match.index));
    const key = `${keyPrefix}-${counter}`;
    counter += 1;

    const [whole, backticks, code, label, href, boldStar, boldUnderscore, italicStar, italicUnderscore] =
      match;

    if (backticks !== undefined) {
      nodes.push(<code key={key}>{(code ?? '').trim()}</code>);
    } else if (label !== undefined && href !== undefined) {
      nodes.push(renderLink(label, href, key));
    } else if (boldStar !== undefined || boldUnderscore !== undefined) {
      nodes.push(<strong key={key}>{renderInline(boldStar ?? boldUnderscore ?? '', key)}</strong>);
    } else if (italicStar !== undefined || italicUnderscore !== undefined) {
      nodes.push(<em key={key}>{renderInline(italicStar ?? italicUnderscore ?? '', key)}</em>);
    }

    // A zero-length match would never advance `lastIndex` and would hang the
    // render; none of the alternatives can produce one, but a render loop is
    // not a failure mode worth leaving to a future edit of the pattern.
    const consumed = whole ?? '';
    cursor = match.index + consumed.length;
    if (consumed.length === 0) pattern.lastIndex += 1;
  }

  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}

/* -------------------------------------------------------------------------- */
/* Public API                                                                 */
/* -------------------------------------------------------------------------- */

/** The h2 anchors, for a table of contents that has to agree with the body. */
export function markdownHeadings(source: string): MarkdownHeading[] {
  return parseBlocks(source)
    .filter((block): block is Extract<Block, { kind: 'heading' }> => block.kind === 'heading')
    .filter((block) => block.level === 2)
    .map((block) => ({ id: block.id, text: markdownToPlainText(block.text) }));
}

function renderBlock(block: Block, index: number): ReactNode {
  const key = `b${index}`;

  switch (block.kind) {
    case 'heading': {
      const Tag = block.level === 2 ? 'h2' : 'h3';
      return (
        <Tag key={key} id={block.id}>
          {renderInline(block.text, key)}
        </Tag>
      );
    }

    case 'paragraph':
      return <p key={key}>{renderInline(block.text, key)}</p>;

    case 'list':
      return block.ordered ? (
        <ol key={key} start={block.start === 1 ? undefined : block.start}>
          {block.items.map((item, i) => (
            <li key={`${key}-${i}`}>{renderInline(item, `${key}-${i}`)}</li>
          ))}
        </ol>
      ) : (
        <ul key={key}>
          {block.items.map((item, i) => (
            <li key={`${key}-${i}`}>{renderInline(item, `${key}-${i}`)}</li>
          ))}
        </ul>
      );

    case 'table':
      return (
        // Policy tables are wider than a phone; the wrapper scrolls instead of
        // stretching the page into a horizontal scroll. `tabIndex` is what makes
        // that scroll reachable without a mouse.
        <div key={key} className="tf-prose__table-wrap" tabIndex={0}>
          <table>
            <thead>
              <tr>
                {block.header.map((cell, i) => (
                  <th key={`${key}-h${i}`} scope="col" style={{ textAlign: block.align[i] }}>
                    {renderInline(cell, `${key}-h${i}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, r) => (
                <tr key={`${key}-r${r}`}>
                  {row.map((cell, c) => (
                    <td key={`${key}-r${r}c${c}`} style={{ textAlign: block.align[c] }}>
                      {renderInline(cell, `${key}-r${r}c${c}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
  }
}

/**
 * Render a Markdown document as React elements.
 *
 * Not a client component: the legal pages render this on the server, so the
 * parser never ships to the browser at all.
 */
export function Markdown({ source }: { source: string }) {
  return <>{parseBlocks(source).map(renderBlock)}</>;
}
