import React, { useState } from 'react';
import { Modal, Button, Typography, Space, Tooltip, App } from 'antd';
import { DeleteOutlined, ExclamationCircleOutlined } from '@ant-design/icons';
import TodoListService from '../../utils/TodoListService/TodoListService';
import { formatDate } from '../../utils/dateUtils';

const { Title, Text } = Typography;

const DeleteTodoModal = ({ rowData, submitted }) => {
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const { message } = App.useApp();

  const handleOpen = () => setVisible(true);
  const handleClose = () => setVisible(false);

  const handleDelete = async () => {
    setLoading(true);
    try {
      const result = await TodoListService.DelTodo(rowData.id);
      
      if (result) {
        message.success('Task deleted successfully!');
        submitted?.(true);
        handleClose();
      }
    } catch (error) {
      message.error('Failed to delete task');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Tooltip title="Delete">
        <Button
          type="text"
          icon={<DeleteOutlined />}
          onClick={handleOpen}
          style={{ color: 'var(--danger)' }}
          className="action-btn-delete"
          danger
        />
      </Tooltip>

      <Modal
        title={
          <Space>
            <ExclamationCircleOutlined style={{ color: 'var(--warning)', fontSize: 22 }} />
            <Title level={5} style={{ margin: 0 }}>Delete Task</Title>
          </Space>
        }
        open={visible}
        onCancel={handleClose}
        centered
        width={400}
        footer={
          <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
            <Button onClick={handleClose} size="large">
              Cancel
            </Button>
            <Button 
              type="primary" 
              danger
              onClick={handleDelete}
              loading={loading}
              size="large"
            >
              Delete
            </Button>
          </Space>
        }
      >
        <div style={{ padding: '16px 0' }}>
          <Text>Are you sure you want to delete this task?</Text>
          <div 
            style={{ 
              marginTop: 16, 
              padding: 16, 
              background: 'var(--bg-tertiary)', 
              borderRadius: 8,
              borderLeft: '4px solid var(--danger)'
            }}
          >
            <Text strong style={{ color: 'var(--text-primary)' }}>
              {rowData?.text}
            </Text>
            <br />
            <Text type="secondary" style={{ fontSize: '0.875rem' }}>
              Due: {formatDate(rowData?.time, 'medium')}
            </Text>
          </div>
          <Text type="secondary" style={{ display: 'block', marginTop: 12, fontSize: '0.875rem' }}>
            This action cannot be undone.
          </Text>
        </div>
      </Modal>
    </>
  );
};

export default DeleteTodoModal;
