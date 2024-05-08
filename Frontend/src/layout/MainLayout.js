import React from 'react';
import { Layout, theme } from 'antd';
import LayoutHeader from './LayoutHeader';
import LayoutFooter from './LayoutFooter';

const { Content } = Layout;

const MainLayout = ({ children }) => {
  const {
    token: { borderRadiusLG },
  } = theme.useToken();

  return (
    <Layout style={{ height: '100vh' }}>
      <Layout style={{
        overflow: 'auto',
        // backgroundColor: 'white'

      }}>
        <LayoutHeader />
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
            {children}
          </div>
        </Content>
        <LayoutFooter/>
      </Layout>
    </Layout>
  );
};
export default MainLayout;