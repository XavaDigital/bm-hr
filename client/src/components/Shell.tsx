import { Layout, Menu, Space, Typography, Button } from 'antd';
import { TeamOutlined, UploadOutlined, LogoutOutlined, DollarOutlined, SettingOutlined, HomeOutlined, CalendarOutlined } from '@ant-design/icons';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const { Sider, Content, Header } = Layout;

export function Shell() {
  const { user, signOut } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const p = location.pathname;
  const selected = p.startsWith('/team')
    ? 'team'
    : p.startsWith('/leave')
      ? 'leave'
      : p.startsWith('/pay-runs')
        ? 'pay-runs'
        : p.startsWith('/import')
          ? 'import'
          : p.startsWith('/settings')
            ? 'settings'
            : 'home';

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider breakpoint="lg" collapsedWidth={0} theme="dark">
        <div className="brand">BeastMode HR</div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[selected]}
          items={[
            { key: 'home', icon: <HomeOutlined />, label: <Link to="/">Today</Link> },
            { key: 'team', icon: <TeamOutlined />, label: <Link to="/team">Team</Link> },
            { key: 'leave', icon: <CalendarOutlined />, label: <Link to="/leave">Leave</Link> },
            { key: 'pay-runs', icon: <DollarOutlined />, label: <Link to="/pay-runs">Pay runs</Link> },
            { key: 'import', icon: <UploadOutlined />, label: <Link to="/import">Import CSV</Link> },
            { key: 'settings', icon: <SettingOutlined />, label: <Link to="/settings">Settings</Link> },
          ]}
        />
      </Sider>
      <Layout>
        <Header style={{ background: '#fff', padding: '0 24px', display: 'flex', justifyContent: 'flex-end', alignItems: 'center' }}>
          <Space>
            <Typography.Text className="muted">{user?.email}</Typography.Text>
            <Button
              icon={<LogoutOutlined />}
              onClick={async () => {
                await signOut();
                navigate('/login');
              }}
            >
              Sign out
            </Button>
          </Space>
        </Header>
        <Content>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}
