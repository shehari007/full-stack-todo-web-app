import {
  CheckCircleOutlined,
  CheckSquareOutlined,
  ControlOutlined,
  FilePdfOutlined,
  PaperClipOutlined,
  SafetyCertificateOutlined,
} from '@/components/icons';
import {
  AdminVisual,
  AttachmentsVisual,
  ExportsVisual,
  SecurityVisual,
  TasksVisual,
} from '@/components/marketing/FeatureVisuals';

interface FeatureSectionProps {
  /** Short slug. The section answers to both `#slug` and `#feature-slug`. */
  id: string;
  kicker: string;
  title: string;
  icon: React.ReactNode;
  bullets: string[];
  visual: React.ReactNode;
  /** Puts the visual on the left. Only takes effect once there are two columns. */
  flip?: boolean;
  alt?: boolean;
  children: React.ReactNode;
}

function FeatureSection({
  id,
  kicker,
  title,
  icon,
  bullets,
  visual,
  flip = false,
  alt = false,
  children,
}: FeatureSectionProps) {
  const classes = ['tf-lp__section'];
  if (alt) classes.push('tf-lp__section--alt');

  return (
    /*
     * Two anchors for one section. `PublicHeader` links to `/#feature-tasks`,
     * so that has to be the id it lands on; `#tasks` is kept alongside it
     * because it is the shorter, more obvious address to type or to write into
     * a README, and an anchor that silently scrolls nowhere is worse than a
     * duplicate element.
     */
    <section id={`feature-${id}`} className={classes.join(' ')} aria-labelledby={`${id}-heading`}>
      <span id={id} className="tf-lp__anchor" aria-hidden="true" />
      <div className="tf-container">
        <div className={flip ? 'tf-lp__split tf-lp__split--flip' : 'tf-lp__split'}>
          <div className="tf-lp__split-copy">
            <span className="tf-lp__badge" aria-hidden="true">
              {icon}
            </span>
            <p className="tf-lp__kicker">{kicker}</p>
            <h2 id={`${id}-heading`} className="tf-lp__h2">
              {title}
            </h2>

            <div className="tf-lp__lede">{children}</div>

            {/* `role="list"` because `list-style: none` drops list semantics in
                WebKit, and the count of features is the point of the list. */}
            <ul className="tf-lp__bullets" role="list">
              {bullets.map((bullet) => (
                <li key={bullet}>
                  <CheckCircleOutlined aria-hidden="true" />
                  <span>{bullet}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="tf-lp__split-visual">{visual}</div>
        </div>
      </div>
    </section>
  );
}

/**
 * The five feature sections, in the order the public header's menu lists them.
 *
 * The copy states what each feature does and why it was built that way. It is
 * checked against the code it describes: the limits are the defaults in the
 * settings registry, the export list is the `EXPORT_FORMATS` enum, the token
 * scopes are the whole of `TOKEN_SCOPES`. If one of those changes, this text is
 * wrong and has to change with it.
 *
 * The outer `#features` wrapper keeps the older anchor alive. Nothing in the
 * current header uses it, but it was the landing page's only feature anchor
 * until now and it will be sitting in bookmarks and in other people's links.
 */
export function FeatureSections({ siteName }: { siteName: string }) {
  return (
    <div id="features">
      <FeatureSection
        id="tasks"
        kicker="Tasks"
        title="A task that carries its own context"
        icon={<CheckSquareOutlined />}
        visual={<TasksVisual />}
        bullets={[
          'Four priorities and three statuses, each labelled in words as well as colour, so neither depends on you being able to tell orange from red',
          'Overdue, due today, completed this week, completion rate and current streak, all computed from your own history and none of them a guess',
          'Multi-select for bulk changes, and duplicate on any task for the work that repeats',
        ]}
      >
        <p>
          Every task holds a title, an optional description, a status of to do, in progress or done,
          one of four priorities, an optional due date, free-form tags and a position you set by
          hand. The list narrows on all of those at once, including a plain &ldquo;only what is
          overdue&rdquo;, and sorts by newest, due date, priority, title or your own order.
        </p>
        <p>
          Filter state lives in the query string rather than in component state, which is a decision
          rather than a shortcut. The server renders the first page from exactly the parameters the
          browser is about to ask for again, so a shared link arrives with its rows already drawn
          instead of flashing an unfiltered list and then correcting itself. It also means every
          view you build is a URL you can bookmark, pin or send to someone.
        </p>
      </FeatureSection>

      <FeatureSection
        id="attachments"
        kicker="Attachments"
        title="Files that stay in your own database"
        icon={<PaperClipOutlined />}
        visual={<AttachmentsVisual />}
        flip
        alt
        bullets={[
          '1 MB per file by default, and 5 MB for administrators',
          '10 files per task and 25 MB per account to start with, and every one of those numbers is editable from the control panel',
          'Image dimensions are recorded at upload, so the interface can size a placeholder before the file is decoded',
        ]}
      >
        <p>
          Attachments are stored as bytes in PostgreSQL, in the same database and the same backup as
          the task they belong to. There is no object store to provision, no bucket policy to get
          wrong and no signed URL to expire at an inconvenient moment. Deleting a task deletes its
          files with it, because the foreign key cascades rather than leaving orphans for a cleanup
          job to find months later.
        </p>
        <p>
          Every upload is checked twice: against an allowlist of content types (an allowlist, not a
          blocklist) and then against the file&rsquo;s actual leading bytes, so renaming a script to
          photo.png does not get it through the door. The contents are hashed with SHA-256 and
          that digest is served as the ETag, so a browser re-downloads a file only when it has
          genuinely changed. SVG uploads are served as downloads rather than rendered, because an
          SVG can carry script.
        </p>
      </FeatureSection>

      <FeatureSection
        id="exports"
        kicker="Exports"
        title="Six formats, driven by the filter you already set"
        icon={<FilePdfOutlined />}
        visual={<ExportsVisual />}
        bullets={[
          'ICS turns your due dates into calendar events, so they land in the calendar you already use',
          'PDF through PDFKit and XLSX through a spreadsheet writer, so there is no headless browser to install, run or keep alive',
          'The whole feature sits behind a flag, so an operator who does not want it can switch it off',
        ]}
      >
        <p>
          Any view of your tasks leaves as a typeset A4 PDF, CSV, XLSX, JSON, Markdown or ICS. The
          PDF is a real report rather than a print stylesheet: a letterhead carrying your site name,
          the summary figures, and a paginated table whose &ldquo;page 2 of 7&rdquo; footers are
          stamped only after the last row is placed, because until then nobody knows what the total
          is.
        </p>
        <p>
          The export endpoint extends the task list&rsquo;s own filter schema instead of restating
          it. The two therefore cannot drift apart about what a filter means, and anything added to
          the list becomes exportable without someone remembering to mirror it. Paging parameters
          are dropped on the way through: an export is always the whole matching set, never the
          twenty rows you happened to be looking at.
        </p>
      </FeatureSection>

      <FeatureSection
        id="security"
        kicker="Security"
        title="Security you can read for yourself"
        icon={<SafetyCertificateOutlined />}
        visual={<SecurityVisual />}
        flip
        alt
        bullets={[
          'Every privileged action lands in an audit trail: who did it, what to, from which address, and when',
          'Root and admin are genuinely different: the policy settings are root-only, so an administrator cannot lift the MFA requirement that constrains them',
          'None of this has to be taken on trust. It is MIT licensed, and you can read the file that does it',
        ]}
      >
        <p>
          Passwords are hashed with Argon2id at the OWASP baseline (19 MiB of memory, two passes)
          rather than with bcrypt, because Argon2id is memory-hard and an attacker with a rack of
          GPUs gains far less from them. Signing in issues a short-lived access token together with
          an HttpOnly refresh cookie paired to a CSRF token, and the authentication endpoints are
          rate limited.
        </p>
        <p>
          Two-factor authentication is TOTP, enrolled from a QR code and backed by ten single-use
          recovery codes; an operator can require every privileged account to enrol before it can
          use {siteName} at all. You can see every session signed in as you, with the address and
          browser it came from, and end any one of them on its own. Personal API tokens are
          read-only by design (the only scopes that exist are tasks:read, stats:read and
          profile:read), and the server keeps a SHA-256 digest plus the first few characters, which
          is enough to recognise a token in a list and useless to whoever steals the table.
        </p>
      </FeatureSection>

      <FeatureSection
        id="admin"
        kicker="Administration"
        title="Change the site without a redeploy"
        icon={<ControlOutlined />}
        visual={<AdminVisual />}
        bullets={[
          'Users, roles and suspensions, with a filterable audit log beside them',
          'First-party analytics: page views only, Do Not Track honoured, your own traffic excludable, and raw events deleted on a retention window you choose',
          'Maintenance mode answers everyone except root with a 503, which is exactly what you want in the middle of a migration',
        ]}
      >
        <p>
          Site name, tagline, logos, colours and corner radius. Page titles, description, keywords,
          canonical URL and search-console verification. Footer links and social profiles. The full
          text of the privacy, terms and cookie policies. Feature flags, upload limits and storage
          quotas. All of it is edited in the browser, and all of it applies on the next request.
        </p>
        <p>
          Each section is a single schema that supplies both the validation and the defaults, and
          that one definition is what makes adding a setting safe: a settings row written by an
          older version picks up the new field&rsquo;s default instead of surfacing as undefined
          somewhere in the interface. Legal copy is authored in Markdown and turned into elements by
          a small parser that never injects raw HTML, so a policy containing something that looks
          like markup is displayed as text rather than executed.
        </p>
      </FeatureSection>
    </div>
  );
}
