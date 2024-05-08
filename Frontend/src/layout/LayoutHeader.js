import React from 'react'
import { Layout, theme, Space, Typography } from 'antd'
import { PoweroffOutlined } from '@ant-design/icons';
import AuthService from '../utils/AuthService/AuthService';

const { Link, Text } = Typography;
const { Header } = Layout;
const LayoutHeader = () => {
    const {
        token: { colorBgContainer },
    } = theme.useToken();
    return (
        <Header
            style={{
                padding: 0,
                background: colorBgContainer,
                boxShadow: '0 5px 5px -5px #333',
                display: 'flex',
                justifyContent: 'space-between',
                alignContent: 'space-between',
            }}
        >
            <Space size="middle" align='start' style={{ marginLeft: '30px' }} >
                <Text strong>Welcome! {localStorage.getItem('User')}</Text>
            </Space>
            <Space size="middle" align='end' style={{ marginRight: '30px' }} >
                <Link type='danger' strong onClick={() => AuthService.LogOut()}><PoweroffOutlined /> Logout</Link>
            </Space>
        </Header>
    )
}

export default LayoutHeader;
