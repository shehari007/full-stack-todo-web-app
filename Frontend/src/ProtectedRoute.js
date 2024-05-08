import React from "react";
import { Navigate, Outlet } from "react-router-dom";
import MainLayout from "./layout/MainLayout";

export const ProtectedRoute = () => {

    const isAuthenticated = sessionStorage.getItem('JWTAccessToken')
    if (!isAuthenticated) {
        return <Navigate to='/login' replace />
    }
    return (
        <MainLayout>
        <Outlet />
        </MainLayout>
    );
};