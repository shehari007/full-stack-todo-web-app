'use client';

import { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import {
  Alert,
  App,
  Avatar,
  Button,
  Card,
  Col,
  Descriptions,
  Divider,
  Input,
  Row,
  Select,
  Space,
  Tag,
  Tooltip,
  Typography,
  theme,
} from 'antd';
import {
  ArrowLeftOutlined,
  EyeInvisibleOutlined,
  LockOutlined,
  PaperClipOutlined,
  ReloadOutlined,
  SendOutlined,
  UserOutlined,
  UserSwitchOutlined,
} from '@ant-design/icons';
import { ApiError, api, swrFetcher } from '@/lib/api';
import { describeUserAgent } from '@/components/profile/SessionList';
import { formatBytes } from '@/components/admin/format';
import {
  TICKET_PRIORITY_META,
  TICKET_STATUSES,
  TICKET_STATUS_META,
  isTicketClosed,
  ticketDetailPath,
  ticketReference,
  type TicketPriority,
  type TicketStatus,
} from '@/components/support/ticket-meta';
import {
  staffStatusLabel,
  type AdminUsersResponse,
  type StaffTicketMessage,
  type StaffTicketRow,
  type StaffTicketThreadResponse,
} from '@/components/admin/admin-types';

dayjs.extend(relativeTime);

const TICKET_PRIORITIES = Object.keys(TICKET_PRIORITY_META) as TicketPriority[];

/** Same page of accounts the queue uses for its assignee filter. */
const STAFF_KEY = '/api/admin/users?page=1&pageSize=100&sort=username&order=asc';

/** Matches `contactMaxMessageLength`'s ceiling, so the counter is never a lie. */
const MAX_MESSAGE_LENGTH = 20_000;

function requesterName(ticket: StaffTicketRow): string {
  if (ticket.requester) return ticket.requester.username;
  return ticket.guestName?.trim() || ticket.guestEmail?.trim() || 'the requester';
}

function requesterEmail(ticket: StaffTicketRow): string | null {
  return ticket.requester?.email ?? ticket.guestEmail ?? null;
}

/* -------------------------------------------------------------------------- */
/* One message                                                                */
/* -------------------------------------------------------------------------- */

function MessageBlock({ message }: { message: StaffTicketMessage }) {
  const { token } = theme.useToken();
  const internal = message.isInternal === true;

  return (
    <article
      style={{
        padding: '0.85rem 1rem',
        borderRadius: 12,
        border: `1px solid ${internal ? token.colorWarningBorder : 'var(--tf-border)'}`,
        background: internal ? token.colorWarningBg : 'var(--tf-surface)',
        // The accent restates staff-vs-requester for anyone who cannot pick the
        // tag out of the header line.
        borderInlineStartWidth: message.isStaff ? 3 : 1,
        borderInlineStartColor: internal
          ? token.colorWarning
          : message.isStaff
            ? token.colorPrimary
            : 'var(--tf-border)',
      }}
    >
      <Space size={8} wrap style={{ marginBottom: 6 }}>
        <Typography.Text strong>{message.authorName ?? 'Deleted account'}</Typography.Text>

        {message.isStaff ? <Tag color="blue">Support</Tag> : null}

        {internal ? (
          <Tag color="warning" icon={<LockOutlined />}>
            Internal note: the requester cannot see this
          </Tag>
        ) : null}

        <Tooltip title={dayjs(message.createdAt).format('dddd D MMMM YYYY, HH:mm')}>
          <Typography.Text className="tf-muted" style={{ fontSize: 12 }} suppressHydrationWarning>
            {dayjs(message.createdAt).fromNow()}
          </Typography.Text>
        </Tooltip>
      </Space>

      {/* Plain text, never markup: this is whatever a stranger typed into a
          public form, so it is rendered as a text node and nothing else. */}
      <Typography.Paragraph
        style={{ marginBottom: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}
      >
        {message.body}
      </Typography.Paragraph>

      {message.attachments && message.attachments.length > 0 ? (
        <Space direction="vertical" size={2} style={{ marginTop: 10 }}>
          {message.attachments.map((file) => (
            <a
              key={file.id}
              href={`/api/attachments/${file.id}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{ fontSize: 13 }}
            >
              <PaperClipOutlined aria-hidden /> {file.filename}{' '}
              <span className="tf-muted">({formatBytes(file.byteSize)})</span>
            </a>
          ))}
        </Space>
      ) : null}
    </article>
  );
}

/* -------------------------------------------------------------------------- */
/* Thread                                                                     */
/* -------------------------------------------------------------------------- */

interface Props {
  ticketId: string;
  initial: StaffTicketThreadResponse;
  actor: { id: string; username: string };
}

export function StaffTicketThread({ ticketId, initial, actor }: Props) {
  const { message: toast } = App.useApp();
  const { token } = theme.useToken();

  const [reply, setReply] = useState('');
  const [note, setNote] = useState('');
  const [sendingReply, setSendingReply] = useState(false);
  const [savingNote, setSavingNote] = useState(false);
  const [updating, setUpdating] = useState(false);

  const key = ticketDetailPath(ticketId);

  const { data, error, isValidating, mutate } = useSWR<StaffTicketThreadResponse>(key, swrFetcher, {
    fallbackData: initial,
  });

  const { data: staffPage } = useSWR<AdminUsersResponse>(STAFF_KEY, swrFetcher);

  const staff = useMemo(
    () => (staffPage?.users ?? []).filter((user) => user.role !== 'user'),
    [staffPage],
  );

  const ticket = data?.ticket ?? initial.ticket;
  const messages = data?.messages ?? initial.messages;

  const who = requesterName(ticket);
  const email = requesterEmail(ticket);
  const closed = isTicketClosed(ticket);

  const patchTicket = useCallback(
    async (patch: Record<string, unknown>, done: string) => {
      setUpdating(true);

      try {
        await api.patch(key, patch);
        toast.success(done);
        await mutate();
      } catch (caught) {
        toast.error(caught instanceof ApiError ? caught.message : 'Could not reach the server.');
      } finally {
        setUpdating(false);
      }
    },
    [key, mutate, toast],
  );

  const send = useCallback(
    async (body: string, isInternal: boolean) => {
      const trimmed = body.trim();
      if (!trimmed) return;

      const setBusy = isInternal ? setSavingNote : setSendingReply;
      setBusy(true);

      try {
        await api.post(`${key}/messages`, { body: trimmed, isInternal });

        if (isInternal) {
          setNote('');
          toast.success('Internal note saved. Only staff can see it.');
        } else {
          setReply('');
          toast.success(`Reply sent to ${who}.`);
        }

        await mutate();
      } catch (caught) {
        toast.error(caught instanceof ApiError ? caught.message : 'Could not reach the server.');
      } finally {
        setBusy(false);
      }
    },
    [key, mutate, toast, who],
  );

  const statusMeta = TICKET_STATUS_META[ticket.status];
  const StatusIcon = statusMeta.icon;
  const priorityMeta = TICKET_PRIORITY_META[ticket.priority];
  const PriorityIcon = priorityMeta.icon;

  const agent = ticket.userAgent ? describeUserAgent(ticket.userAgent) : null;

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <div>
        <Link href="/admin/support">
          <ArrowLeftOutlined aria-hidden /> Back to the queue
        </Link>
      </div>

      <div className="tf-page-header" style={{ marginBottom: 0 }}>
        <div style={{ minWidth: 0 }}>
          <Typography.Text className="tf-muted" style={{ fontVariantNumeric: 'tabular-nums' }}>
            {ticketReference(ticket.number)}
          </Typography.Text>
          <Typography.Title level={2} style={{ margin: 0, overflowWrap: 'anywhere' }}>
            {ticket.subject}
          </Typography.Title>
          <Space size={6} wrap style={{ marginTop: 6 }}>
            <Tooltip title={statusMeta.hint}>
              <Tag color={statusMeta.color} icon={<StatusIcon />}>
                {staffStatusLabel(ticket.status)}
              </Tag>
            </Tooltip>
            <Tag color={priorityMeta.color} icon={<PriorityIcon />}>
              {priorityMeta.label}
            </Tag>
            <Tag>{ticket.category}</Tag>
            <Tag>{ticket.source === 'contact' ? 'Contact form' : 'In-app'}</Tag>
          </Space>
        </div>

        <Button icon={<ReloadOutlined />} onClick={() => void mutate()} loading={isValidating}>
          Refresh
        </Button>
      </div>

      {error ? (
        <Alert
          type="warning"
          showIcon
          message="Could not refresh this thread"
          description="The messages below are the ones that loaded last. A reply sent now may not be recorded."
        />
      ) : null}

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={15} xl={16}>
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <Card size="small" title={`Conversation (${messages.length})`}>
              <Space direction="vertical" size={10} style={{ width: '100%' }}>
                {messages.map((entry) => (
                  <MessageBlock key={entry.id} message={entry} />
                ))}
              </Space>
            </Card>

            {closed ? (
              <Alert
                type="info"
                showIcon
                message="This thread is closed."
                description="Anything sent below still lands on the ticket. Set the status back to open if the conversation has restarted."
              />
            ) : null}

            {/* ---------------------------------------------------------------
                Public reply. Deliberately the plain surface, so the tinted,
                locked panel below it can never be mistaken for this one.
            ---------------------------------------------------------------- */}
            <Card
              size="small"
              title={
                <Space size={8}>
                  <SendOutlined aria-hidden />
                  <span>Reply to {who}</span>
                </Space>
              }
            >
              <Input.TextArea
                rows={5}
                value={reply}
                onChange={(event) => setReply(event.target.value)}
                maxLength={MAX_MESSAGE_LENGTH}
                showCount
                placeholder={`Write to ${who}...`}
                aria-label={`Public reply to ${who}`}
                disabled={sendingReply}
              />

              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '0.75rem',
                  marginTop: 12,
                }}
              >
                <Typography.Text style={{ fontSize: 13 }}>
                  Visible to <strong>{who}</strong>
                  {email ? <span className="tf-muted"> ({email})</span> : null}.
                </Typography.Text>

                <Button
                  type="primary"
                  icon={<SendOutlined />}
                  loading={sendingReply}
                  disabled={reply.trim() === ''}
                  onClick={() => void send(reply, false)}
                >
                  Send reply
                </Button>
              </div>
            </Card>

            <Divider style={{ marginBlock: 4 }}>
              <Typography.Text className="tf-muted" style={{ fontSize: 12 }}>
                Staff only below this line
              </Typography.Text>
            </Divider>

            {/* ---------------------------------------------------------------
                Internal note. The tint, the lock and the label are all carrying
                the same message on purpose: a note written here and sent as a
                reply is the mistake this screen exists to prevent, and it is not
                undoable once the requester has read it.
            ---------------------------------------------------------------- */}
            <Card
              size="small"
              style={{
                background: token.colorWarningBg,
                borderColor: token.colorWarningBorder,
              }}
            >
              <Space size={8} wrap style={{ marginBottom: 4 }}>
                <LockOutlined aria-hidden style={{ color: token.colorWarningText }} />
                <Typography.Text strong>Internal note</Typography.Text>
                <Tag color="warning" icon={<EyeInvisibleOutlined />}>
                  Only staff can see this
                </Tag>
              </Space>

              <Typography.Paragraph className="tf-muted" style={{ fontSize: 13, marginBottom: 10 }}>
                Never shown to {who}, and never included in a reply. Use it for context the next
                person on the queue needs: what you checked, what you are waiting on.
              </Typography.Paragraph>

              <Input.TextArea
                rows={3}
                value={note}
                onChange={(event) => setNote(event.target.value)}
                maxLength={MAX_MESSAGE_LENGTH}
                showCount
                placeholder="Notes for the team..."
                aria-label="Internal note, visible to staff only"
                disabled={savingNote}
                style={{ background: 'var(--tf-surface)' }}
              />

              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
                <Button
                  icon={<LockOutlined />}
                  loading={savingNote}
                  disabled={note.trim() === ''}
                  onClick={() => void send(note, true)}
                >
                  Save internal note
                </Button>
              </div>
            </Card>
          </Space>
        </Col>

        <Col xs={24} lg={9} xl={8}>
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <Card size="small" title="Triage">
              <Space direction="vertical" size={12} style={{ width: '100%' }}>
                {/* Captions are plain text with `aria-label` on the control
                    rather than a wrapping `<label>`: a click on a label forwards
                    to the input inside the combobox, which opens the dropdown
                    and closes it again in the same gesture. */}
                <div>
                  <Typography.Text style={{ fontSize: 13 }}>Status</Typography.Text>
                  <Select<TicketStatus>
                    value={ticket.status}
                    aria-label="Ticket status"
                    onChange={(value) =>
                      void patchTicket(
                        { status: value },
                        `Status set to ${staffStatusLabel(value).toLowerCase()}.`,
                      )
                    }
                    disabled={updating}
                    style={{ width: '100%', marginTop: 4 }}
                    options={TICKET_STATUSES.map((status) => ({
                      value: status,
                      label: staffStatusLabel(status),
                    }))}
                  />
                </div>

                <div>
                  <Typography.Text style={{ fontSize: 13 }}>Priority</Typography.Text>
                  <Select<TicketPriority>
                    value={ticket.priority}
                    aria-label="Ticket priority"
                    onChange={(value) =>
                      void patchTicket(
                        { priority: value },
                        `Priority set to ${TICKET_PRIORITY_META[value].label.toLowerCase()}.`,
                      )
                    }
                    disabled={updating}
                    style={{ width: '100%', marginTop: 4 }}
                    options={TICKET_PRIORITIES.map((priority) => ({
                      value: priority,
                      label: TICKET_PRIORITY_META[priority].label,
                    }))}
                  />
                </div>

                <div>
                  <Typography.Text style={{ fontSize: 13 }}>Assigned to</Typography.Text>
                  <Select<string>
                    aria-label="Assigned staff member"
                    // `null` is a real value here (it means "nobody"), so the
                    // control is driven by the empty string rather than left
                    // uncontrolled.
                    value={ticket.assignee?.id ?? ''}
                    onChange={(value) =>
                      void patchTicket(
                        { assignedToId: value === '' ? null : value },
                        value === '' ? 'Assignment cleared.' : 'Assignment updated.',
                      )
                    }
                    disabled={updating}
                    showSearch
                    optionFilterProp="label"
                    style={{ width: '100%', marginTop: 4 }}
                    options={[
                      { value: '', label: 'Unassigned' },
                      ...staff.map((user) => ({
                        value: user.id,
                        label: user.id === actor.id ? `${user.username} (you)` : user.username,
                      })),
                    ]}
                  />
                </div>

                <Button
                  icon={<UserSwitchOutlined />}
                  block
                  disabled={updating || ticket.assignee?.id === actor.id}
                  onClick={() =>
                    void patchTicket({ assignedToId: actor.id }, 'Assigned to you.')
                  }
                >
                  {ticket.assignee?.id === actor.id ? 'Assigned to you' : 'Assign to me'}
                </Button>
              </Space>
            </Card>

            <Card size="small" title="Requester">
              <Space direction="vertical" size={10} style={{ width: '100%' }}>
                <Space size={10}>
                  <Avatar
                    size={40}
                    src={
                      ticket.requester?.avatarId
                        ? `/api/attachments/${ticket.requester.avatarId}`
                        : undefined
                    }
                    icon={<UserOutlined />}
                    alt=""
                  />
                  <span style={{ minWidth: 0 }}>
                    <Typography.Text strong style={{ display: 'block' }}>
                      {who}
                    </Typography.Text>
                    {ticket.requester?.displayName ? (
                      <Typography.Text className="tf-muted" style={{ fontSize: 12 }}>
                        {ticket.requester.displayName}
                      </Typography.Text>
                    ) : null}
                  </span>
                  {ticket.requester ? null : <Tag>Guest</Tag>}
                </Space>

                {ticket.requester ? null : (
                  <Typography.Text className="tf-muted" style={{ fontSize: 12 }}>
                    No account behind this submission. The address below is the only way to answer
                    it.
                  </Typography.Text>
                )}

                <Descriptions
                  size="small"
                  column={1}
                  colon={false}
                  items={[
                    {
                      key: 'email',
                      label: 'Email',
                      children: email ? (
                        <Typography.Text copyable={{ text: email }} style={{ fontSize: 13 }}>
                          {email}
                        </Typography.Text>
                      ) : (
                        <Typography.Text className="tf-muted">Not given</Typography.Text>
                      ),
                    },
                    {
                      key: 'source',
                      label: 'Source',
                      children: ticket.source === 'contact' ? 'Public contact form' : 'In-app desk',
                    },
                    {
                      key: 'opened',
                      label: 'Opened',
                      children: (
                        <Tooltip title={dayjs(ticket.createdAt).format('D MMM YYYY, HH:mm')}>
                          <span suppressHydrationWarning>{dayjs(ticket.createdAt).fromNow()}</span>
                        </Tooltip>
                      ),
                    },
                  ]}
                />
              </Space>
            </Card>

            {/* Only a contact-form submission carries these, because an in-app
                ticket already has an account attached to it. */}
            {ticket.ipAddress || ticket.userAgent ? (
              <Card size="small" title="Submission details">
                <Typography.Paragraph className="tf-muted" style={{ fontSize: 12 }}>
                  Recorded so a wave of abuse can be traced back and blocked. Treat it as personal
                  data: it is covered by this installation&apos;s privacy policy.
                </Typography.Paragraph>

                <Descriptions
                  size="small"
                  column={1}
                  colon={false}
                  items={[
                    {
                      key: 'ip',
                      label: 'IP address',
                      children: ticket.ipAddress ? (
                        <Typography.Text
                          copyable={{ text: ticket.ipAddress }}
                          style={{ fontSize: 13, fontFamily: 'ui-monospace, monospace' }}
                        >
                          {ticket.ipAddress}
                        </Typography.Text>
                      ) : (
                        <Typography.Text className="tf-muted">Not recorded</Typography.Text>
                      ),
                    },
                    {
                      key: 'agent',
                      label: 'Browser',
                      children: ticket.userAgent ? (
                        <Tooltip title={ticket.userAgent}>
                          <span>{agent?.label ?? 'Unknown device'}</span>
                        </Tooltip>
                      ) : (
                        <Typography.Text className="tf-muted">Not recorded</Typography.Text>
                      ),
                    },
                  ]}
                />

                {ticket.userAgent ? (
                  <Typography.Paragraph
                    className="tf-muted"
                    style={{
                      fontSize: 11,
                      fontFamily: 'ui-monospace, monospace',
                      overflowWrap: 'anywhere',
                      marginBottom: 0,
                    }}
                  >
                    {ticket.userAgent}
                  </Typography.Paragraph>
                ) : null}
              </Card>
            ) : null}
          </Space>
        </Col>
      </Row>
    </Space>
  );
}
