import React from 'react';
import { Button, Dropdown, Space, Typography, Avatar, Tooltip } from 'antd';
import { 
  LogoutOutlined, 
  SunOutlined, 
  MoonOutlined,
  UserOutlined,
  SettingOutlined
} from '@ant-design/icons';
import { useTheme } from '../context/ThemeContext';
import AuthService from '../utils/AuthService/AuthService';

const { Text } = Typography;

const LayoutHeader = () => {
  const { isDarkMode, toggleTheme } = useTheme();
  const username = localStorage.getItem('User') || 'User';

  const userMenuItems = [
    {
      key: 'profile',
      icon: <UserOutlined />,
      label: 'Profile',
      disabled: true,
    },
    {
      key: 'settings',
      icon: <SettingOutlined />,
      label: 'Settings',
      disabled: true,
    },
    {
      type: 'divider',
    },
    {
      key: 'logout',
      icon: <LogoutOutlined />,
      label: 'Logout',
      danger: true,
      onClick: () => AuthService.LogOut(),
    },
  ];

  const getInitials = (name) => {
    return name
      .split(' ')
      .map(word => word[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  return (
    <header className="app-header">
      <div className="header-content">
        <div className="header-left">
          <div className="header-logo">
            <img src="/main-logo.png" alt="TaskFlow" />
            <h1>TaskFlow</h1>
          </div>
        </div>

        <div className="header-right">
          <Tooltip title={isDarkMode ? 'Light Mode' : 'Dark Mode'}>
            <button className="theme-toggle" onClick={toggleTheme}>
              {isDarkMode ? <SunOutlined /> : <MoonOutlined />}
            </button>
          </Tooltip>

          <Dropdown
            menu={{ items: userMenuItems }}
            placement="bottomRight"
            trigger={['click']}
          >
            <Space style={{ cursor: 'pointer' }}>
              <Avatar 
                style={{ 
                  background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                  cursor: 'pointer'
                }}
              >
                {getInitials(username)}
              </Avatar>
              <Text strong className="user-name">{username}</Text>
            </Space>
          </Dropdown>
        </div>
      </div>
    </header>
  );
};

export default LayoutHeader;
