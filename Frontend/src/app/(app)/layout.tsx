import { redirect } from 'next/navigation';
import { SESSION_REJECTED_PARAM } from '@/proxy';
import { AppShell } from '@/components/layout/AppShell';
import { getCurrentUser, getPublicSettings } from '@/lib/server-api';
import { FALLBACK_SETTINGS } from '@/lib/settings-defaults';

/**
 * The signed-in half of the app.
 *
 * `middleware.ts` already bounces visitors with no session cookie, but that is a
 * cookie-presence check running on the edge, so it cannot tell a valid session
 * from a forged one. This is the check that actually asks the API who the caller
 * is, and it is also what guarantees `AppShell` always has a real user rather
 * than a nullable one.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();

  if (!user) {
    /*
     * The marker matters. `proxy.ts` sends anyone holding a session cookie here
     * on to /dashboard, so a plain `redirect('/login')` would bounce straight
     * back and loop forever whenever the cookie exists but the API rejects it.
     * The marker tells the proxy to clear those cookies instead.
     */
    redirect(`/login?${SESSION_REJECTED_PARAM}=1`);
  }

  const settings = (await getPublicSettings()) ?? FALLBACK_SETTINGS;

  return (
    <AppShell user={user} branding={settings.branding}>
      {children}
    </AppShell>
  );
}
