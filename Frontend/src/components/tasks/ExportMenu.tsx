'use client';

import { useState } from 'react';
import { App, Button, Dropdown, Spin, Tooltip } from 'antd';
import {
  CalendarOutlined,
  CodeOutlined,
  DownOutlined,
  DownloadOutlined,
  FileExcelOutlined,
  FileMarkdownOutlined,
  FilePdfOutlined,
  FileTextOutlined,
} from '@ant-design/icons';
import type { MenuProps } from 'antd';
import { ApiError, apiDownload, saveBlob } from '@/lib/api';
import { useAuth } from '@/providers/AuthProvider';
import { taskExportQuery, type TaskFilterState } from './task-utils';

interface ExportMenuProps {
  filters: TaskFilterState;
  /** Row count for the current filters, so the label says what will be exported. */
  total: number;
}

/** Mirrors `EXPORT_FORMATS` in the API's exports module. */
const FORMATS = [
  { key: 'pdf', label: 'PDF document', icon: <FilePdfOutlined /> },
  { key: 'csv', label: 'CSV spreadsheet', icon: <FileTextOutlined /> },
  { key: 'xlsx', label: 'Excel workbook', icon: <FileExcelOutlined /> },
  { key: 'json', label: 'JSON data', icon: <CodeOutlined /> },
  { key: 'md', label: 'Markdown', icon: <FileMarkdownOutlined /> },
  { key: 'ics', label: 'Calendar (ICS)', icon: <CalendarOutlined /> },
] as const;

export function ExportMenu({ filters, total }: ExportMenuProps) {
  const { message } = App.useApp();
  const { settings } = useAuth();
  const [pending, setPending] = useState<string | null>(null);

  // Exports can be switched off for an installation; a button that always 403s
  // is worse than no button.
  if (!settings.features.exportsEnabled) return null;

  const download = async (format: string) => {
    setPending(format);
    try {
      const { blob, filename } = await apiDownload(
        '/api/exports/todos',
        taskExportQuery(filters, format),
      );
      saveBlob(blob, filename);
    } catch (err) {
      message.error(
        err instanceof ApiError ? err.message : 'That export could not be generated. Try again.',
      );
    } finally {
      setPending(null);
    }
  };

  const items: MenuProps['items'] = [
    {
      key: 'header',
      type: 'group',
      // Stated on the menu itself: an export that silently ignored the filters
      // would hand someone a 4,000-row PDF when they asked for this week's.
      label:
        total === 1
          ? 'Exports the 1 task matching your filters'
          : `Exports the ${total} tasks matching your filters`,
      children: FORMATS.map((format) => ({
        key: format.key,
        icon: pending === format.key ? <Spin size="small" /> : format.icon,
        label: pending === format.key ? `Preparing ${format.label}...` : format.label,
        disabled: pending !== null,
      })),
    },
  ];

  return (
    <Tooltip title="Download the tasks currently listed">
      <Dropdown
        menu={{ items, onClick: ({ key }) => void download(key) }}
        trigger={['click']}
        disabled={total === 0}
      >
        <Button icon={<DownloadOutlined />} loading={pending !== null}>
          Export <DownOutlined />
        </Button>
      </Dropdown>
    </Tooltip>
  );
}
