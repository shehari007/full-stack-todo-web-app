import { cache } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { ContactForm, type ContactConfig } from '@/components/contact/ContactForm';
import { PublicFooter } from '@/components/layout/PublicFooter';
import { PublicHeader } from '@/components/layout/PublicHeader';
import { getPublicSettings, serverGet } from '@/lib/server-api';
import { FALLBACK_SETTINGS } from '@/lib/settings-defaults';

/**
 * The public contact form.
 *
 * There is no `layout.tsx` for this one route, so the page carries the same
 * header, footer and `#main` target the legal pages get from theirs. `#main` is
 * where the root layout's skip link points, and a page without it silently
 * breaks that link.
 */

const MAX_DESCRIPTION_LENGTH = 160;

/**
 * `cache` because `generateMetadata` and the page body both need the config and
 * `serverGet` is `no-store`. Without it the API is called twice per render.
 */
const loadContactConfig = cache(async (): Promise<ContactConfig | null> => {
  const body = await serverGet<{ config: ContactConfig }>('/api/contact/config');
  return body?.config ?? null;
});

/** Cut on a word boundary so a description never ends mid-word. */
function summarise(text: string, fallback: string): string {
  const plain = text.replace(/\s+/g, ' ').trim();
  if (!plain) return fallback;
  if (plain.length <= MAX_DESCRIPTION_LENGTH) return plain;

  const clipped = plain.slice(0, MAX_DESCRIPTION_LENGTH);
  const lastSpace = clipped.lastIndexOf(' ');
  return `${(lastSpace > 40 ? clipped.slice(0, lastSpace) : clipped).trimEnd()}...`;
}

/**
 * Same predicate as the footer and sidebar, protocol-relative case included:
 * `//host` passes the settings schema's `safeUrl` because it starts with `/`,
 * but it is not ours and must never reach `next/link` as an internal route.
 */
function isExternalHref(href: string): boolean {
  return /^(https?:)?\/\/|^mailto:|^tel:/i.test(href);
}

export async function generateMetadata(): Promise<Metadata> {
  const [loaded, config] = await Promise.all([getPublicSettings(), loadContactConfig()]);
  const settings = loaded ?? FALLBACK_SETTINGS;

  // Optional-chained through to the string: `serverGet` casts the body without
  // validating it, so an API that has drifted returns an object whose keys are
  // simply absent rather than an error this page can see.
  const title = config?.heading?.trim() || 'Contact';
  const description = summarise(
    config?.intro ?? '',
    `Send a message to the ${settings.branding.siteName} team.`,
  );

  const base = (settings.seo.canonicalBaseUrl || process.env.NEXT_PUBLIC_SITE_URL || '').replace(
    /\/$/,
    '',
  );
  // Absolute when a base URL is configured, relative otherwise. A relative
  // canonical resolved against Next's placeholder origin would point at
  // localhost, which is worse than letting the crawler resolve it.
  const canonical = base ? `${base}/contact` : '/contact';

  return {
    title,
    description,
    alternates: { canonical },
    openGraph: {
      type: 'website',
      title,
      description,
      url: canonical,
      siteName: settings.branding.siteName,
    },
    twitter: { card: 'summary', title, description },
  };
}

const LAYOUT_CSS = `
.tf-contact { padding-block: clamp(2rem, 6vw, 3.5rem); }
.tf-contact__title {
  font-size: clamp(1.75rem, 4.5vw, 2.5rem);
  line-height: 1.15;
  letter-spacing: -0.02em;
  margin: 0 0 0.6rem;
}
.tf-contact__intro {
  max-width: 62ch;
  margin: 0 0 2rem;
  font-size: 1.0625rem;
  line-height: 1.65;
}
.tf-contact__body { display: grid; gap: 2rem; align-items: start; }
/* Without this a long word or the textarea itself can push the column past the
   viewport on a 360px screen: grid items default to min-width:auto. */
.tf-contact__body > * { min-width: 0; }
.tf-contact__aside { display: flex; flex-direction: column; gap: 1rem; }
.tf-contact__aside-title {
  margin: 0;
  font-size: 0.8125rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--tf-text-muted);
}
.tf-contact__card {
  padding: 1.1rem 1.15rem;
  border: 1px solid var(--tf-border);
  border-radius: 14px;
  background: var(--tf-surface);
}
.tf-contact__card h3 { margin: 0 0 0.35rem; font-size: 0.9375rem; }
.tf-contact__card p { margin: 0; font-size: 0.9375rem; line-height: 1.6; color: var(--tf-text-muted); }
.tf-contact__card a { color: var(--ant-color-primary, #4f46e5); overflow-wrap: anywhere; }
.tf-contact__notice {
  max-width: 46rem;
  padding: 1.5rem;
  border: 1px solid var(--tf-border);
  border-radius: 14px;
  background: var(--tf-surface);
}
.tf-contact__notice h2 { margin: 0 0 0.5rem; font-size: 1.15rem; }
.tf-contact__notice p { margin: 0 0 0.6rem; line-height: 1.6; color: var(--tf-text-muted); }
.tf-contact__notice p:last-child { margin-bottom: 0; }
@media (min-width: 992px) {
  .tf-contact__body { grid-template-columns: minmax(0, 1fr) 20rem; gap: 2.5rem; }
  .tf-contact__aside { position: sticky; top: 5.5rem; }
}
`;

