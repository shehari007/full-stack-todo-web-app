import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getCurrentUser, serverGet } from '@/lib/server-api';
import { SecurityView } from '@/components/profile/SecurityView';
import type { SessionInfo } from '@/types/api';

export const metadata: Metadata = {
  title: 'Security',
  description: 'Password, two-factor authentication and signed-in devices.',
  robots: { index: false, follow: false },
};

export default async function SecuritySettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login?next=%2Fsettings%2Fsecurity');

  // Seeds the SWR cache on the client, so the device list is populated before
  // any browser-side request happens.
  const sessions = await serverGet<{ sessions: SessionInfo[] }>('/api/auth/sessions');

  return (
    // `tf-container` for the max width and centring only: `tf-shell__content`
    // already pads this region, and keeping the class's own inline padding as
    // well costs 64px of a 360px screen. Same as `(app)/tasks/page.tsx`.
    <div className="tf-container" style={{ paddingInline: 0 }}>
      <SecurityView user={user} initialSessions={sessions?.sessions ?? []} />
    </div>
  );
}
