import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { SESSION_REJECTED_PARAM } from '@/proxy';
import { AppShell } from '@/components/layout/AppShell';
import { getCurrentUser, getPublicSettings } from '@/lib/server-api';
import { FALLBACK_SETTINGS } from '@/lib/settings-defaults';

/**
 * `noindex` for the whole subtree. The control panel is behind a session, so a
 * crawler could never read it anyway. A 302 to /login is still a URL, though,
 * and there is no reason for it to appear in anyone's search results.
 */
export const metadata: Metadata = {
  title: 'Control panel',
  robots: { index: false, follow: false, nocache: true },
};

/**
 * Every screen below reads per-request session data, so none of it can be
 * statically rendered or shared between users.
 */
export const dynamic = 'force-dynamic';

/**
 * The control panel is part of the app, not a separate console.
 *
 * It renders the same `AppShell` the rest of the signed-in app does rather than
 * living inside the `(app)` route group, because `/admin` sits outside that
 * folder and so inherits none of its layout. Rendering the shell here is the
 * cheaper of the two ways to get one sidebar everywhere; the cost is this small
 * duplication of the user and settings load, which `cache()` in `server-api.ts`
 * already collapses to a single request per render.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();

  if (!user) {
    // Carries the marker for the same reason as the app layout: without it a
    // stale cookie ping-pongs between here and the proxy forever.
    redirect(`/login?${SESSION_REJECTED_PARAM}=1`);
  }

  /*
   * A second gate, not the gate. `requireAuth` + `requirePrivileged` on the API
   * is what actually protects the data; this redirect exists so a signed-in
   * standard user gets their dashboard back instead of a panel full of
   * permission errors.
   */
  if (user.role !== 'root' && user.role !== 'admin') {
    redirect('/dashboard');
  }

  const settings = (await getPublicSettings()) ?? FALLBACK_SETTINGS;

  return (
    <AppShell user={user} branding={settings.branding}>
      {children}
    </AppShell>
  );
}
