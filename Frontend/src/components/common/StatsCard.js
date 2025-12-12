import React from 'react';
import { 
  CheckCircleOutlined, 
  ClockCircleOutlined, 
  UnorderedListOutlined,
  ExclamationCircleOutlined 
} from '@ant-design/icons';

const iconMap = {
  total: <UnorderedListOutlined />,
  completed: <CheckCircleOutlined />,
  pending: <ClockCircleOutlined />,
  overdue: <ExclamationCircleOutlined />,
};

const StatsCard = ({ 
  title, 
  value, 
  icon = 'total', 
  variant = 'primary',
  subtitle = null 
}) => {
  const getIcon = () => {
    if (React.isValidElement(icon)) {
      return icon;
    }
    return iconMap[icon] || iconMap.total;
  };

  return (
    <div className={`stat-card stat-card-${variant} fade-in`}>
      <div className="stat-icon">
        {getIcon()}
      </div>
      <div className="stat-value">{value}</div>
      <div className="stat-label">{title}</div>
      {subtitle && (
        <div style={{ fontSize: '0.75rem', opacity: 0.8, marginTop: 4 }}>
          {subtitle}
        </div>
      )}
    </div>
  );
};

export const StatsGrid = ({ children }) => {
  return <div className="stats-grid">{children}</div>;
};

export default StatsCard;
