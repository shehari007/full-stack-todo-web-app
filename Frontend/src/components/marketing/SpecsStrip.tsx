/**
 * The specification strip.
 *
 * Every figure here is a fact about the code in this repository, not a claim
 * about how it compares to anything else. There are no benchmarks, because none
 * have been run; no customer logos, because there are none to show; and no
 * testimonials. An open-source project's front page is read by people who can
 * go and check, and being caught inventing a number costs far more than the
 * number was ever worth.
 *
 * Sources, in order: `limitsDefaults` in the settings registry, the
 * `EXPORT_FORMATS` enum, the MFA service, the analytics module, the database
 * driver, and the LICENSE file at the repository root.
 */
const SPECS: Array<{ value: string; label: string; note: string }> = [
  {
    value: '1 MB',
    label: 'Attachment limit',
    note: 'Per file, out of the box. Administrators get 5 MB. Both numbers, and the 25 MB per-account quota, are editable from the control panel.',
  },
  {
    value: '6',
    label: 'Export formats',
    note: 'PDF, CSV, XLSX, JSON, Markdown and ICS, all produced from whatever filter is on the list at the time.',
  },
  {
    value: 'TOTP',
    label: 'Multi-factor auth',
    note: 'Standard authenticator codes, ten single-use recovery codes, and a session list you can revoke from one entry at a time.',
  },
  {
    value: 'First-party',
    label: 'Analytics',
    note: 'Page views counted by this installation and nothing else. No third-party script, no cross-site identifier, and Do Not Track is honoured.',
  },
  {
    value: 'PostgreSQL',
    label: 'The only datastore',
    note: 'Tasks, files, sessions, settings and audit records all live in one database. No Redis, no object store, no queue to keep running.',
  },
  {
    value: 'MIT',
    label: 'Licence',
    note: 'Read it, run it, fork it, change it. Commercial use included. There is no paid tier above this one, because there is no tier.',
  },
];

export function SpecsStrip() {
  return (
    <section className="tf-lp__section" aria-labelledby="specs-heading">
      <div className="tf-container">
        <div className="tf-lp__head">
          <p className="tf-lp__kicker">The specifics</p>
          <h2 id="specs-heading" className="tf-lp__h2">
            Numbers you can go and check
          </h2>
          <p className="tf-lp__lede">
            Defaults taken from the source, not figures written for a landing page. Each one is
            either a constant in the code or a value you can change yourself.
          </p>
        </div>

        {/* See `HowItWorks`: `list-style: none` costs a list its semantics in
            WebKit, and `role="list"` buys them back. */}
        <ul className="tf-lp__specs" role="list">
          {SPECS.map((spec) => (
            <li key={spec.label} className="tf-lp__spec">
              <p className="tf-lp__spec-value">{spec.value}</p>
              <p className="tf-lp__spec-label">{spec.label}</p>
              <p className="tf-lp__spec-note">{spec.note}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
