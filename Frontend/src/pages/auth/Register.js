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
        <Layout style={{
          overflow: 'auto',
          // backgroundColor: 'white'

        }}>

          <Content
            style={{
              margin: '10px 20px 0',
              flex: '1 0 auto',
              // backgroundColor: 'white'
            }}
          >
            <div
              style={{
                padding: 15,
                minHeight: '100%',
                // background: colorBgContainer,
                borderRadius: borderRadiusLG,
              }}
            >
      <Flex align='center' justify='centrer' vertical style={{ marginTop: '5vh' }}>
      <Flex align='center' justify='center'>
          <Image src='/main-logo.png' preview={false} height={150} width={150} />
        </Flex>
        <Card
          title={'TODO APP REGISTER USER'}
          style={{
            boxShadow: '0px 4px 8px rgba(0, 0, 0, 0.1)',
            marginTop: '5vh'
          }}
        >
          <Form
            form={form}
            onFinish={handleOnSubmit}
            layout='vertical'
            style={{ width: '400px' }}
          >

            <Form.Item label="Username" name="username"
              rules={[
                {
                  required: true,
                  message: 'please enter username',
                },
              ]}
            >
              <Input placeholder='enter username' size='large' />
            </Form.Item>

            <Form.Item label="Password" name="password"
              rules={[
                {
                  required: true,
                  message: 'please enter your password'
                },
              ]}
            >
              <Input.Password placeholder='enter password' size='large' />
            </Form.Item>

            <Form.Item label="Confirm Password" name="cfmPassword"
              rules={[
                {
                  required: true,
                  message: 'please enter your password'
                },
                ({ getFieldValue }) => ({
                  validator(_, value) {
                    return validatePassword(_, value);
                  },
                }),
              ]}
              dependencies={['password']}
            >
              <Input.Password placeholder='confirm password' size='large' />
            </Form.Item>

            <Form.Item>
              <Space direction='vertical' style={{ width: '100%' }}>
                <Button loading={loading} type="primary" size="large" htmlType="submit" style={{ width: '100%' }}>
                  Register
                </Button>
                <Text>Already have an account? <Link href="/login">Login!</Link> </Text>
              </Space>
            </Form.Item>

          </Form>
        </Card>
      </Flex>
      </div>
          </Content>
          <LayoutFooter />
        </Layout>
      </Layout>
    </>
  )
}

export default Register
