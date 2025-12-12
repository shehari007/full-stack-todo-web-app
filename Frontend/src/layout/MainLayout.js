import React from 'react';
import LayoutHeader from './LayoutHeader';
import LayoutFooter from './LayoutFooter';

const MainLayout = ({ children }) => {
  return (
    <div className="app-container">
      <LayoutHeader />
      <main className="main-content slide-up">
        {children}
      </main>
      <LayoutFooter />
    </div>
  );
};

export default MainLayout;