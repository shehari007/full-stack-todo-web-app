import React from 'react';
import { Typography, Space } from 'antd';
import { GithubOutlined, HeartFilled } from '@ant-design/icons';

const { Text, Link } = Typography;

const LayoutFooter = () => {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="app-footer">
      <div className="footer-content">
        <Space direction="vertical" size={8} align="center">
          <Text className="footer-text">
            Built with <HeartFilled style={{ color: '#ef4444', margin: '0 4px' }} /> using React & Ant Design
          </Text>
          <Space split={<Text type="secondary">•</Text>}>
            <Link 
              href="https://github.com/shehari007/todo-web-app" 
              target="_blank"
              className="footer-link"
            >
              <GithubOutlined /> View on GitHub
            </Link>
            <Text className="footer-text">
              © {currentYear} TaskFlow
            </Text>
          </Space>
        </Space>
      </div>
    </footer>
  );
};

export default LayoutFooter;
