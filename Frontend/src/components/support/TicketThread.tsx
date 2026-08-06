'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import useSWR, { useSWRConfig } from 'swr';
import { Alert, App, Button, Card, Input, Space, Tag, Tooltip, Typography, theme } from 'antd';
import { ArrowLeftOutlined, ReloadOutlined, SendOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { ApiError, api, swrFetcher } from '@/lib/api';
import { useAuth } from '@/providers/AuthProvider';
import {
  TICKET_PRIORITY_META,
  TICKET_STATUS_META,
  UNREAD_COUNT_KEY,
  isTicketClosed,
  ticketDetailPath,
  ticketReference,
  type TicketDetailResponse,
  type TicketMessage,
} from '@/components/support/ticket-meta';

dayjs.extend(relativeTime);

const ABSOLUTE_FORMAT = 'D MMM YYYY, HH:mm';
const MAX_REPLY_LENGTH = 5000;

/*
 * Thread layout.
 *
 * Written as CSS rather than inline styles because the distinction between a
 * staff reply and the requester's own message is carried by three things at
 * once (which side it sits on, the bubble it sits in, and the tag above it),
 * and keeping them in one block is what stops a later edit dropping one.
 *
 * The colours arrive as custom properties set from the Ant Design token, so
 * they follow the primary colour an administrator picks in Branding and the
 * different tint the algorithm produces for it in dark mode.
 */
const THREAD_CSS = `
.tf-thread {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  list-style: none;
  margin: 0;
  padding: 0;
}
.tf-thread__msg {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  max-width: min(46rem, 92%);
}
.tf-thread__msg--staff { align-self: flex-start; align-items: flex-start; }
.tf-thread__msg--own { align-self: flex-end; align-items: flex-end; }

.tf-thread__meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.8rem;
  color: var(--tf-text-muted);
  padding-inline: 0.2rem;
}

.tf-thread__bubble {
  width: 100%;
  border: 1px solid var(--tf-border);
  border-radius: 12px;
  padding: 0.7rem 0.85rem;
  background: var(--tf-thread-own-bg);
}
.tf-thread__msg--staff .tf-thread__bubble {
  background: var(--tf-thread-staff-bg);
  border-color: var(--tf-thread-staff-border);
}

/* The author's own line breaks are part of what they wrote: a stack trace or a
   list of steps is unreadable reflowed into one paragraph. Breaking anywhere is
   what keeps an unbroken 200-character URL from widening the whole page. */
.tf-thread__body {
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  line-height: 1.6;
  color: var(--tf-text);
}
`;

/* -------------------------------------------------------------------------- */
/* One message                                                                */
/* -------------------------------------------------------------------------- */

function Message({ message }: { message: TicketMessage }) {
  const staff = message.isStaff;
  const author = message.authorName?.trim() || (staff ? 'Support' : 'You');

  return (
    <li className={`tf-thread__msg tf-thread__msg--${staff ? 'staff' : 'own'}`}>
      <div className="tf-thread__meta">
        <Typography.Text strong style={{ fontSize: '0.8rem' }}>
          {author}
        </Typography.Text>

        {staff ? (
          /* The tag is what says "this is the support team" without relying on
             which side of the thread the bubble happens to be on. */
          <Tag color="processing" variant="filled" style={{ marginInlineEnd: 0 }}>
            Support
          </Tag>
        ) : null}

        <Tooltip title={dayjs(message.createdAt).format(ABSOLUTE_FORMAT)}>
          {/* The exact time is on the element itself as well as in the tooltip:
              a tooltip needs a hover, and touch users do not have one. */}
          <time
            dateTime={message.createdAt}
            title={dayjs(message.createdAt).format(ABSOLUTE_FORMAT)}
            suppressHydrationWarning
          >
            {dayjs(message.createdAt).fromNow()}
          </time>
        </Tooltip>
      </div>

      <div className="tf-thread__bubble">
        {/*
          Rendered as a text child, never as HTML. React escapes it on the way
          out, so a message containing markup is displayed rather than executed.
          That matters most for staff replies, since those are written by
          somebody other than the person reading them.
        */}
        <p className="tf-thread__body">{message.body}</p>
      </div>
    </li>
  );
}

/* -------------------------------------------------------------------------- */
/* Thread                                                                     */
/* -------------------------------------------------------------------------- */

export function TicketThread({
  ticketId,
  initial,
}: {
  ticketId: string;
  initial: TicketDetailResponse | null;
}) {
  const { message: toast, modal } = App.useApp();
  const { user } = useAuth();
  const { token } = theme.useToken();
  const { mutate: globalMutate } = useSWRConfig();

  const { data, error, isLoading, isValidating, mutate } = useSWR<TicketDetailResponse>(
    ticketDetailPath(ticketId),
    swrFetcher,
    initial ? { fallbackData: initial } : undefined,
  );

  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [changingStatus, setChangingStatus] = useState(false);

  const ticket = data?.ticket ?? null;

  /*
   * Reading the thread is what clears the unread flag, server-side. The sidebar
   * badge is a separate cache entry, so it has to be told to refetch or it keeps
   * advertising a reply the user is currently looking at.
   */
  useEffect(() => {
    if (ticket?.unread) {
      void globalMutate(UNREAD_COUNT_KEY);
    }
  }, [ticket?.unread, globalMutate]);

  if (error && !ticket) {
    const notFound = error instanceof ApiError && (error.status === 404 || error.status === 403);

    return (
      <Alert
        type={notFound ? 'warning' : 'error'}
        showIcon
        message={notFound ? 'That ticket is not available' : 'Could not load that ticket'}
        description={
          notFound
            ? 'It may have been removed, or it belongs to somebody else.'
            : error instanceof ApiError
              ? error.message
              : 'The API did not answer.'
        }
        action={
          <Link href="/support">
            <Button size="small">Back to support</Button>
          </Link>
        }
      />
    );
  }

  const messages = data?.messages ?? [];
  const closed = ticket ? isTicketClosed(ticket) : false;

  async function sendReply() {
    const body = draft.trim();
    if (!body) return;

    // Captured before the refetch: the API reopens a closed or resolved ticket
    // when a message lands on it, so by the time `mutate()` resolves the thread
    // is already `open` and there is nothing left to say "reopened" about.
    const wasClosed = closed;

    setSending(true);
    try {
      await api.post(`/api/support/tickets/${encodeURIComponent(ticketId)}/messages`, { body });
      setDraft('');
      await mutate();
      if (wasClosed) toast.success('Reply sent. The ticket is open again.');
    } catch (replyError) {
      toast.error(
        replyError instanceof ApiError ? replyError.message : 'Could not send that reply',
      );
    } finally {
      setSending(false);
    }
  }

  /**
   * The only ticket change the API accepts from a requester.
   *
   * `PATCH /api/support/tickets/:id` routes a non-staff caller through
   * `closeOwnTicket`, which refuses any body that is not exactly
   * `{ status: 'closed' }`, including `{ status: 'open' }`. There is no reopen
   * endpoint for the person who asked; replying is the reopen, and the composer
   * below says so.
   */
  async function closeTicket() {
    setChangingStatus(true);
    try {
      await api.patch(`/api/support/tickets/${encodeURIComponent(ticketId)}`, {
        status: 'closed',
      });
      await mutate();
      toast.success('Ticket closed');
    } catch (statusError) {
      toast.error(
        statusError instanceof ApiError ? statusError.message : 'Could not close that ticket',
      );
    } finally {
      setChangingStatus(false);
    }
  }

  function confirmClose() {
    modal.confirm({
      title: 'Close this ticket?',
      content:
        'The support team stops treating it as waiting for an answer. You can reopen it yourself at any time, and the whole conversation is kept either way.',
      okText: 'Close ticket',
      cancelText: 'Keep it open',
      onOk: () => closeTicket(),
    });
  }

  const statusMeta = ticket ? TICKET_STATUS_META[ticket.status] : null;
  const priorityMeta = ticket ? TICKET_PRIORITY_META[ticket.priority] : null;
  const StatusIcon = statusMeta?.icon;
  const PriorityIcon = priorityMeta?.icon;

  return (
    <div
      className="tf-stack"
      style={
        {
          gap: '1.25rem',
          '--tf-thread-staff-bg': token.colorPrimaryBg,
          '--tf-thread-staff-border': token.colorPrimaryBorder,
          '--tf-thread-own-bg': token.colorFillQuaternary,
        } as React.CSSProperties
      }
    >
      <style href="tf-support-thread" precedence="medium">
        {THREAD_CSS}
      </style>

      <div>
        <Link href="/support">
          <Button type="link" size="small" icon={<ArrowLeftOutlined />} style={{ paddingInline: 0 }}>
            All tickets
          </Button>
        </Link>
      </div>

      <header className="tf-page-header" style={{ marginBottom: 0 }}>
        <div style={{ minWidth: 0 }}>
          <Typography.Text className="tf-muted" style={{ fontVariantNumeric: 'tabular-nums' }}>
            {ticket ? ticketReference(ticket.number) : 'Ticket'}
          </Typography.Text>
          <Typography.Title
            level={1}
            style={{ fontSize: '1.5rem', margin: '0.1rem 0 0.5rem', overflowWrap: 'anywhere' }}
          >
            {ticket?.subject ?? 'Loading...'}
          </Typography.Title>

          <Space size={6} wrap>
            {statusMeta && StatusIcon ? (
              <Tooltip title={statusMeta.hint}>
                <Tag color={statusMeta.color} icon={<StatusIcon />} style={{ marginInlineEnd: 0 }}>
                  {statusMeta.label}
                </Tag>
              </Tooltip>
            ) : null}

            {/*
              Priority and assignment are shown but never editable here. A
              requester may not change either (the API refuses it whatever this
              component renders), so offering the control would only be a way to
              be told no.
            */}
            {priorityMeta && PriorityIcon ? (
              <Tooltip title="Set by the support team when they triage the ticket.">
                <Tag
                  color={priorityMeta.color}
                  icon={<PriorityIcon />}
                  style={{ marginInlineEnd: 0 }}
                >
                  {priorityMeta.label} priority
                </Tag>
              </Tooltip>
            ) : null}

            {ticket ? <Tag style={{ marginInlineEnd: 0 }}>{ticket.category}</Tag> : null}

            {ticket ? (
              <Typography.Text className="tf-muted" style={{ fontSize: '0.8rem' }}>
                Opened <span suppressHydrationWarning>{dayjs(ticket.createdAt).fromNow()}</span>
              </Typography.Text>
            ) : null}
          </Space>
        </div>

        <Space wrap>
          <Button
            icon={<ReloadOutlined />}
            loading={isValidating && !isLoading}
            onClick={() => void mutate()}
          >
            Refresh
          </Button>

          {ticket && !closed ? (
            <Button loading={changingStatus} onClick={confirmClose}>
              Close ticket
            </Button>
          ) : null}
        </Space>
      </header>

      <Card loading={isLoading && messages.length === 0}>
        {messages.length === 0 && !isLoading ? (
          <Typography.Text className="tf-muted">
            This ticket has no messages yet.
          </Typography.Text>
        ) : (
          <ul className="tf-thread">
            {messages
              // Belt and braces: the API already excludes staff-only notes from a
              // requester's thread in SQL. Nothing here should ever match.
              .filter((entry) => entry.isInternal !== true)
              // Oldest first, sorted here rather than trusted from the response.
              // Unordered rows would not look like a bug, only like a confusing
              // conversation, which is the kind of defect nobody reports.
              .slice()
              .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
              .map((entry) => (
                <Message key={entry.id} message={entry} />
              ))}
          </ul>
        )}
      </Card>

      <Card title={closed ? 'Reply and reopen' : 'Reply'}>
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          {closed ? (
            /*
             * A closed ticket keeps its composer on purpose.
             *
             * There is no reopen the requester can ask for: `PATCH` accepts
             * exactly `{ status: 'closed' }` from a non-staff caller and 403s on
             * everything else, so a "Reopen ticket" button here would be a
             * control whose only outcome is an error. What the API does support
             * is reopening on reply: `addTicketMessage` puts a closed or
             * resolved ticket back to `open` when a message lands on it. The
             * reply box is therefore the reopen, and this says so before it is
             * used.
             */
            <Alert
              type="info"
              showIcon
              message="This ticket is closed"
              description={
                <>
                  It was closed
                  {ticket?.closedAt ? (
                    <>
                      {' '}
                      <span suppressHydrationWarning>{dayjs(ticket.closedAt).fromNow()}</span>
                    </>
                  ) : null}
                  . Sending a reply reopens it and puts it back in front of the support
                  team. Everything above is kept either way.
                </>
              }
            />
          ) : null}

          <Input.TextArea
            rows={4}
            value={draft}
            maxLength={MAX_REPLY_LENGTH}
            showCount
            disabled={sending || !ticket}
            aria-label="Write a reply"
            placeholder="Add anything that might help: what you tried, and what happened."
            onChange={(event) => setDraft(event.target.value)}
          />

          <Space wrap style={{ justifyContent: 'space-between', width: '100%' }}>
            <Typography.Text className="tf-muted" style={{ fontSize: '0.8rem' }}>
              Replying as {user?.displayName?.trim() || user?.username}.
            </Typography.Text>

            <Button
              type="primary"
              icon={<SendOutlined />}
              loading={sending}
              disabled={draft.trim().length === 0}
              onClick={() => void sendReply()}
            >
              {closed ? 'Reply and reopen' : 'Send reply'}
            </Button>
          </Space>
        </Space>
      </Card>
    </div>
  );
}
