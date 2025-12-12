import React from 'react';
import { InboxOutlined } from '@ant-design/icons';
import { Button } from 'antd';

const EmptyState = ({ 
  icon = <InboxOutlined />,
  title = 'No data found',
  description = 'There are no items to display.',
  actionText = null,
  onAction = null
}) => {
  return (
    <div className="empty-state fade-in">
      <div className="empty-state-icon">
        {icon}
      </div>
      <h3 className="empty-state-title">{title}</h3>
      <p className="empty-state-text">{description}</p>
      {actionText && onAction && (
        <Button type="primary" size="large" onClick={onAction}>
          {actionText}
        </Button>
      )}
    </div>
  );
};

export default EmptyState;
