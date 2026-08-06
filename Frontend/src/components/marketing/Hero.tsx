import Link from 'next/link';
import { AppPreview } from '@/components/marketing/AppPreview';

export interface HeroAction {
  href: string;
  label: string;
  /** Rendered as a plain anchor with the usual `noopener noreferrer` pair. */
  external?: boolean;
  icon?: React.ReactNode;
}

interface HeroProps {
  siteName: string;
  tagline: string;
  /** Small pill above the headline: the installed version, when it is public. */
  eyebrow: string;
  primary: HeroAction;
  secondary: HeroAction;
}

function Action({ action, variant }: { action: HeroAction; variant: 'primary' | 'ghost' }) {
  const className = `tf-lp__cta tf-lp__cta--${variant}`;

  if (action.external) {
    return (
      <a className={className} href={action.href} target="_blank" rel="noopener noreferrer">
        {action.icon}
        {action.label}
      </a>
    );
  }

  return (
    <Link className={className} href={action.href}>
      {action.label}
      {action.icon}
    </Link>
  );
}

/**
 * The hero.
 *
 * The decorative layer is `aria-hidden` and purely presentational: a faded
 * ruled grid and two blurred colour fields drifting on a half-minute cycle.
 * Both drift animations return to where they began and are switched off
 * outright under `prefers-reduced-motion`, so nobody is asked to sit through
 * movement they have told their operating system they do not want.
 */
export function Hero({ siteName, tagline, eyebrow, primary, secondary }: HeroProps) {
  return (
    <section className="tf-hero tf-lp__hero">
      <div className="tf-lp__decor" aria-hidden="true">
        <span className="tf-lp__orb tf-lp__orb--a" />
        <span className="tf-lp__orb tf-lp__orb--b" />
      </div>

      <div className="tf-container tf-lp__hero-inner">
        <p className="tf-lp__eyebrow">
          <span className="tf-lp__dot" aria-hidden="true" />
          {eyebrow}
        </p>

        {/* Both lines belong to the same heading: the tagline is the rest of
            the sentence the site name starts, and splitting them into an h1 and
            a stray paragraph would leave the page's only heading naming a
            product without saying what it is. */}
        <h1 className="tf-lp__title">
          <span className="tf-lp__title-name">{siteName}</span>
          {tagline ? <span className="tf-lp__title-tag">{tagline}</span> : null}
        </h1>

        <p className="tf-lp__hero-lede">
          An open-source task manager you run yourself. Tasks with priorities, due dates and tags,
          file attachments kept in your own PostgreSQL database, six export formats, and a control
          panel that changes the site without a redeploy.
        </p>

        <div className="tf-lp__actions">
          <Action action={primary} variant="primary" />
          <Action action={secondary} variant="ghost" />
        </div>

        {/* `role="list"`: `list-style: none` costs this its list semantics in
            WebKit, and the separators between the items are CSS `::before`
            content, so without the list there is nothing dividing the three
            claims from one another. */}
        <ul className="tf-lp__trust" role="list">
          <li>Open source</li>
          <li>MIT licensed</li>
          <li>Self-hosted</li>
        </ul>

        <AppPreview siteName={siteName} />
      </div>
    </section>
  );
}
