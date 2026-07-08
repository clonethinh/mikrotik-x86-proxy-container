import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { Spin } from 'antd';
import { useAuth } from './services/auth';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import FleetPage from './pages/FleetPage';
import ProxiesPage from './pages/ProxiesPage';
import WanPage from './pages/WanPage';
import AuditPage from './pages/AuditPage';
import SettingsPage from './pages/SettingsPage';
import DevicesPage from './pages/DevicesPage';
import AppLayout from './components/AppLayout';

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <div style={{ display: 'flex', justifyContent: 'center', padding: 80 }}><Spin size="large" /></div>;
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  return <>{children}</>;
}

export default function App() {
  const { init } = useAuth();
  useEffect(() => { init(); }, []);

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<RequireAuth><AppLayout /></RequireAuth>}>
          <Route path="/" element={<Navigate to="/fleet" replace />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/fleet" element={<FleetPage />} />
          <Route path="/proxies" element={<ProxiesPage />} />
          <Route path="/wan" element={<WanPage />} />
          <Route path="/devices" element={<DevicesPage />} />
          <Route path="/audit" element={<AuditPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}