import { CheckCircleOutlined } from '@/components/icons';

/**
 * The small panels that sit beside each feature section.
 *
 * Every one is `aria-hidden`: they restate what the prose next to them already
 * says, and none of them contains information that is not in that prose. They
 * are also built from markup rather than images, so they follow the theme, stay
 * sharp at any density and cannot go stale the way a screenshot does.
 *
 * Nothing in here is focusable. Hidden content that can take focus is a
 * keyboard trap, so the switches are drawn in CSS rather than being real
 * controls and there are no links.
 */

function Chrome({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="tf-lp__mock" aria-hidden="true">
      <div className="tf-lp__mock-bar">
        <span className="tf-lp__mock-dots">
          <span />
          <span />
          <span />
        </span>
        {label}
      </div>
      <div className="tf-lp__mock-body">{children}</div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Tasks                                                                      */
/* -------------------------------------------------------------------------- */

/** The filter row and the URL it produces: the point the copy is making. */
export function TasksVisual() {
  return (
    <Chrome label="Filters">
      <div className="tf-lp__chips">
        <span className="tf-lp__chip tf-lp__chip--on">Status: To do</span>
        <span className="tf-lp__chip tf-lp__chip--on">Overdue only</span>
        <span className="tf-lp__chip tf-lp__chip--on">Due soonest</span>
        <span className="tf-lp__chip">Priority</span>
        <span className="tf-lp__chip">Tags</span>
      </div>

      <code className="tf-lp__url">/tasks?status=todo&amp;overdue=true&amp;sort=due&amp;order=asc</code>

      <div className="tf-lp__row">
        <div className="tf-lp__row-main">
          <p className="tf-lp__row-title">Overdue</p>
          <p className="tf-lp__row-note">Counted for you, not hidden behind a filter</p>
        </div>
        <span className="tf-lp__pill">3</span>
      </div>

      <div className="tf-lp__row">
        <div className="tf-lp__row-main">
          <p className="tf-lp__row-title">Due today</p>
          <p className="tf-lp__row-note">Alongside completion rate and current streak</p>
        </div>
        <span className="tf-lp__pill">5</span>
      </div>
    </Chrome>
  );
}

/* -------------------------------------------------------------------------- */
/* Attachments                                                                */
/* -------------------------------------------------------------------------- */

/**
 * The last entry is the interesting one. A file whose name says one thing and
 * whose leading bytes say another is refused, and the real upload panel really
 * does report it in about those words, so the illustration shows the check
 * doing its job rather than three tidy rows that prove nothing.
 */
const FILES: Array<{ ext: string; name: string; note: string; pill?: string }> = [
  { ext: 'PDF', name: 'quarterly-spec.pdf', note: '842 KB · application/pdf' },
  { ext: 'PNG', name: 'wireframe.png', note: '210 KB · image/png · 1440×900' },
  {
    ext: '?',
    name: 'photo.png',
    note: 'Not a file type this installation accepts',
    pill: 'Rejected',
  },
];

export function AttachmentsVisual() {
  return (
    <Chrome label="Attachments · stored in PostgreSQL">
      {FILES.map((file) => (
        <div key={file.name} className="tf-lp__row">
          <span className="tf-lp__ext">{file.ext}</span>
          <div className="tf-lp__row-main">
            <p className="tf-lp__row-title">{file.name}</p>
            <p className="tf-lp__row-note">{file.note}</p>
          </div>
          {file.pill ? <span className="tf-lp__pill">{file.pill}</span> : null}
        </div>
      ))}

      <div className="tf-lp__row tf-lp__row--stack">
        <p className="tf-lp__row-title tf-lp__row-title--spaced">6.2 MB of 25 MB used</p>
        {/* Inline width because it is data rather than styling: the length of
            the bar is the value it represents. */}
        <div className="tf-lp__meter">
          <span style={{ width: '25%' }} />
        </div>
      </div>
    </Chrome>
  );
}

/* -------------------------------------------------------------------------- */
/* Exports                                                                    */
/* -------------------------------------------------------------------------- */

const FORMATS: Array<{ name: string; use: string }> = [
  { name: 'PDF', use: 'A4 report' },
  { name: 'CSV', use: 'Spreadsheets' },
  { name: 'XLSX', use: 'Excel' },
  { name: 'JSON', use: 'Raw records' },
  { name: 'MD', use: 'Markdown' },
  { name: 'ICS', use: 'Calendar' },
];

export function ExportsVisual() {
  return (
    <Chrome label="Export this view">
      <div className="tf-lp__formats">
        {FORMATS.map((format) => (
          <div key={format.name} className="tf-lp__format">
            <b>{format.name}</b>
            <span>{format.use}</span>
          </div>
        ))}
      </div>

      <div className="tf-lp__row">
        <div className="tf-lp__row-main">
          <p className="tf-lp__row-title">Every task matching your filter</p>
          <p className="tf-lp__row-note">Not the page you happen to be looking at</p>
        </div>
      </div>
    </Chrome>
  );
}

/* -------------------------------------------------------------------------- */
/* Security                                                                   */
/* -------------------------------------------------------------------------- */

const SECURITY_ROWS: Array<{ label: string; value: string }> = [
  { label: 'Password hashing', value: 'Argon2id' },
  { label: 'Two-factor authentication', value: 'TOTP · 10 recovery codes' },
  { label: 'Refresh cookie', value: 'HttpOnly + CSRF token' },
  { label: 'Active sessions', value: 'Listed and revocable' },
  { label: 'Personal API tokens', value: 'Read-only scopes' },
];

export function SecurityVisual() {
  return (
    <Chrome label="Security">
      {SECURITY_ROWS.map((row) => (
        <div key={row.label} className="tf-lp__row">
          <CheckCircleOutlined className="tf-lp__check tf-lp__check--done" />
          <div className="tf-lp__row-main">
            <p className="tf-lp__row-title">{row.label}</p>
            <p className="tf-lp__row-note">{row.value}</p>
          </div>
        </div>
      ))}
    </Chrome>
  );
}

/* -------------------------------------------------------------------------- */
/* Admin                                                                      */
/* -------------------------------------------------------------------------- */

/** The real flags from the features section of the settings registry. */
const FLAGS: Array<{ label: string; on: boolean }> = [
  { label: 'Public registration', on: true },
  { label: 'Attachments', on: true },
  { label: 'Exports', on: true },
  { label: 'Public landing page', on: true },
  { label: 'Maintenance mode', on: false },
];

export function AdminVisual() {
  return (
    <Chrome label="Control panel · Features">
      {FLAGS.map((flag) => (
        <div key={flag.label} className="tf-lp__row">
          <div className="tf-lp__row-main">
            <p className="tf-lp__row-title">{flag.label}</p>
          </div>
          <span className={flag.on ? 'tf-lp__switch tf-lp__switch--on' : 'tf-lp__switch'}>
            <span />
          </span>
        </div>
      ))}

      <p className="tf-lp__row-note tf-lp__mock-foot">
        Saved to the database and live on the next request. No redeploy.
      </p>
    </Chrome>
  );
}
