import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { LoginPage }    from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { Layout }       from './components/Layout';
import { DashboardPage }    from './pages/DashboardPage';
import { MaterialsPage }    from './pages/materials/MaterialsPage';
import { ClientsPage }      from './pages/clients/ClientsPage';

function GuardedRoutes() {
  const { user, loading } = useAuth();
  if (loading) return <div className="spinner">Loading…</div>;
  if (!user)   return <Navigate to="/login" replace />;
  return (
    <Layout>
      <Routes>
        <Route path="/"         element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard"  element={<DashboardPage />} />
        <Route path="/clients"    element={<ClientsPage />} />
        <Route path="/materials"  element={<MaterialsPage />} />
        <Route path="*"           element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </Layout>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login"    element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/*"        element={<GuardedRoutes />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
