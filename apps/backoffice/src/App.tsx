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
import { InvoiceNewPage }  from './pages/invoices/InvoiceNewPage';
import { StockPage }       from './pages/stock/StockPage';
import { ReceivablesPage } from './pages/receivables/ReceivablesPage';
import { SuppliersPage }   from './pages/suppliers/SuppliersPage';
import { PayablesPage }    from './pages/payables/PayablesPage';
import { CompanyPage }     from './pages/company/CompanyPage';
import { ContractsPage }   from './pages/contracts/ContractsPage';
import { NfsePage }        from './pages/nfse/NfsePage';
import { ForgotPasswordPage } from './pages/auth/ForgotPasswordPage';
import { ResetPasswordPage }  from './pages/auth/ResetPasswordPage';
import { ProposalsPage }      from './pages/proposals/ProposalsPage';
import { ProposalPublicPage } from './pages/proposals/ProposalPublicPage';
import { ReportsPage }        from './pages/reports/ReportsPage';
import { CostCentersPage }    from './pages/cost-centers/CostCentersPage';
import { CostCenterDetailPage } from './pages/cost-centers/CostCenterDetailPage';

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
        <Route path="/invoices"     element={<InvoicesPage />} />
        <Route path="/invoices/new" element={<InvoiceNewPage />} />
        <Route path="/stock"       element={<StockPage />} />
        <Route path="/receivables" element={<ReceivablesPage />} />
        <Route path="/suppliers"   element={<SuppliersPage />} />
        <Route path="/payables"    element={<PayablesPage />} />
        <Route path="/company"     element={<CompanyPage />} />
        <Route path="/contracts"   element={<ContractsPage />} />
        <Route path="/nfse"        element={<NfsePage />} />
        <Route path="/proposals"   element={<ProposalsPage />} />
        <Route path="/reports"          element={<ReportsPage />} />
        <Route path="/cost-centers"     element={<CostCentersPage />} />
        <Route path="/cost-centers/:id" element={<CostCenterDetailPage />} />
        <Route path="*"                 element={<Navigate to="/dashboard" replace />} />
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
              <Route path="/login"           element={<LoginPage />} />
              <Route path="/register"        element={<RegisterPage />} />
              <Route path="/forgot-password" element={<ForgotPasswordPage />} />
              <Route path="/reset-password"  element={<ResetPasswordPage />} />
              <Route path="/p/:token"        element={<ProposalPublicPage />} />
              <Route path="/*"               element={<GuardedRoutes />} />
            </Routes>
          </AuthProvider>
        </ModalProvider>
      </I18nProvider>
    </BrowserRouter>
  );
}
