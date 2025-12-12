import React, { useState } from 'react';
import { 
  Table, 
  Checkbox, 
  Space, 
  Typography, 
  Button, 
  Tag,
  Tooltip,
  Input,
  App
} from 'antd';
import { 
  PlusOutlined, 
  FilterOutlined, 
  FilePdfOutlined,
  SearchOutlined,
  ReloadOutlined
} from '@ant-design/icons';
import CreateTodoModal from '../modals/CreateTodoModal';
import UpdateTodoModal from '../modals/UpdateTodoModal';
import DeleteTodoModal from '../modals/DeleteTodoModal';
import FilterTodoModal from '../modals/FilterTodoModal';
import PDFDownloader from '../PDFDownloader/PDFDownloader';
import EmptyState from '../common/EmptyState';
import TodoListService from '../../utils/TodoListService/TodoListService';
import { formatDate, getDueDateInfo } from '../../utils/dateUtils';

const { Text } = Typography;

const TodoList = ({ todos = [], loading = false, onRefresh }) => {
  const { message } = App.useApp();
  const [filteredTodos, setFilteredTodos] = useState(null);
  const [searchText, setSearchText] = useState('');
  const [updating, setUpdating] = useState(null);

  const handleModalSubmit = async (submitted) => {
    if (submitted && onRefresh) {
      onRefresh();
    }
  };

  const handleFilterSubmit = (data) => {
    if (data === 'reset') {
      setFilteredTodos(null);
    } else {
      setFilteredTodos(data);
    }
  };

  const handleCheckChange = async (e, todoId) => {
    setUpdating(todoId);
    const checked = e.target.checked;
    try {
      const res = await TodoListService.UpdateCheckTodo(todoId, checked);
      if (res && onRefresh) {
        message.success(checked ? 'Task marked as completed!' : 'Task marked as pending');
        onRefresh();
      } else if (!res) {
        message.error('Failed to update task');
      }
    } finally {
      setUpdating(null);
    }
  };

  // Filter by search text
  const getDisplayData = () => {
    let data = filteredTodos || todos;
    if (searchText) {
      data = data.filter(todo => 
        todo.text.toLowerCase().includes(searchText.toLowerCase())
      );
    }
    return data;
  };

  const displayData = getDisplayData();

  const getStatusTag = (todo) => {
    const { label, color } = getDueDateInfo(todo.time, todo.checked);
    return <Tag color={color}>{todo.checked ? 'Completed' : label}</Tag>;
  };

  const columns = [
    {
      title: 'Status',
      dataIndex: 'checked',
      key: 'checked',
      width: 70,
      render: (checked, record) => (
        <Checkbox
          checked={checked}
          onChange={(e) => handleCheckChange(e, record.id)}
          disabled={updating === record.id}
        />
      ),
    },
    {
      title: 'Task',
      dataIndex: 'text',
      key: 'text',
      render: (text, record) => (
        <div>
          <Text 
            delete={record.checked}
            style={{ 
              color: record.checked ? 'var(--text-muted)' : 'var(--text-primary)',
              fontSize: '0.95rem'
            }}
          >
            {text}
          </Text>
          <div style={{ marginTop: 4 }}>
            {getStatusTag(record)}
          </div>
        </div>
      ),
    },
    {
      title: 'Due Date',
      dataIndex: 'time',
      key: 'time',
      width: 140,
      responsive: ['md'],
      render: (time) => (
        <Text type="secondary" style={{ fontSize: '0.875rem' }}>
          {formatDate(time, 'smart')}
        </Text>
      ),
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 110,
      fixed: 'right',
      render: (_, record) => (
        <Space size="small">
          <UpdateTodoModal submitted={handleModalSubmit} rowData={record} />
          <DeleteTodoModal submitted={handleModalSubmit} rowData={record} />
        </Space>
      ),
    },
  ];

  return (
    <div className="todo-container slide-up">
      {/* Header */}
      <div className="todo-header">
        <Space wrap>
          <Input
            placeholder="Search tasks..."
            prefix={<SearchOutlined style={{ color: 'var(--text-muted)' }} />}
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            style={{ width: 200 }}
            allowClear
          />
          <Tooltip title="Refresh">
            <Button 
              icon={<ReloadOutlined />} 
              onClick={onRefresh}
              loading={loading}
            />
          </Tooltip>
        </Space>
        
        <Space wrap className="todo-actions">
          <FilterTodoModal 
            listData={todos} 
            submitted={handleFilterSubmit}
            trigger={
              <Button icon={<FilterOutlined />}>
                <span className="btn-text">Filter</span>
              </Button>
            }
          />
          <PDFDownloader 
            TableData={todos}
            trigger={
              <Button icon={<FilePdfOutlined />}>
                <span className="btn-text">Export</span>
              </Button>
            }
          />
          <CreateTodoModal 
            submitted={handleModalSubmit}
            trigger={
              <Button type="primary" icon={<PlusOutlined />}>
                <span className="btn-text">Add Task</span>
              </Button>
            }
          />
        </Space>
      </div>

      {/* Table */}
      {displayData.length === 0 && !loading ? (
        <EmptyState
          title="No tasks yet"
          description="Create your first task to get started"
          actionText="Create Task"
          onAction={() => document.querySelector('.create-todo-btn')?.click()}
        />
      ) : (
        <Table
          columns={columns}
          dataSource={displayData}
          loading={loading}
          rowKey="id"
          scroll={{ x: 400 }}
          pagination={{
            pageSize: 10,
            showSizeChanger: true,
            showTotal: (total, range) => `${range[0]}-${range[1]} of ${total} tasks`,
          }}
          style={{ background: 'transparent' }}
          rowClassName={(record) => record.checked ? 'completed-row' : ''}
        />
      )}

      {/* Footer Stats */}
      {displayData.length > 0 && (
        <div style={{ 
          padding: '16px 24px', 
          borderTop: '1px solid var(--border-color)',
          display: 'flex',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 16
        }}>
          <Space split={<Text type="secondary">•</Text>}>
            <Text><strong>{todos.length}</strong> Total</Text>
            <Text><strong>{todos.filter(t => t.checked).length}</strong> Completed</Text>
            <Text><strong>{todos.filter(t => !t.checked).length}</strong> Pending</Text>
          </Space>
          {filteredTodos && (
            <Button size="small" onClick={() => setFilteredTodos(null)}>
              Clear Filter
            </Button>
          )}
        </div>
      )}
    </div>
  );
};

export default TodoList;
