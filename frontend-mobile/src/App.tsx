import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { Spinner } from '@heroui/react';
import { useAuth } from './services/auth';
import { routerBasename } from './lib/routerBasename';
import MobileShell from './components/layout/MobileShell';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import FleetPage from './pages/FleetPage';
import ProxiesPage from './pages/ProxiesPage';
import WanPage from './pages/WanPage';
import DevicesPage from './pages/DevicesPage';
import AuditPage from './pages/AuditPage';
import SettingsPage from './pages/SettingsPage';
import MorePage from './pages/MorePage';

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  return <>{children}</>;
}

export default function App() {
  const { init } = useAuth();
  useEffect(() => { init(); }, [init]);

  return (
    <BrowserRouter basename={routerBasename()}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<RequireAuth><MobileShell /></RequireAuth>}>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/fleet" element={<FleetPage />} />
          <Route path="/proxies" element={<ProxiesPage />} />
          <Route path="/wan" element={<WanPage />} />
          <Route path="/more" element={<MorePage />} />
          <Route path="/devices" element={<DevicesPage />} />
          <Route path="/audit" element={<AuditPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}