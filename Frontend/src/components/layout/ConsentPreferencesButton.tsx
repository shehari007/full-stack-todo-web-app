'use client';

/**
 * The one interactive control in an otherwise server-rendered footer.
 *
 * It talks to the consent banner by dispatching a window event rather than
 * sharing state: the banner is mounted by the root layout, several levels above
 * the footer, so anything else would mean threading a context through the whole
 * tree to reopen one dialog.
 */
export function ConsentPreferencesButton({ className }: { className?: string }) {
  return (
    <button
      type="button"
      className={className}
      onClick={() => window.dispatchEvent(new CustomEvent('taskflow:open-consent'))}
    >
      Cookie preferences
    </button>
  );
}
