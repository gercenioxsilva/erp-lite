import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { I18nProvider }          from './i18n';
import { ModalProvider }         from './contexts/ModalContext';
import { Modal }         from './components/Modal';
import { LoginPage }    from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { Layout }       from './components/Layout';
import { DashboardPage }  from './pages/DashboardPage';
import { MaterialsPage }  from './pages/materials/MaterialsPage';
import { ClientsPage }    from './pages/clients/ClientsPage';
import { UsersPage }      from './pages/users/UsersPage';
import { OrdersPage }      from './pages/orders/OrdersPage';
import { InvoicesPage }    from './pages/invoices/InvoicesPage';
import { StockPage }       from './pages/stock/StockPage';
import { ReceivablesPage } from './pages/receivables/ReceivablesPage';
import { PayablesPage }    from './pages/payables/PayablesPage';
import { CompanyPage }     from './pages/company/CompanyPage';
import { ContractsPage }   from './pages/contracts/ContractsPage';

function GuardedRoutes() {
  const { user, loading } = useAuth();
  if (loading) return <div className="spinner">Carregando…</div>;
  if (!user)   return <Navigate to="/login" replace />;
  return (
    <Layout>
      <Routes>
        <Route path="/"           element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard"  element={<DashboardPage />} />
        <Route path="/clients"    element={<ClientsPage />} />
        <Route path="/materials"  element={<MaterialsPage />} />
        <Route path="/users"      element={<UsersPage />} />
        <Route path="/orders"      element={<OrdersPage />} />
        <Route path="/invoices"    element={<InvoicesPage />} />
        <Route path="/stock"       element={<StockPage />} />
        <Route path="/receivables" element={<ReceivablesPage />} />
        <Route path="/payables"    element={<PayablesPage />} />
        <Route path="/company"     element={<CompanyPage />} />
        <Route path="/contracts"   element={<ContractsPage />} />
        <Route path="*"            element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </Layout>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <I18nProvider>
        <ModalProvider>
          <AuthProvider>
            <Modal />
            <Routes>
              <Route path="/login"    element={<LoginPage />} />
              <Route path="/register" element={<RegisterPage />} />
              <Route path="/*"        element={<GuardedRoutes />} />
            </Routes>
          </AuthProvider>
        </ModalProvider>
      </I18nProvider>
    </BrowserRouter>
  );
}
