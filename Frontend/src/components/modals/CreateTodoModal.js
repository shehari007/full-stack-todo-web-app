import React, { useState } from 'react';
import { Modal, Form, Input, DatePicker, Button, Space, Typography, App } from 'antd';
import { PlusOutlined, CalendarOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import TodoListService from '../../utils/TodoListService/TodoListService';
import { STORAGE_FORMAT } from '../../utils/dateUtils';

const { Title } = Typography;
const { TextArea } = Input;

const CreateTodoModal = ({ submitted, trigger }) => {
  const [form] = Form.useForm();
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const { message } = App.useApp();

  const handleOpen = () => setVisible(true);
  const handleClose = () => {
    setVisible(false);
    form.resetFields();
  };

  const handleSubmit = async (values) => {
    setLoading(true);
    try {
      const submitData = {
        ...values,
        time: dayjs(values.time).format(STORAGE_FORMAT),
      };
      
      const result = await TodoListService.CreateTodo(submitData);
      
      if (result) {
        message.success('Task created successfully!');
        submitted?.(true);
        handleClose();
      }
    } catch (error) {
      message.error('Failed to create task');
    } finally {
      setLoading(false);
    }
  };

  const TriggerButton = trigger ? (
    React.cloneElement(trigger, { onClick: handleOpen, className: 'create-todo-btn' })
  ) : (
    <Button 
      type="primary" 
      icon={<PlusOutlined />} 
      onClick={handleOpen}
      className="create-todo-btn"
    >
      Add Task
    </Button>
  );

  return (
    <>
      {TriggerButton}

      <Modal
        title={
          <Space>
            <PlusOutlined style={{ color: 'var(--primary)' }} />
            <Title level={5} style={{ margin: 0 }}>Create New Task</Title>
          </Space>
        }
        open={visible}
        onCancel={handleClose}
        footer={null}
        centered
        destroyOnClose
        width={480}
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={handleSubmit}
          requiredMark={false}
          style={{ marginTop: 24 }}
        >
          <Form.Item
            name="text"
            label="Task Description"
            rules={[
              { required: true, message: 'Please enter a task description' },
              { min: 3, message: 'Task must be at least 3 characters' },
              { max: 200, message: 'Task must be at most 200 characters' },
            ]}
          >
            <TextArea
              placeholder="What do you need to do?"
              autoSize={{ minRows: 2, maxRows: 4 }}
              showCount
              maxLength={200}
            />
          </Form.Item>

          <Form.Item
            name="time"
            label="Due Date"
            rules={[{ required: true, message: 'Please select a due date' }]}
          >
            <DatePicker
              style={{ width: '100%' }}
              format="MMM D, YYYY"
              placeholder="Select due date"
              suffixIcon={<CalendarOutlined />}
              disabledDate={(current) => current && current < dayjs().startOf('day')}
            />
          </Form.Item>

          <Form.Item style={{ marginBottom: 0, marginTop: 32 }}>
            <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
              <Button onClick={handleClose} size="large">
                Cancel
              </Button>
              <Button 
                type="primary" 
                htmlType="submit" 
                loading={loading}
                size="large"
              >
                Create Task
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
};

export default CreateTodoModal;
