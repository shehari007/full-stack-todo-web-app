import React, { useState } from 'react';
import { Modal, Form, DatePicker, Button, Space, Typography, Radio, App } from 'antd';
import { FilterOutlined, CalendarOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { STORAGE_FORMAT } from '../../utils/dateUtils';

const { Title, Text } = Typography;

const FilterTodoModal = ({ listData = [], submitted, trigger }) => {
  const [form] = Form.useForm();
  const [visible, setVisible] = useState(false);
  const [filterType, setFilterType] = useState('date');
  const { message } = App.useApp();

  const handleOpen = () => setVisible(true);
  const handleClose = () => {
    setVisible(false);
    form.resetFields();
    setFilterType('date');
  };

  const handleSubmit = (values) => {
    let filteredData = [...listData];

    if (filterType === 'date' && values.start_time && values.end_time) {
      const startTime = dayjs(values.start_time).startOf('day');
      const endTime = dayjs(values.end_time).endOf('day');

      filteredData = listData.filter(item => {
        const itemDate = dayjs(item.time, STORAGE_FORMAT);
        return itemDate.isAfter(startTime) && itemDate.isBefore(endTime);
      });
    } else if (filterType === 'status') {
      if (values.status === 'completed') {
        filteredData = listData.filter(item => item.checked);
      } else if (values.status === 'pending') {
        filteredData = listData.filter(item => !item.checked);
      }
    }

    if (filteredData.length === 0) {
      message.info('No tasks found matching your filter');
    } else {
      message.success(`Found ${filteredData.length} task(s)`);
    }

    submitted?.(filteredData);
    handleClose();
  };

  const handleReset = () => {
    submitted?.('reset');
    message.success('Filter cleared');
    handleClose();
  };

  const TriggerButton = trigger ? (
    React.cloneElement(trigger, { onClick: handleOpen })
  ) : (
    <Button icon={<FilterOutlined />} onClick={handleOpen}>
      Filter
    </Button>
  );

  return (
    <>
      {TriggerButton}

      <Modal
        title={
          <Space>
            <FilterOutlined style={{ color: 'var(--primary)' }} />
            <Title level={5} style={{ margin: 0 }}>Filter Tasks</Title>
          </Space>
        }
        open={visible}
        onCancel={handleClose}
        footer={null}
        centered
        destroyOnClose
        width={440}
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={handleSubmit}
          requiredMark={false}
          style={{ marginTop: 24 }}
        >
          <Form.Item label="Filter By">
            <Radio.Group 
              value={filterType} 
              onChange={(e) => setFilterType(e.target.value)}
              buttonStyle="solid"
            >
              <Radio.Button value="date">Date Range</Radio.Button>
              <Radio.Button value="status">Status</Radio.Button>
            </Radio.Group>
          </Form.Item>

          {filterType === 'date' && (
            <>
              <Form.Item
                name="start_time"
                label="Start Date"
                rules={[{ required: true, message: 'Please select start date' }]}
              >
                <DatePicker
                  style={{ width: '100%' }}
                  format="MMM D, YYYY"
                  placeholder="Select start date"
                  suffixIcon={<CalendarOutlined />}
                />
              </Form.Item>

              <Form.Item
                name="end_time"
                label="End Date"
                rules={[
                  { required: true, message: 'Please select end date' },
                  ({ getFieldValue }) => ({
                    validator(_, value) {
                      if (!value || !getFieldValue('start_time')) {
                        return Promise.resolve();
                      }
                      if (dayjs(value).isAfter(dayjs(getFieldValue('start_time')))) {
                        return Promise.resolve();
                      }
                      return Promise.reject(new Error('End date must be after start date'));
                    },
                  }),
                ]}
              >
                <DatePicker
                  style={{ width: '100%' }}
                  format="MMM D, YYYY"
                  placeholder="Select end date"
                  suffixIcon={<CalendarOutlined />}
                />
              </Form.Item>
            </>
          )}

          {filterType === 'status' && (
            <Form.Item
              name="status"
              label="Task Status"
              rules={[{ required: true, message: 'Please select a status' }]}
            >
              <Radio.Group>
                <Space direction="vertical">
                  <Radio value="all">All Tasks</Radio>
                  <Radio value="completed">Completed Only</Radio>
                  <Radio value="pending">Pending Only</Radio>
                </Space>
              </Radio.Group>
            </Form.Item>
          )}

          <Form.Item style={{ marginBottom: 0, marginTop: 32 }}>
            <Space style={{ width: '100%', justifyContent: 'space-between' }}>
              <Button onClick={handleReset}>
                Reset Filter
              </Button>
              <Space>
                <Button onClick={handleClose}>
                  Cancel
                </Button>
                <Button type="primary" htmlType="submit">
                  Apply Filter
                </Button>
              </Space>
            </Space>
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
};

export default FilterTodoModal;
