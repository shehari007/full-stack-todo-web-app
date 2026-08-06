'use client';

import Link from 'next/link';
import { theme } from 'antd';
import { useThemeMode } from '@/providers/ThemeProvider';
import type { BrandingSettings } from '@/types/api';

interface LogoProps {
  branding: BrandingSettings;
  /** Hide the wordmark for tight spaces, such as a collapsed sider or a mobile bar. */
  showName?: boolean;
  /** `null` renders the mark without a link, for use inside another link or a dialog title. */
  href?: string | null;
}

/**
 * Keeps the site name in the accessible name even when it is not drawn.
 *
 * `aria-label` on a plain <span> is ignored by most screen readers, and the
 * mark is `alt=""`, so without this a name-less logo link would announce as
 * "link" and nothing else.
 */
/**
 * The icon shipped in `Frontend/public/`. Served as a static file, so it costs
 * no database round trip and is available before any settings have loaded.
 */
const DEFAULT_MARK = '/main-logo.png';

const VISUALLY_HIDDEN: React.CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clipPath: 'inset(50%)',
  whiteSpace: 'nowrap',
  border: 0,
};

export function Logo({ branding, showName = true, href = '/' }: LogoProps) {
  const { resolved } = useThemeMode();
  const { token } = theme.useToken();

  /*
   * The dark variant is optional in the CMS. Falling back to the light asset
   * beats rendering the lettermark instead, which would make the header jump
   * between two different logos as the theme changes.
   */
  const assetId =
    (resolved === 'dark' ? branding.logoDarkAttachmentId : branding.logoAttachmentId) ??
    branding.logoAttachmentId;

  const wordmark = branding.logoText.trim() || branding.siteName;

  /*
   * The project's own icon, shipped in `public/`, is the default mark.
   *
   * A generated letter tile is the right fallback only once an operator has
   * rebranded the installation and removed the logo deliberately. Out of the
   * box it makes a finished product look unfinished, so the bundled icon stands
   * in until the CMS has something better.
   */
  const src = assetId ? `/api/attachments/${assetId}` : DEFAULT_MARK;

  const mark = src ? (
    /*
     * A plain <img>: attachments are user-uploaded bytes behind a
     * cookie-authenticated endpoint, and next/image would have to re-fetch them
     * server-side, without the session, to optimise them.
     */
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className="tf-brand__mark"
      src={src}
      // Sized up front so the header does not reflow when the logo lands.
      width={30}
      height={30}
      alt=""
    />
  ) : (
    <span
      className="tf-brand__mark"
      aria-hidden="true"
      style={{
        display: 'grid',
        placeItems: 'center',
        background: branding.primaryColor,
        // The token antd uses for text on a solid brand fill, so this stays
        // legible if an administrator picks a pale primary colour.
        color: token.colorTextLightSolid,
        borderRadius: Math.max(branding.borderRadius, 6),
        fontSize: '0.95rem',
        fontWeight: 700,
        lineHeight: 1,
      }}
    >
      {wordmark.charAt(0).toUpperCase() || 'T'}
    </span>
  );

  const content = (
    <>
      {mark}
      <span style={showName ? undefined : VISUALLY_HIDDEN}>{wordmark}</span>
    </>
  );

  if (href === null) {
    return <span className="tf-brand">{content}</span>;
  }

  return (
    <Link className="tf-brand" href={href}>
      {content}
    </Link>
  );
}