export default async function ContactPage() {
  const [loaded, config] = await Promise.all([getPublicSettings(), loadContactConfig()]);
  const settings = loaded ?? FALLBACK_SETTINGS;

  const heading = config?.heading?.trim() || 'Get in touch';
  const intro = config?.intro?.trim() ?? '';
  const docsUrl = settings.about.documentationUrl.trim();
  const contactEmail = settings.legal.contactEmail.trim();

  /*
   * `enabled` mirrors `features.contactFormEnabled`, and the submit route throws
   * a 403 when it is false. Rendering the form anyway would let someone write a
   * long message and only then be told the door was shut, so the flag is honoured
   * here rather than being left to the error branch in the form.
   */
  const closedByOperator = config !== null && !config.enabled;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100dvh' }}>
      <PublicHeader settings={settings} />

      <main id="main" style={{ flex: '1 0 auto' }}>
        <style href="tf-contact-page" precedence="default">
          {LAYOUT_CSS}
        </style>

        <div className="tf-container tf-contact">
          <header>
            <h1 className="tf-contact__title">{heading}</h1>
            {intro ? <p className="tf-contact__intro tf-muted">{intro}</p> : null}
          </header>

          {config && config.enabled ? (
            <div className="tf-contact__body">
              <ContactForm config={config} />

              <aside className="tf-contact__aside" aria-labelledby="tf-contact-aside-title">
                <h2 id="tf-contact-aside-title" className="tf-contact__aside-title">
                  What happens next
                </h2>

                {config.responseTimeNote ? (
                  <div className="tf-contact__card">
                    <h3>Response time</h3>
                    <p>{config.responseTimeNote}</p>
                  </div>
                ) : null}

                {docsUrl ? (
                  <div className="tf-contact__card">
                    <h3>Try the documentation first</h3>
                    <p>
                      Setup, the API and the export formats are all written up in the{' '}
                      {isExternalHref(docsUrl) ? (
                        <a href={docsUrl} target="_blank" rel="noopener noreferrer">
                          documentation
                        </a>
                      ) : (
                        <Link href={docsUrl}>documentation</Link>
                      )}
                      .
                    </p>
                  </div>
                ) : null}

                {contactEmail ? (
                  <div className="tf-contact__card">
                    <h3>Prefer email?</h3>
                    <p>
                      Write to <a href={`mailto:${contactEmail}`}>{contactEmail}</a>. It reaches the
                      same queue, but the form gives you a reference number straight away.
                    </p>
                  </div>
                ) : null}
              </aside>
            </div>
          ) : (
            /*
             * Two different situations, and the config tells them apart: a body
             * that arrived with `enabled: false` is the operator having closed
             * the form, while a null one means `serverGet` swallowed a transport
             * failure. Neither is worth a 404: one is deliberate and one is
             * temporary, and both leave a page worth reading when an email
             * address is configured.
             */
            <div className="tf-contact__notice">
              {closedByOperator ? (
                <>
                  <h2>The contact form is closed</h2>
                  <p>
                    {settings.branding.siteName} is not accepting messages through this form at the
                    moment.
                  </p>
                </>
              ) : (
                <>
                  <h2>The contact form is not available right now</h2>
                  <p>
                    {settings.branding.siteName} may be briefly unreachable. Trying again in a few
                    minutes is usually enough.
                  </p>
                </>
              )}
              {contactEmail ? (
                <p>
                  In the meantime you can email{' '}
                  <a href={`mailto:${contactEmail}`}>{contactEmail}</a>.
                </p>
              ) : null}
            </div>
          )}
        </div>
      </main>

      <PublicFooter settings={settings} />
    </div>
  );
}
