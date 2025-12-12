import React, { useState } from 'react';
import { Input, Form, Button, Typography, Tooltip, App } from 'antd';
import { 
  UserOutlined, 
  LockOutlined, 
  SunOutlined, 
  MoonOutlined,
  EyeInvisibleOutlined,
  EyeOutlined
} from '@ant-design/icons';
import { Link } from 'react-router-dom';
import { useTheme } from '../../context/ThemeContext';
import AuthService from '../../utils/AuthService/AuthService';
import LayoutFooter from '../../layout/LayoutFooter';

const { Text, Title } = Typography;

const Login = () => {
  const [loading, setLoading] = useState(false);
  const [form] = Form.useForm();
  const { isDarkMode, toggleTheme } = useTheme();
  const { message } = App.useApp();

  const handleSubmit = async (values) => {
    setLoading(true);
    try {
      const result = await AuthService.Login(values);
      if (!result.success) {
        message.error(result.error || 'Login failed. Please try again.');
        setLoading(false);
      }
    } catch (error) {
      message.error('Login failed. Please try again.');
      setLoading(false);
    }
  };

  return (
    <div className="auth-container">
      {/* Theme Toggle */}
      <div style={{ position: 'absolute', top: 20, right: 20 }}>
        <Tooltip title={isDarkMode ? 'Light Mode' : 'Dark Mode'}>
          <button className="theme-toggle" onClick={toggleTheme}>
            {isDarkMode ? <SunOutlined /> : <MoonOutlined />}
          </button>
        </Tooltip>
      </div>

      <div className="auth-content">
        <div className="auth-card fade-in">
          <div className="auth-header">
            <img src="/main-logo.png" alt="TaskFlow" className="auth-logo" />
            <Title level={3} className="auth-title">Welcome Back!</Title>
            <Text className="auth-subtitle">Sign in to continue to TaskFlow</Text>
          </div>

          <Form
            form={form}
            layout="vertical"
            onFinish={handleSubmit}
            requiredMark={false}
            size="large"
          >
            <Form.Item
              name="username"
              rules={[
                { required: true, message: 'Please enter your username' },
                { min: 3, message: 'Username must be at least 3 characters' },
              ]}
            >
              <Input
                prefix={<UserOutlined style={{ color: 'var(--text-muted)' }} />}
                placeholder="Username"
                autoComplete="username"
              />
            </Form.Item>

            <Form.Item
              name="password"
              rules={[
                { required: true, message: 'Please enter your password' },
                { min: 6, message: 'Password must be at least 6 characters' },
              ]}
            >
              <Input.Password
                prefix={<LockOutlined style={{ color: 'var(--text-muted)' }} />}
                placeholder="Password"
                iconRender={(visible) => 
                  visible ? <EyeOutlined /> : <EyeInvisibleOutlined />
                }
                autoComplete="current-password"
              />
            </Form.Item>

            <Form.Item style={{ marginBottom: 16 }}>
              <Button
                type="primary"
                htmlType="submit"
                loading={loading}
                block
                style={{ height: 48, fontSize: '1rem', fontWeight: 600 }}
              >
                {loading ? 'Signing in...' : 'Sign In'}
              </Button>
            </Form.Item>
          </Form>

          <div className="auth-footer">
            <Text className="auth-footer-text">
              Don't have an account?{' '}
              <Link to="/register" className="auth-footer-link">
                Create Account
              </Link>
            </Text>
          </div>
        </div>
      </div>

      <LayoutFooter />
    </div>
  );
};

export default Login;
