import type { Metadata } from 'next';
import Link from 'next/link';
import { attachmentUrl, getPublicSettings } from '@/lib/server-api';
import { FALLBACK_SETTINGS } from '@/lib/settings-defaults';

/**
 * Sign-in and registration screens must never appear in search results: they
 * carry no content worth indexing and a crawled `?next=` parameter is a small
 * information leak. Pages under this layout only set a title, so this sticks.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

/**
 * Scoped to this route group rather than added to `globals.css`, so the split
 * layout ships with the only screens that use it instead of loading on every
 * page. `precedence` lets React hoist and de-duplicate it.
 */
const AUTH_STYLES = `
.tf-auth {
  min-height: 100dvh;
  display: grid;
  grid-template-columns: 1fr;
}

/* The brand panel is decoration; below lg it would push the form off-screen. */
.tf-auth__brand { display: none; }

.tf-auth__main {
  display: flex;
  flex-direction: column;
  min-height: 100dvh;
}

.tf-auth__top {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 1rem clamp(1rem, 5vw, 2rem);
}

.tf-auth__home {
  display: inline-flex;
  align-items: center;
  gap: 0.55rem;
  font-weight: 600;
  color: var(--tf-text);
  text-decoration: none;
  white-space: nowrap;
  border-radius: 6px;
}

.tf-auth__home:hover { color: var(--ant-color-primary, #4f46e5); }

.tf-auth__arrow {
  color: var(--tf-text-muted);
  font-size: 1.1rem;
  line-height: 1;
}

.tf-auth__mark {
  width: 30px;
  height: 30px;
  border-radius: 8px;
  flex: none;
  display: grid;
  place-items: center;
  font-size: 0.9rem;
  font-weight: 700;
  background: var(--ant-color-primary, #4f46e5);
  color: var(--ant-color-text-light-solid, #fff);
}

.tf-auth__body {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 clamp(1rem, 5vw, 2rem) clamp(2rem, 8vw, 4rem);
}

.tf-auth__col {
  width: 100%;
  max-width: 420px;
}

.tf-auth__title {
  font-size: 1.55rem;
  line-height: 1.25;
  letter-spacing: -0.02em;
  font-weight: 700;
  margin: 0 0 0.35rem;
}

.tf-auth__subtitle {
  color: var(--tf-text-muted);
  line-height: 1.55;
  margin: 0 0 1.5rem;
}

/* Reserves the card's height while the client form streams in, so the page
   does not jump once it hydrates. */
.tf-auth__pending {
  min-height: 380px;
  border: 1px solid var(--tf-border);
  border-radius: 14px;
  background: var(--tf-surface);
}

@media (min-width: 992px) {
  .tf-auth { grid-template-columns: minmax(0, 1fr) minmax(0, 1.05fr); }

  .tf-auth__brand {
    position: relative;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    gap: 2rem;
    overflow: hidden;
    padding: clamp(2rem, 4vw, 3.5rem);
    background: var(--tf-surface);
    border-right: 1px solid var(--tf-border);
  }

  .tf-auth__brand::before {
    content: '';
    position: absolute;
    inset: 0;
    background: var(--tf-hero-glow);
    pointer-events: none;
  }

  .tf-auth__panel { position: relative; }
}

.tf-auth__logo {
  display: inline-flex;
  align-items: center;
  gap: 0.7rem;
  font-size: 1.1rem;
  font-weight: 650;
  color: var(--tf-text);
  text-decoration: none;
}

.tf-auth__headline {
  font-size: clamp(1.6rem, 2.4vw, 2.05rem);
  line-height: 1.2;
  letter-spacing: -0.02em;
  font-weight: 700;
  margin: 2.5rem 0 0.75rem;
}

.tf-auth__tagline {
  margin: 0;
  max-width: 38ch;
  line-height: 1.6;
  color: var(--tf-text-muted);
}

.tf-auth__points {
  list-style: none;
  margin: 2rem 0 0;
  padding: 0;
  display: grid;
  gap: 0.9rem;
  max-width: 42ch;
}

.tf-auth__point {
  display: flex;
  align-items: flex-start;
  gap: 0.65rem;
  font-size: 0.95rem;
  line-height: 1.55;
  color: var(--tf-text-muted);
}

.tf-auth__tick {
  flex: none;
  margin-top: 0.2rem;
  width: 1.15rem;
  height: 1.15rem;
  border-radius: 50%;
  display: grid;
  place-items: center;
  font-size: 0.7rem;
  color: var(--ant-color-primary, #4f46e5);
  background: color-mix(in srgb, var(--ant-color-primary, #4f46e5) 16%, transparent);
}

.tf-auth__fineprint {
  position: relative;
  margin: 0;
  font-size: 0.8125rem;
  color: var(--tf-text-subtle);
}

.tf-auth__fineprint a { color: inherit; }
`;

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const settings = (await getPublicSettings()) ?? FALLBACK_SETTINGS;
  const { branding, features, legal } = settings;

  const logoSrc = attachmentUrl(branding.logoAttachmentId);
  const initial = (branding.logoText || branding.siteName).trim().charAt(0).toUpperCase() || 'T';

  /*
   * Selling points are gated on the feature flags. An installation with
   * attachments turned off should not be promising them on the sign-in screen.
   */
  const points = [
    'Plan, prioritise and finish your work in one place.',
    features.attachmentsEnabled ? 'Attach files and screenshots straight to a task.' : null,
    features.exportsEnabled ? 'Export everything you own to CSV or PDF at any time.' : null,
    'Argon2id password hashing, rotating sessions and optional two-factor sign-in.',
  ].filter((point): point is string => point !== null);

  /*
   * A plain <img> rather than next/image: the logo is uploaded through the admin
   * panel and served by the API proxy, so its dimensions are unknown at build
   * time and remote-pattern config would buy nothing at 30px.
   */
  const mark = logoSrc ? (
    <img src={logoSrc} alt="" className="tf-brand__mark" width={30} height={30} />
  ) : (
    <span className="tf-auth__mark" aria-hidden="true">
      {initial}
    </span>
  );

  return (
    <>
      <style href="tf-auth-layout" precedence="medium">
        {AUTH_STYLES}
      </style>

      <div className="tf-auth">
        <aside className="tf-auth__brand">
          <div className="tf-auth__panel">
            <Link href="/" className="tf-auth__logo">
              {mark}
              <span>{branding.logoText || branding.siteName}</span>
            </Link>

            <h2 className="tf-auth__headline">{branding.tagline}</h2>
            <p className="tf-auth__tagline">
              Everything you need to keep track of the work that matters, and nothing you do not.
            </p>

            <ul className="tf-auth__points">
              {points.map((point) => (
                <li key={point} className="tf-auth__point">
                  <span className="tf-auth__tick" aria-hidden="true">
                    ✓
                  </span>
                  <span>{point}</span>
                </li>
              ))}
            </ul>
          </div>

          <p className="tf-auth__fineprint">
            By continuing you agree to our <Link href="/legal/terms">Terms of Service</Link> and{' '}
            <Link href="/legal/privacy">Privacy Policy</Link>
            {legal.policyVersion ? ` (v${legal.policyVersion})` : null}.
          </p>
        </aside>

        <div className="tf-auth__main">
          <header className="tf-auth__top">
            <Link
              href="/"
              className="tf-auth__home"
              aria-label={`Back to the ${branding.siteName} home page`}
            >
              <span className="tf-auth__arrow" aria-hidden="true">
                ←
              </span>
              {mark}
              <span>{branding.logoText || branding.siteName}</span>
            </Link>
          </header>

          <main id="main" className="tf-auth__body">
            <div className="tf-auth__col">{children}</div>
          </main>
        </div>
      </div>
    </>
  );
}
