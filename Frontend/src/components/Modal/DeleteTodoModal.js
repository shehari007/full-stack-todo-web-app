import React, { useState } from 'react';
import {  Form, Modal, Typography } from 'antd';
import { DeleteTwoTone, ExclamationCircleFilled } from '@ant-design/icons';

import TodoListService from '../../utils/TodoListService/TodoListService';

const { Text } = Typography

const DeleteTodoModal = ({ rowData, submitted }) => {
   
    const [form] = Form.useForm();
    const [modalVisible, setModalVisible] = useState(false);

    const handleOk = async () => {
        const result = await TodoListService.DelTodo(rowData.id);
        if (result === true) {
            submitted(true);
            setModalVisible(false);
        }
    };

    const showUpdateModal = () => {
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
            <DeleteTwoTone twoToneColor={'red'} style={{ fontSize: '22px' }} onClick={showUpdateModal}>Delete Todo</DeleteTwoTone>

            <Modal
                title={<><ExclamationCircleFilled style={{color:"orange"}}/> <Text>Delete Todo Task</Text></>}
                open={modalVisible}
                onCancel={handleCancel}
                onOk={handleOk}
                okText={"Yes"}
                okButtonProps={{type: "primary", danger:true}}
                cancelText={"No"}
                cancelButtonProps={{type: "primary", danger:false}}
                centered
                afterClose={handleAfterClose}
            >
              <Text>You sure you want to delete this Task?</Text><br/>
              <Text strong type="danger">{rowData.text}</Text>
            </Modal>
        </>
    );
};

export default DeleteTodoModal;
