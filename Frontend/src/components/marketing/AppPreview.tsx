'use client';

import { Tag } from 'antd';
import {
  BorderOutlined,
  CheckCircleFilled,
  ClockCircleOutlined,
  PaperClipOutlined,
  TagOutlined,
} from '@ant-design/icons';
import { PRIORITY_META, STATUS_META, formatDateTime } from '@/components/tasks/task-utils';

/**
 * An honest mock of the task list, for the hero.
 *
 * There is no screenshot to embed, and inventing one would misrepresent the
 * product the first time it changed. This is built from the same `.tf-task`
 * classes the real list uses and from `PRIORITY_META` / `STATUS_META`, so the
 * rows are drawn by the code that draws the application. A restyle of the task
 * row restyles this too, and it cannot drift into showing a UI that does not
 * exist.
 *
 * A client component because Ant Design's `Tag` is one, and using the real Tag
 * with the real preset colours is the point: hand-rolled pills would be a
 * second, silently diverging definition of what "urgent" looks like.
 *
 * Nothing inside is focusable, which matters: the panel is `aria-hidden`, and a
 * tab stop inside hidden content is a keyboard trap with nothing to announce
 * it. That is why the leading control is an icon rather than the real
 * `Checkbox` the list uses, and why there are no links.
 */

/** Matches how `TaskItem` lays its tags out: the row supplies the gap. */
const TAG_STYLE: React.CSSProperties = { marginInlineEnd: 0 };

/*
 * Due dates run through the list's own `formatDateTime` for the same reason the
 * tags run through `PRIORITY_META`: so the rows cannot advertise a rendering the
 * product does not have. They previously read "Due today, 17:00" and "Overdue ·
 * 2 days", and the application has never produced either. `TaskItem` formats an
 * absolute en-GB instant and prints "Overdue · <that instant>". A landing page
 * promising relative dates is a promise the first screen after sign-up breaks.
 *
 * Fixed instants rather than offsets from `Date.now()`: this renders once on the
 * server and again during hydration, and anything derived from the current time
 * would differ between the two. `formatDateTime` pins the zone to UTC when it is
 * given none, so both passes agree.
 */
const DUE_AT = formatDateTime('2026-09-18T17:00:00.000Z');
const OVERDUE_AT = formatDateTime('2026-09-09T09:30:00.000Z');

export function AppPreview({ siteName }: { siteName: string }) {
  return (
    <figure className="tf-lp__preview">
      <div className="tf-lp__mock" aria-hidden="true">
        <div className="tf-lp__mock-bar">
          <span className="tf-lp__mock-dots">
            <span />
            <span />
            <span />
          </span>
          Tasks · 3 of 12 shown · sorted by due date
        </div>

        <div className="tf-lp__mock-body">
          <div className="tf-task">
            <BorderOutlined className="tf-lp__check" />
            <div className="tf-task__body">
              <p className="tf-task__title">Draft the Q3 roadmap</p>
              <div className="tf-task__meta">
                <Tag color={STATUS_META.in_progress.color} style={TAG_STYLE}>
                  {STATUS_META.in_progress.label}
                </Tag>
                <Tag color={PRIORITY_META.high.color} style={TAG_STYLE}>
                  {PRIORITY_META.high.label} priority
                </Tag>
                <span>
                  <ClockCircleOutlined /> Due {DUE_AT}
                </span>
                <Tag icon={<TagOutlined />} style={TAG_STYLE}>
                  planning
                </Tag>
                <span>
                  <PaperClipOutlined /> 2
                </span>
              </div>
            </div>
          </div>

          <div className="tf-task">
            <BorderOutlined className="tf-lp__check" />
            <div className="tf-task__body">
              <p className="tf-task__title">Review the security checklist</p>
              <div className="tf-task__meta">
                <Tag color={STATUS_META.todo.color} style={TAG_STYLE}>
                  {STATUS_META.todo.label}
                </Tag>
                <Tag color={PRIORITY_META.urgent.color} style={TAG_STYLE}>
                  {PRIORITY_META.urgent.label} priority
                </Tag>
                <Tag icon={<ClockCircleOutlined />} color="error" style={TAG_STYLE}>
                  Overdue · {OVERDUE_AT}
                </Tag>
              </div>
            </div>
          </div>

          <div className="tf-task tf-task--done">
            <CheckCircleFilled className="tf-lp__check tf-lp__check--done" />
            <div className="tf-task__body">
              <p className="tf-task__title">Send the sprint report</p>
              <div className="tf-task__meta">
                <Tag color={STATUS_META.done.color} style={TAG_STYLE}>
                  {STATUS_META.done.label}
                </Tag>
                <Tag color={PRIORITY_META.medium.color} style={TAG_STYLE}>
                  {PRIORITY_META.medium.label} priority
                </Tag>
                <Tag icon={<TagOutlined />} style={TAG_STYLE}>
                  reporting
                </Tag>
              </div>
            </div>
          </div>
        </div>
      </div>

      <figcaption className="tf-lp__sr">
        An illustration of the {siteName} task list, drawn with the application&rsquo;s own task-row
        styles. It shows three example tasks: one in progress at high priority with a due date and
        two attachments, one overdue at urgent priority, and one completed. The tasks are made up
        for this illustration.
      </figcaption>
    </figure>
  );
}
