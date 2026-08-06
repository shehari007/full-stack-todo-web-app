'use client';

import { Alert } from 'antd';

/**
 * The "the API did not answer" state for a server-rendered admin screen.
 *
 * A client component because Ant Design is client-only, and the server pages
 * that need this cannot render an `<Alert>` themselves.
 */
export function LoadError({
  what,
  description = 'Editing an empty form would overwrite the live values with blanks, so the form is not shown. Reload once the API is reachable.',
}: {
  what: string;
  description?: string;
}) {
  return (
    <Alert type="error" showIcon message={`Could not load the ${what}`} description={description} />
  );
}
