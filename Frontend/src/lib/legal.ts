import type { Metadata } from 'next';
import { markdownToPlainText } from '@/components/legal/Markdown';
import { getPublicSettings } from '@/lib/server-api';
import { FALLBACK_SETTINGS } from '@/lib/settings-defaults';
import type { LegalDocument, PublicSettings } from '@/types/api';

/**
 * The three published documents and the loading/metadata code they share.
 *
 * Kept out of the page files because all three pages differ only by a key.
 * Duplicating the metadata builder three times is how the canonical URL on one
 * of them quietly stops matching the others.
 */
export type LegalDocumentKey = 'privacy' | 'terms' | 'cookies';

const FALLBACK_TITLES: Record<LegalDocumentKey, string> = {
  privacy: 'Privacy Policy',
  terms: 'Terms of Service',
  cookies: 'Cookie Policy',
};

const MAX_DESCRIPTION_LENGTH = 160;

export interface LoadedLegalDocument {
  settings: PublicSettings;
  doc: LegalDocument;
  path: string;
}

export async function loadLegalDocument(key: LegalDocumentKey): Promise<LoadedLegalDocument> {
  const settings = (await getPublicSettings()) ?? FALLBACK_SETTINGS;
  const doc = settings.legal[key];

  return {
    settings,
    // An administrator can blank the title; the page still needs a heading.
    doc: { ...doc, title: doc.title.trim() || FALLBACK_TITLES[key] },
    path: `/legal/${key}`,
  };
}

/** Cut on a word boundary so a description never ends mid-word. */
function summarise(body: string, fallback: string): string {
  const plain = markdownToPlainText(body);
  if (!plain) return fallback;
  if (plain.length <= MAX_DESCRIPTION_LENGTH) return plain;

  const clipped = plain.slice(0, MAX_DESCRIPTION_LENGTH);
  const lastSpace = clipped.lastIndexOf(' ');
  return `${(lastSpace > 40 ? clipped.slice(0, lastSpace) : clipped).trimEnd()}...`;
}

export async function legalMetadata(key: LegalDocumentKey): Promise<Metadata> {
  const { settings, doc, path } = await loadLegalDocument(key);

  const base = (settings.seo.canonicalBaseUrl || process.env.NEXT_PUBLIC_SITE_URL || '').replace(
    /\/$/,
    '',
  );
  /*
   * Absolute when a base URL is configured, relative otherwise. A relative
   * canonical would be resolved against Next's placeholder origin and point at
   * localhost, which is worse than emitting a relative one and letting the
   * crawler resolve it itself.
   */
  const canonical = base ? `${base}${path}` : path;
  const description = summarise(
    doc.body,
    `The ${doc.title.toLowerCase()} for ${settings.branding.siteName}.`,
  );

  return {
    title: doc.title,
    description,
    alternates: { canonical },
    openGraph: {
      type: 'article',
      title: doc.title,
      description,
      url: canonical,
      siteName: settings.branding.siteName,
    },
    twitter: { card: 'summary', title: doc.title, description },
  };
}
