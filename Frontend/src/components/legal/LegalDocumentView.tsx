import dayjs from 'dayjs';
import { ConsentPreferencesButton } from '@/components/layout/ConsentPreferencesButton';
import { Markdown, markdownHeadings } from '@/components/legal/Markdown';
import { LegalEmptyState } from '@/components/legal/LegalEmptyState';
import type { LegalDocument } from '@/types/api';

/**
 * The two-column reading layout the legal pages share.
 *
 * These rules cannot be inline styles because they are breakpoint-dependent,
 * and they do not belong in `globals.css` because nothing outside these three
 * pages uses them. React 19 hoists the tag into <head> and deduplicates it by
 * `href`, so rendering it once per page costs one stylesheet, not three.
 */
const LAYOUT_CSS = `
.tf-legal { padding-block: clamp(2rem, 6vw, 3.5rem); }
.tf-legal__title { font-size: clamp(1.75rem, 4.5vw, 2.5rem); line-height: 1.15; letter-spacing: -0.02em; margin: 0 0 0.5rem; }
.tf-legal__meta { display: flex; flex-wrap: wrap; gap: 0.35rem 1rem; font-size: 0.875rem; margin: 0 0 2rem; }
.tf-legal__body { display: grid; gap: 2.5rem; align-items: start; }
.tf-legal__toc { display: none; }
.tf-legal__toc-title { font-size: 0.8125rem; text-transform: uppercase; letter-spacing: 0.06em; margin: 0 0 0.75rem; color: var(--tf-text-muted); }
.tf-legal__toc-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.5rem; font-size: 0.9rem; border-left: 1px solid var(--tf-border); }
.tf-legal__toc-list li { padding-left: 0.85rem; }
.tf-legal__toc-list a { color: var(--tf-text-muted); text-decoration: none; }
.tf-legal__toc-list a:hover, .tf-legal__toc-list a:focus-visible { color: var(--tf-text); text-decoration: underline; }
.tf-legal__consent { margin-top: 2.5rem; padding-top: 1.5rem; border-top: 1px solid var(--tf-border); font-size: 0.9375rem; }
.tf-legal__consent-btn { padding: 0; border: 0; background: none; font: inherit; color: var(--ant-color-primary, #4f46e5); text-decoration: underline; cursor: pointer; }
@media (min-width: 992px) {
  .tf-legal__body { grid-template-columns: minmax(0, 1fr) 220px; }
  .tf-legal__toc { display: block; position: sticky; top: 5.5rem; }
}
`;

export function LegalDocumentView({
  doc,
  policyVersion,
  contactEmail,
  showConsentControl = false,
}: {
  doc: LegalDocument;
  policyVersion: string;
  contactEmail: string;
  /** Only the cookie policy offers it, because it is the one page where a reader
      is likely to want to act on what they have just read. */
  showConsentControl?: boolean;
}) {
  const body = doc.body.trim();
  const headings = body ? markdownHeadings(body) : [];

  const effective = dayjs(doc.effectiveDate);
  const hasEffectiveDate = Boolean(doc.effectiveDate) && effective.isValid();

  return (
    <div className="tf-container tf-legal">
      <style href="tf-legal-layout" precedence="default">
        {LAYOUT_CSS}
      </style>

      <header>
        <h1 className="tf-legal__title">{doc.title}</h1>
        <p className="tf-legal__meta tf-muted">
          {hasEffectiveDate ? (
            <span>
              Effective{' '}
              <time dateTime={effective.format('YYYY-MM-DD')}>{effective.format('D MMMM YYYY')}</time>
            </span>
          ) : null}
          <span>Policy version {policyVersion}</span>
        </p>
      </header>

      <div className="tf-legal__body">
        <article className="tf-prose">
          {body ? (
            <Markdown source={body} />
          ) : (
            <LegalEmptyState title={doc.title} contactEmail={contactEmail} />
          )}

          {showConsentControl ? (
            <p className="tf-legal__consent">
              Change your mind at any time:{' '}
              <ConsentPreferencesButton className="tf-legal__consent-btn" />
            </p>
          ) : null}
        </article>

        {/* Hidden below 992px rather than collapsed into an accordion: on a phone
            the document itself is one scroll away, and a duplicate index is just
            more to swipe past. */}
        {headings.length > 1 ? (
          <nav className="tf-legal__toc" aria-labelledby="tf-legal-toc-title">
            <h2 className="tf-legal__toc-title" id="tf-legal-toc-title">
              On this page
            </h2>
            <ol className="tf-legal__toc-list">
              {headings.map((heading) => (
                <li key={heading.id}>
                  <a href={`#${heading.id}`}>{heading.text}</a>
                </li>
              ))}
            </ol>
          </nav>
        ) : null}
      </div>
    </div>
  );
}
