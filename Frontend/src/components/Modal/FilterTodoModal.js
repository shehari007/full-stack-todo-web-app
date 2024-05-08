import React, { useState } from 'react';
import { DatePicker, Form, Modal, Button, Typography, Flex } from 'antd';
import locale from 'antd/locale/tr_TR.js';
import dayjs from 'dayjs';

const { Text } = Typography

const FilterTodoModal = ({ listData, submitted }) => {

    const [form] = Form.useForm();
    const [modalVisible, setModalVisible] = useState(false);

    const handleOk = async (values) => {
        const { start_time, end_time } = values;

        const startTimeInMillis = dayjs(start_time, 'DD-MM-YYYY').valueOf();
        const endTimeInMillis = dayjs(end_time, 'DD-MM-YYYY').valueOf();

        const filteredList = listData.filter(item => {
            const itemTimestamp = dayjs(item.time, 'DD-MM-YYYY').valueOf();
            return itemTimestamp > startTimeInMillis && itemTimestamp < endTimeInMillis;
        });

        submitted(filteredList);
        setModalVisible(false);
        form.resetFields();
    };


    const showFilterModal = () => {
        setModalVisible(true);
    };

    const handleCancel = () => {
        setModalVisible(false);
    };

    const handleAfterClose = () => {
        form.resetFields();
    }

    const handleReset = () => {
        submitted('reset');
        setModalVisible(false);
        form.resetFields();
    }
    return (
        <>
            <Button type="primary" onClick={showFilterModal}>Filter Todo</Button>
            <Modal
                title={<><Text>Filter Todo Task</Text></>}
                open={modalVisible}
                onCancel={handleCancel}
                footer={null}
                centered
                afterClose={handleAfterClose}
            >
                <Form layout="vertical" style={{ marginTop: '10px' }} onFinish={handleOk} form={form}>

                    <Form.Item label="Start Time:" name="start_time" rules={[{ required: true, message: 'please select start date' }]}>
                        <DatePicker
                            locale={locale}
                            style={{ width: '100%' }}
                            format={'DD-MM-YYYY'}
                            placeholder='DD-MM-YYYY'
                        />
                    </Form.Item>
                    <Form.Item label="End Time:" name="end_time" rules={[{ required: true, message: 'please select end date' }]}>
                        <DatePicker
                            locale={locale}
                            style={{ width: '100%' }}
                            format={'DD-MM-YYYY'}
                            placeholder='DD-MM-YYYY'
                        />
                    </Form.Item>
                    <Flex justify="flex-end">
                        <Form.Item>
                            <Button type="primary" style={{ marginRight: 8 }} onClick={() => handleReset()}>
                                Reset Default
                            </Button>
                            <Button type="primary" style={{ marginRight: 8 }} danger onClick={handleCancel} >
                                Cancel
                            </Button>
                            <Button type="primary" style={{ backgroundColor: 'green', borderColor: 'green' }} htmlType="submit">
                                Submit
                            </Button>

                        </Form.Item>
                    </Flex>
                </Form>
            </Modal>
        </>
    );
};

export default FilterTodoModal;
