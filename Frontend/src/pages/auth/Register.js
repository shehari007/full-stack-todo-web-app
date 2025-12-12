import React, { useState } from 'react';
import { Input, Form, Button, Typography, Tooltip, App } from 'antd';
import { 
  UserOutlined, 
  LockOutlined, 
  SunOutlined, 
  MoonOutlined,
  EyeInvisibleOutlined,
  EyeOutlined,
  CheckCircleOutlined
} from '@ant-design/icons';
import { Link } from 'react-router-dom';
import { useTheme } from '../../context/ThemeContext';
import AuthService from '../../utils/AuthService/AuthService';
import LayoutFooter from '../../layout/LayoutFooter';

const { Text, Title } = Typography;

const Register = () => {
  const [loading, setLoading] = useState(false);
  const [form] = Form.useForm();
  const { isDarkMode, toggleTheme } = useTheme();
  const { message } = App.useApp();

  const handleSubmit = async (values) => {
    setLoading(true);
    try {
      const { confirmPassword, ...submitData } = values;
      const result = await AuthService.Register(submitData);
      if (result.success) {
        message.success('Account created successfully! Redirecting to login...');
        setTimeout(() => {
          window.location.replace('/login');
        }, 1500);
      } else {
        message.error(result.error || 'Registration failed. Please try again.');
        setLoading(false);
      }
    } catch (error) {
      message.error('Registration failed. Please try again.');
      setLoading(false);
    }
  };

  const passwordRules = [
    { required: true, message: 'Please enter your password' },
    { min: 6, message: 'Password must be at least 6 characters' },
    {
      pattern: /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/,
      message: 'Must contain uppercase, lowercase and number',
    },
  ];

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
            <Title level={3} className="auth-title">Create Account</Title>
            <Text className="auth-subtitle">Get started with TaskFlow today</Text>
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
                { required: true, message: 'Please enter a username' },
                { min: 3, message: 'Username must be at least 3 characters' },
                { max: 20, message: 'Username must be at most 20 characters' },
                { 
                  pattern: /^[a-zA-Z0-9_]+$/, 
                  message: 'Only letters, numbers and underscores allowed' 
                },
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
              rules={passwordRules}
              hasFeedback
            >
              <Input.Password
                prefix={<LockOutlined style={{ color: 'var(--text-muted)' }} />}
                placeholder="Password"
                iconRender={(visible) => 
                  visible ? <EyeOutlined /> : <EyeInvisibleOutlined />
                }
                autoComplete="new-password"
              />
            </Form.Item>

            <Form.Item
              name="confirmPassword"
              dependencies={['password']}
              hasFeedback
              rules={[
                { required: true, message: 'Please confirm your password' },
                ({ getFieldValue }) => ({
                  validator(_, value) {
                    if (!value || getFieldValue('password') === value) {
                      return Promise.resolve();
                    }
                    return Promise.reject(new Error('Passwords do not match'));
                  },
                }),
              ]}
            >
              <Input.Password
                prefix={<CheckCircleOutlined style={{ color: 'var(--text-muted)' }} />}
                placeholder="Confirm Password"
                iconRender={(visible) => 
                  visible ? <EyeOutlined /> : <EyeInvisibleOutlined />
                }
                autoComplete="new-password"
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
                {loading ? 'Creating Account...' : 'Create Account'}
              </Button>
            </Form.Item>
          </Form>

          <div className="auth-footer">
            <Text className="auth-footer-text">
              Already have an account?{' '}
              <Link to="/login" className="auth-footer-link">
                Sign In
              </Link>
            </Text>
          </div>
        </div>
      </div>

      <LayoutFooter />
    </div>
  );
};

export default Register;
