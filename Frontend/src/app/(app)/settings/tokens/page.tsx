import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getCurrentUser, serverGet } from '@/lib/server-api';
import { TokensView, type TokensResponse } from '@/components/tokens/TokensView';

export const metadata: Metadata = {
  title: 'API tokens',
  description: 'Read-only tokens for reaching your own tasks from outside TaskFlow.',
  robots: { index: false, follow: false },
};

export default async function ApiTokensPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login?next=%2Fsettings%2Ftokens');

  // Seeds the SWR cache, so the list is on screen before any browser request
  // happens. Null when the API is unreachable. The client then shows its own
  // error rather than an empty list that would read as "you have no tokens".
  // Passed whole rather than just `tokens`, because the same response carries
  // the scope list the create form is built from.
  const initial = await serverGet<TokensResponse>('/api/tokens');

  return (
    // `tf-container` for the max width and centring only: `tf-shell__content`
    // already pads this region, and keeping the class's own inline padding as
    // well costs 64px of a 360px screen. Same as `(app)/settings/security`.
    <div className="tf-container" style={{ paddingInline: 0 }}>
      <TokensView initial={initial} />
    </div>
  );
}
