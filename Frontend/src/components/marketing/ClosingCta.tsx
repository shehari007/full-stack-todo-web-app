import Link from 'next/link';
import { ArrowRightOutlined } from '@/components/icons';

interface ClosingCtaProps {
  siteName: string;
  primary: { href: string; label: string };
  /**
   * Present only when a repository is configured, in either of the two settings
   * sections that can hold one. `external` is decided by the caller rather than
   * assumed here: the settings schema accepts a relative path as well as an
   * http(s) URL, and opening a same-origin path in a new tab is not what an
   * operator who typed one meant.
   */
  source?: { href: string; external: boolean } | undefined;
}

export function ClosingCta({ siteName, primary, source }: ClosingCtaProps) {
  return (
    <section className="tf-lp__section" aria-labelledby="closing-heading">
      <div className="tf-container">
        <div className="tf-lp__closing">
          <h2 id="closing-heading" className="tf-lp__h2">
            Start with a single task
          </h2>
          <p className="tf-lp__lede">
            {siteName} is free, open source and yours to host. There is no trial to start and
            nothing to cancel. The only thing you are committing to is writing down the first
            thing you have to do.
          </p>

          <div className="tf-lp__actions">
            <Link className="tf-lp__cta tf-lp__cta--primary" href={primary.href}>
              {primary.label}
              <ArrowRightOutlined aria-hidden="true" />
            </Link>

            {source ? (
              source.external ? (
                <a
                  className="tf-lp__cta tf-lp__cta--ghost"
                  href={source.href}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Read the source
                </a>
              ) : (
                <Link className="tf-lp__cta tf-lp__cta--ghost" href={source.href}>
                  Read the source
                </Link>
              )
            ) : (
              <Link className="tf-lp__cta tf-lp__cta--ghost" href="/legal/privacy">
                Read the privacy policy
              </Link>
            )}
          </div>

          <p className="tf-lp__closing-note">
            Questions about any of this? <Link href="/contact">Send a message</Link> and it goes
            into the support queue.
          </p>
        </div>
      </div>
    </section>
  );
}
