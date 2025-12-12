import React from 'react';
import { Spin } from 'antd';
import { LoadingOutlined } from '@ant-design/icons';

// Full page loader overlay
export const PageLoader = ({ tip = 'Loading...' }) => {
  return (
    <div className="loader-overlay">
      <div style={{ textAlign: 'center' }}>
        <Spin
          indicator={<LoadingOutlined style={{ fontSize: 48, color: '#4f46e5' }} spin />}
        />
        <p style={{ color: 'white', marginTop: 16, fontSize: '0.875rem' }}>{tip}</p>
      </div>
    </div>
  );
};

// Inline loader for sections
export const SectionLoader = ({ tip = 'Loading...', height = 400 }) => {
  return (
    <div className="page-loader" style={{ minHeight: height }}>
      <Spin
        indicator={<LoadingOutlined style={{ fontSize: 40, color: '#4f46e5' }} spin />}
      />
      <p className="page-loader-text">{tip}</p>
    </div>
  );
};

// Small spinner for buttons
export const ButtonLoader = ({ size = 16 }) => {
  return (
    <LoadingOutlined style={{ fontSize: size }} spin />
  );
};

// Skeleton loader for cards
export const CardSkeleton = () => {
  return (
    <div 
      style={{ 
        background: 'var(--bg-tertiary)', 
        borderRadius: 16, 
        padding: 24,
        animation: 'pulse 2s infinite'
      }}
    >
      <div 
        style={{ 
          width: '60%', 
          height: 20, 
          background: 'var(--border-color)', 
          borderRadius: 4,
          marginBottom: 12 
        }} 
      />
      <div 
        style={{ 
          width: '40%', 
          height: 32, 
          background: 'var(--border-color)', 
          borderRadius: 4 
        }} 
      />
    </div>
  );
};

export default {
  PageLoader,
  SectionLoader,
  ButtonLoader,
  CardSkeleton,
};
