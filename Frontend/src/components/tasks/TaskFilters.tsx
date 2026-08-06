'use client';

import { useEffect, useId, useState } from 'react';
import { Button, Col, DatePicker, Drawer, Input, Row, Select, Switch } from 'antd';
import { ClearOutlined, FilterOutlined, SearchOutlined } from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import type { TodoPriority, TodoStatus } from '@/types/api';
import {
  PRIORITY_META,
  SORT_OPTIONS,
  STATUS_META,
  TODO_PRIORITIES,
  TODO_STATUSES,
  parseSortValue,
  sortValue,
  type TaskFilterState,
} from './task-utils';

const { RangePicker } = DatePicker;

interface TaskFiltersProps {
  filters: TaskFilterState;
  activeFilterCount: number;
  tagOptions: string[];
  /** Below the md breakpoint the controls move into a drawer. */
  compact: boolean;
  onChange: (patch: Partial<TaskFilterState>) => void;
  onClear: () => void;
}

/** Debounce for the search box: long enough to skip a fast typist's keystrokes. */
const SEARCH_DEBOUNCE_MS = 300;

export function TaskFilters({
  filters,
  activeFilterCount,
  tagOptions,
  compact,
  onChange,
  onClear,
}: TaskFiltersProps) {
  const ids = useId();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [searchDraft, setSearchDraft] = useState(filters.q);

  // Re-sync when the URL changes underneath us: "Clear filters" and the back
  // button both have to empty the box.
  useEffect(() => {
    setSearchDraft(filters.q);
  }, [filters.q]);

  useEffect(() => {
    if (searchDraft === filters.q) return;

    const timer = setTimeout(() => onChange({ q: searchDraft }), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchDraft, filters.q, onChange]);

  const searchId = `${ids}-q`;
  const statusId = `${ids}-status`;
  const priorityId = `${ids}-priority`;
  const tagsId = `${ids}-tags`;
  const dueId = `${ids}-due`;
  const overdueId = `${ids}-overdue`;
  const sortId = `${ids}-sort`;

  const search = (
    <Field label="Search" htmlFor={searchId}>
      <Input
        id={searchId}
        allowClear
        prefix={<SearchOutlined aria-hidden="true" />}
        placeholder="Search titles and descriptions"
        value={searchDraft}
        maxLength={200}
        onChange={(event) => setSearchDraft(event.target.value)}
        // Enter skips the debounce for anyone who expects a search box to submit.
        onPressEnter={() => onChange({ q: searchDraft })}
      />
    </Field>
  );

  const dueRange: [Dayjs | null, Dayjs | null] = [
    filters.dueFrom ? dayjs(filters.dueFrom) : null,
    filters.dueTo ? dayjs(filters.dueTo) : null,
  ];

  const controls = (
    <>
      <Col xs={24} md={12} lg={5}>
        <Field label="Status" htmlFor={statusId}>
          <Select<TodoStatus[]>
            id={statusId}
            mode="multiple"
            allowClear
            style={{ width: '100%' }}
            placeholder="Any status"
            value={filters.status}
            onChange={(status) => onChange({ status })}
            options={TODO_STATUSES.map((value) => ({
              value,
              label: STATUS_META[value].label,
            }))}
          />
        </Field>
      </Col>

      <Col xs={24} md={12} lg={5}>
        <Field label="Priority" htmlFor={priorityId}>
          <Select<TodoPriority[]>
            id={priorityId}
            mode="multiple"
            allowClear
            style={{ width: '100%' }}
            placeholder="Any priority"
            value={filters.priority}
            onChange={(priority) => onChange({ priority })}
            options={TODO_PRIORITIES.map((value) => ({
              value,
              label: PRIORITY_META[value].label,
            }))}
          />
        </Field>
      </Col>

      <Col xs={24} md={12} lg={5}>
        <Field label="Tags" htmlFor={tagsId}>
          {/* `tags` mode, not `multiple`: a link may carry a tag that is not on
              the current page, and typing one that does not exist yet should
              still be possible. */}
          <Select<string[]>
            id={tagsId}
            mode="tags"
            allowClear
            style={{ width: '100%' }}
            placeholder="Any tag"
            value={filters.tags}
            onChange={(tags) => onChange({ tags: tags.slice(0, 20) })}
            options={tagOptions.map((tag) => ({ value: tag, label: tag }))}
            maxTagCount="responsive"
          />
        </Field>
      </Col>

      <Col xs={24} md={12} lg={9}>
        <Field label="Due between" htmlFor={dueId}>
          <RangePicker
            id={dueId}
            style={{ width: '100%' }}
            allowEmpty={[true, true]}
            value={dueRange}
            onChange={(dates) =>
              onChange({
                // Whole days: the picker has no time control here, so the range
                // has to cover the end date rather than stopping at midnight.
                dueFrom: dates?.[0] ? dates[0].startOf('day').toISOString() : null,
                dueTo: dates?.[1] ? dates[1].endOf('day').toISOString() : null,
              })
            }
          />
        </Field>
      </Col>

      <Col xs={24} md={12} lg={5}>
        <Field label="Sort by" htmlFor={sortId}>
          <Select
            id={sortId}
            style={{ width: '100%' }}
            value={sortValue(filters)}
            onChange={(value) => onChange(parseSortValue(value))}
            options={SORT_OPTIONS}
          />
        </Field>
      </Col>

      <Col xs={24} md={12} lg={5}>
        <Field label="Overdue only" htmlFor={overdueId}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              height: 40,
            }}
          >
            <Switch
              id={overdueId}
              checked={filters.overdue}
              onChange={(overdue) => onChange({ overdue })}
              aria-label="Show overdue tasks only"
            />
            <span className="tf-muted" style={{ fontSize: '0.875rem' }}>
              {filters.overdue ? 'Past due only' : 'All due dates'}
            </span>
          </div>
        </Field>
      </Col>
    </>
  );

  const clearButton = (
    <Button
      icon={<ClearOutlined />}
      onClick={onClear}
      disabled={activeFilterCount === 0}
      block={compact}
    >
      Clear filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
    </Button>
  );

  if (compact) {
    return (
      <section aria-label="Task filters" className="tf-stack" style={{ gap: '0.6rem' }}>
        {search}

        {/* The count is in the label rather than in a Badge: it has to be read
            out, not just seen, and a badge on a full-width button does not
            position sensibly. */}
        <Button icon={<FilterOutlined />} onClick={() => setDrawerOpen(true)} block>
          Filters and sorting
          {activeFilterCount > 0 ? ` (${activeFilterCount} active)` : ''}
        </Button>

        <Drawer
          title="Filters and sorting"
          placement="bottom"
          height="auto"
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          // Applied live, so the drawer only needs a way out.
          footer={
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              {clearButton}
              <Button type="primary" block onClick={() => setDrawerOpen(false)}>
                Done
              </Button>
            </div>
          }
        >
          <Row gutter={[12, 12]}>{controls}</Row>
        </Drawer>
      </section>
    );
  }

  return (
    <section
      aria-label="Task filters"
      style={{
        background: 'var(--tf-surface)',
        border: '1px solid var(--tf-border)',
        borderRadius: 12,
        padding: '0.9rem',
      }}
    >
      <Row gutter={[12, 12]} align="bottom">
        <Col xs={24} lg={9}>
          {search}
        </Col>
        {controls}
        <Col xs={24} lg={5} style={{ display: 'flex', alignItems: 'flex-end' }}>
          {clearButton}
        </Col>
      </Row>
    </section>
  );
}

/**
 * A real `<label>` bound to the control's id.
 *
 * Ant Design only renders labels inside a Form, and these controls are not in
 * one. Without this the Selects would be announced as "combobox" with no name.
 */
function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label
        htmlFor={htmlFor}
        style={{
          display: 'block',
          fontSize: '0.8125rem',
          fontWeight: 500,
          marginBottom: '0.3rem',
          color: 'var(--tf-text-muted)',
        }}
      >
        {label}
      </label>
      {children}
    </div>
  );
}
