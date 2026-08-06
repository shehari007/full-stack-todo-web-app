'use client';

import { Empty } from 'antd';

/**
 * Shown when an administrator has enabled a legal page but never written it.
 *
 * The alternative (rendering an empty page, or nothing at all) reads as a
 * broken link, and a visitor who followed "Privacy Policy" from the footer
 * deserves to be told the difference between "not published" and "not working".
 */
export function LegalEmptyState({ title, contactEmail }: { title: string; contactEmail: string }) {
  return (
    <Empty
      image={Empty.PRESENTED_IMAGE_SIMPLE}
      styles={{ image: { height: 72 } }}
      description={
        <span>
          {`An administrator has not published the ${title.toLowerCase()} for this site yet.`}
          {contactEmail ? (
            <>
              {' '}
              You can request a copy from <a href={`mailto:${contactEmail}`}>{contactEmail}</a>.
            </>
          ) : null}
        </span>
      }
    />
  );
}
