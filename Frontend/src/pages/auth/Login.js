import { Flex, Input, Form, Button, Card, Space, Typography, Image, Layout, theme } from 'antd'
import Link from 'antd/es/typography/Link'
import React, { useState } from 'react'
import AuthService from '../../utils/AuthService/AuthService';
import LayoutFooter from '../../layout/LayoutFooter';

const { Text } = Typography;
const { Content } = Layout;

const Login = () => {

  const [loading, setLoading] = useState(false);

  const {
    token: { borderRadiusLG },
  } = theme.useToken();

  const handleOnSubmt = async (values) => {
    setLoading(true);
    const res = await AuthService.Login(values);
    if (!res) {
      setLoading(false);
    }
  }

  return (
    <>
      <Layout style={{ height: '100vh' }}>
        <Layout style={{ overflow: 'auto' }}>
          <Content style={{ margin: '10px 20px 0', flex: '1 0 auto' }}>
            <div style={{ padding: 15, minHeight: '100%' }}>
              <Flex align='center' justify='centrer' vertical style={{ marginTop: '10vh' }}>
                <Flex align='center' justify='center'>
                  <Image src='/main-logo.png' preview={false} height={150} width={150} />
                </Flex>
                <div style={{ maxWidth: '450px', width: '100%', margin: '0 auto' }}>
                  <Card
                    title={<Text>TODO APP LOGIN</Text>}
                    style={{ boxShadow: '0px 4px 8px rgba(0, 0, 0, 0.1)', marginTop: '5vh' }}
                  >
                    <Form onFinish={handleOnSubmt} layout='vertical'>
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
                      <Form.Item>
                        <Space direction='vertical' style={{ width: '100%' }}>
                          <Button loading={loading} type="primary" size="large" htmlType="submit" style={{ width: '100%' }}>
                            Login
                          </Button>
                          <Text>Don't have an account? <Link href="/register">Register here!</Link> </Text>
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

export default Login;
