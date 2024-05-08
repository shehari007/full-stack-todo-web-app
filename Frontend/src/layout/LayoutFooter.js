import React from 'react'
import { Flex, Layout, Typography, theme } from 'antd'
const { Footer } = Layout;
const { Text, Link } = Typography;
const LayoutFooter = () => {
    const {
        token: { colorBgContainer },
    } = theme.useToken();
    return (
        <Footer style={{ marginTop: '5vh', boxShadow: '0 -5px 5px -5px #333', backgroundColor: colorBgContainer }}>
            <Flex justify="center" align="center">
                <Text style={{ textAlign: 'center' }}>Open Source Full Stack Todo Web App <br /> Project GitHub Link: <Link href="https://github.com/shehari007/todo-web-app" target="_blank">click here</Link> <br/> <Text>Developed By: <Link style={{textAlign:"center"}} href="https://github.com/shehari007" target="_blank">Muhammad Sheharyar Butt</Link></Text></Text>
            </Flex>
        </Footer>
    )
}

export default LayoutFooter
