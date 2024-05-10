import React, { useState } from 'react';
import { DatePicker, Form, Modal, Button, Input, Typography, Flex } from 'antd';
import locale from 'antd/locale/tr_TR.js';
import dayjs from 'dayjs';
import TodoListService from '../../utils/TodoListService/TodoListService';

const { Text } = Typography
const CreateTodoModal = ({ submitted }) => {
    const [form] = Form.useForm();
    const [modalVisible, setModalVisible] = useState(false);
    const [loading, setLoading] = useState(false);

    const handleOk = async (values) => {
        setLoading(true);
        let updatedValues = {
            ...values,
            time: dayjs(values.time).format('DD-MM-YYYY'),
        };
        const result = await TodoListService.CreateTodo(updatedValues);
        if (result === true) {
            submitted(true);
            setLoading(false);
            setModalVisible(false);
        }
        setLoading(false);
    };

    const showCreateModal = () => {
        setModalVisible(true);
    };

    const handleCancel = () => {
        setModalVisible(false);
    };

    const handleAfterClose = () => {
        form.resetFields();
    }

    return (
        <>
            <Button type="primary" style={{ backgroundColor: 'green', borderColor: 'green' }} onClick={showCreateModal}>New Todo</Button>

            <Modal
                title={<><Text>Add New Todo Task</Text></>}
                open={modalVisible}
                onCancel={handleCancel}
                footer={null}
                centered
                afterClose={handleAfterClose}
            >
                <Form layout="vertical" style={{ marginTop: '10px' }} onFinish={handleOk} form={form}>
                    <Form.Item label="Task:" name="text" rules={[{ required: true, message: 'please enter task' }]}>
                        <Input placeholder="enter task" />
                    </Form.Item>
                    <Form.Item label="Time:" name="time" rules={[{ required: true, message: 'please select date' }]}>
                        <DatePicker
                            locale={locale}
                            style={{ width: '100%' }}
                            format={'DD-MM-YYYY'}
                            placeholder='DD-MM-YYYY'
                        />
                    </Form.Item>
                    <Flex justify="flex-end">
                        <Form.Item>
                            <Button  type="primary" style={{ marginRight: 8 }} danger onClick={handleCancel} >
                                Cancel
                            </Button>
                            <Button loading={loading} type="primary" htmlType="submit">
                                Submit
                            </Button>
                        </Form.Item>
                    </Flex>
                </Form>
            </Modal>
        </>
    );
};

export default CreateTodoModal;
