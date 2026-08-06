import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getCurrentUser, serverGet } from '@/lib/server-api';
import { ProfileView, type ProfileStats } from '@/components/profile/ProfileView';

export const metadata: Metadata = {
  title: 'Profile',
  description: 'Your display name, photo, time zone and storage usage.',
  // A signed-in page has nothing to offer a crawler and should never be indexed.
  robots: { index: false, follow: false },
};

export default async function ProfilePage() {
  const user = await getCurrentUser();

  /*
   * The middleware already bounces cookie-less requests, so reaching this means
   * the cookie exists but no longer authenticates: an expired or revoked
   * session. Same destination, different reason.
   */
  if (!user) redirect('/login?next=%2Fprofile');

  // Fetched here rather than in the client component so the storage meter is
  // filled in on the first paint instead of animating up from zero.
  const stats = await serverGet<{ stats: ProfileStats }>('/api/profile/stats');

  return (
    // `tf-container` for the max width and centring only: `tf-shell__content`
    // already pads this region, and keeping the class's own inline padding as
    // well costs 64px of a 360px screen. Same as `(app)/tasks/page.tsx`.
    <div className="tf-container" style={{ paddingInline: 0 }}>
      <ProfileView initialUser={user} initialStats={stats?.stats ?? null} />
    </div>
  );
}
