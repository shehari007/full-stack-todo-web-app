import { Flex, Input, Form, Button, Card, Space, Typography, Image, Layout, theme } from 'antd'
import Link from 'antd/es/typography/Link';
import React, { useState } from 'react'
import AuthService from '../../utils/AuthService/AuthService';
import LayoutFooter from '../../layout/LayoutFooter';

const { Text } = Typography;
const { Content } = Layout;

const Register = () => {
  const [loading, setLoading] = useState(false);
  const {
    token: { borderRadiusLG },
  } = theme.useToken();
  const [form] = Form.useForm();

  const handleOnSubmit = async (values) => {
    setLoading(true);
    const newValues = { ...values };
    delete newValues.cfmPassword;
    const res = await AuthService.Register(newValues);
    if (!res) {
      setLoading(false);
    }
  }

  const validatePassword = async (_, value) => {
    const password = form.getFieldValue('password');
    if (value && value !== password) {
      throw new Error('The passwords do not match');
    }
  };

  return (
    <>
      <Layout style={{ height: '100vh' }}>
        <Layout style={{ overflow: 'auto' }}>
          <Content style={{ margin: '10px 20px 0', flex: '1 0 auto' }}>
            <div style={{ padding: 15, minHeight: '100%' }}>
              <Flex align='center' justify='centrer' vertical style={{ marginTop: '5vh' }}>
                <Flex align='center' justify='center'>
                  <Image src='/main-logo.png' preview={false} height={150} width={150} />
                </Flex>
                <div style={{ maxWidth: '450px', width: '100%', margin: '0 auto' }}>
                  <Card
                    title={'TODO APP REGISTER USER'}
                    style={{ boxShadow: '0px 4px 8px rgba(0, 0, 0, 0.1)', marginTop: '5vh' }}
                  >
                    <Form
                      form={form}
                      onFinish={handleOnSubmit}
                      layout='vertical'
                    >

                      <Form.Item
                        label="Username"
                        name="username"
                        rules={[
                          {
                            required: true,
                            message: 'Please enter username',
                          },
                        ]}
                      >
                        <Input placeholder='Enter username' size='large' />
                      </Form.Item>

                      <Form.Item
                        label="Password"
                        name="password"
                        rules={[
                          {
                            required: true,
                            message: 'Please enter your password'
                          },
                        ]}
                      >
                        <Input.Password placeholder='Enter password' size='large' />
                      </Form.Item>

                      <Form.Item
                        label="Confirm Password"
                        name="cfmPassword"
                        rules={[
                          {
                            required: true,
                            message: 'Please enter your password'
                          },
                          ({ getFieldValue }) => ({
                            validator(_, value) {
                              return validatePassword(_, value);
                            },
                          }),
                        ]}
                        dependencies={['password']}
                      >
                        <Input.Password placeholder='Confirm password' size='large' />
                      </Form.Item>

                      <Form.Item>
                        <Space direction='vertical' style={{ width: '100%' }}>
                          <Button loading={loading} type="primary" size="large" htmlType="submit" style={{ width: '100%' }}>
                            Register
                          </Button>
                          <Text>Already have an account? <Link href="/login">Login here!</Link> </Text>
                        </Space>
                      </Form.Item>

                    </Form>
                  </Card>
                </div>
              </Flex>
            </div>
          </Content>
          <LayoutFooter />
        </Layout>
      </Layout>
    </>
  )
}

export default Register;
