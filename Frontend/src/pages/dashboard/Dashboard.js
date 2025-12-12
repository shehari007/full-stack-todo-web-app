import React, { useEffect, useState, useMemo } from 'react';
import { Typography } from 'antd';
import { 
  CheckCircleOutlined, 
  ClockCircleOutlined, 
  UnorderedListOutlined,
  CalendarOutlined
} from '@ant-design/icons';
import TodoList from '../../components/todo/TodoList';
import StatsCard, { StatsGrid } from '../../components/common/StatsCard';
import { SectionLoader } from '../../components/common/Loader';
import TodoListService from '../../utils/TodoListService/TodoListService';
import { isDueToday } from '../../utils/dateUtils';

const { Title, Text } = Typography;

const Dashboard = () => {
  const [todos, setTodos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  const fetchTodos = async () => {
    setLoading(true);
    try {
      const data = await TodoListService.GetAllTodoList();
      setTodos(data || []);
    } catch (error) {
      console.error('Failed to fetch todos:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTodos();
  }, [refreshKey]);

  const handleRefresh = () => {
    setRefreshKey(prev => prev + 1);
  };

  // Calculate statistics
  const stats = useMemo(() => {
    const total = todos.length;
    const completed = todos.filter(todo => todo.checked).length;
    const pending = total - completed;
    
    // Today's tasks
    const todayTasks = todos.filter(todo => isDueToday(todo.time)).length;

    // Completion rate
    const completionRate = total > 0 ? Math.round((completed / total) * 100) : 0;

    return { total, completed, pending, todayTasks, completionRate };
  }, [todos]);

  const username = localStorage.getItem('User') || 'User';
  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good Morning';
    if (hour < 18) return 'Good Afternoon';
    return 'Good Evening';
  }, []);

  if (loading && todos.length === 0) {
    return <SectionLoader tip="Loading your tasks..." />;
  }

  return (
    <div className="dashboard fade-in">
      {/* Welcome Section */}
      <div style={{ marginBottom: 32 }}>
        <Title level={2} style={{ marginBottom: 4 }}>
          {greeting}, {username}! 👋
        </Title>
        <Text type="secondary" style={{ fontSize: '1rem' }}>
          {stats.pending > 0 
            ? `You have ${stats.pending} pending task${stats.pending > 1 ? 's' : ''} to complete`
            : 'All caught up! Great job! 🎉'
          }
        </Text>
      </div>

      {/* Stats Cards */}
      <StatsGrid>
        <StatsCard
          title="Total Tasks"
          value={stats.total}
          icon={<UnorderedListOutlined />}
          variant="primary"
        />
        <StatsCard
          title="Completed"
          value={stats.completed}
          icon={<CheckCircleOutlined />}
          variant="success"
          subtitle={`${stats.completionRate}% completion rate`}
        />
        <StatsCard
          title="Pending"
          value={stats.pending}
          icon={<ClockCircleOutlined />}
          variant="warning"
        />
        <StatsCard
          title="Due Today"
          value={stats.todayTasks}
          icon={<CalendarOutlined />}
          variant="danger"
        />
      </StatsGrid>

      {/* Todo List */}
      <TodoList 
        todos={todos} 
        loading={loading} 
        onRefresh={handleRefresh}
      />
    </div>
  );
};

export default Dashboard;
