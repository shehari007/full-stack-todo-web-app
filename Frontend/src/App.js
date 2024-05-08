import './App.css';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Login from './pages/auth/Login';
import Register from './pages/auth/Register';
import { ProtectedRoute } from './ProtectedRoute';
import Home from './pages/home/Home';
function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/home/todolist" />} />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/home" element={<ProtectedRoute />}>
          <Route path="todolist" element={<Home />} />
        </Route>
        {/* <Route path="*" element={<Error404 />} /> */}
      </Routes>
    </BrowserRouter>
  );
}

export default App;
