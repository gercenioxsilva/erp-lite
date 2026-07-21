import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { BrandingProvider }      from './branding/BrandingProvider';
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
import { ProjectsPage }    from './pages/projects/ProjectsPage';
import { InvoiceNewPage }  from './pages/invoices/InvoiceNewPage';
import { StockPage }       from './pages/stock/StockPage';
import { ReceivablesPage } from './pages/receivables/ReceivablesPage';
import { SuppliersPage }   from './pages/suppliers/SuppliersPage';
import { PayablesPage }    from './pages/payables/PayablesPage';
import { CompanyPage }     from './pages/company/CompanyPage';
import { ContractsPage }   from './pages/contracts/ContractsPage';
import { NfsePage }        from './pages/nfse/NfsePage';
import { NfseNewPage }     from './pages/nfse/NfseNewPage';
import { SimplesRemessaPage } from './pages/fiscal/SimplesRemessaPage';
import { FiscalPage } from './pages/fiscal/FiscalPage';
import { FiscalOverviewPage } from './pages/fiscal/FiscalOverviewPage';
import { AccountingPage } from './pages/accounting/AccountingPage';
import { ForgotPasswordPage } from './pages/auth/ForgotPasswordPage';
import { ResetPasswordPage }  from './pages/auth/ResetPasswordPage';
import { VerifyEmailPage }    from './pages/auth/VerifyEmailPage';
import { EmailNotVerifiedScreen } from './components/EmailNotVerifiedScreen';
import { ProposalsPage }      from './pages/proposals/ProposalsPage';
import { ProposalPublicPage } from './pages/proposals/ProposalPublicPage';
import { ProposalPrintPage }  from './pages/proposals/ProposalPrintPage';
import { ReportsPage }            from './pages/reports/ReportsPage';
import { DREPage }                from './pages/reports/DREPage';
import { CashflowPage }          from './pages/reports/CashflowPage';
import { AgingPage }             from './pages/reports/AgingPage';
import { ExpensesPage }          from './pages/reports/ExpensesPage';
import { PosCashReportPage }     from './pages/reports/PosCashReportPage';
import { OverduePage }           from './pages/reports/OverduePage';
import { TopProductsPage }       from './pages/reports/TopProductsPage';
import { CommissionsPage }       from './pages/reports/CommissionsPage';
import { SalesPage }                     from './pages/reports/SalesPage';
import { ProposalsFunnelPage }           from './pages/reports/ProposalsFunnelPage';
import { PosPaymentsPage }               from './pages/reports/PosPaymentsPage';
import { StockPositionPage }             from './pages/reports/StockPositionPage';
import { AbcPage }                       from './pages/reports/AbcPage';
import { KardexPage }                    from './pages/reports/KardexPage';
import { TechnicianProductivityPage }    from './pages/reports/TechnicianProductivityPage';
import { RecurringRevenuePage }          from './pages/reports/RecurringRevenuePage';
import { SupplierSpendPage }             from './pages/reports/SupplierSpendPage';
import { TaxSummaryPage }                from './pages/reports/TaxSummaryPage';
import { PurchaseOrdersPage }     from './pages/purchasing/PurchaseOrdersPage';
import { SupplierInvoicesPage }   from './pages/purchasing/SupplierInvoicesPage';
import { CostCentersPage }     from './pages/cost-centers/CostCentersPage';
import { CostCenterDetailPage } from './pages/cost-centers/CostCenterDetailPage';
import { PaymentPlansPage }    from './pages/payment-plans/PaymentPlansPage';
import { SellersPage }       from './pages/sellers/SellersPage';
import { SellerDetailPage }  from './pages/sellers/SellerDetailPage';
import { BillingPage }          from './pages/billing/BillingPage';
import { BillingSuccessPage }   from './pages/billing/BillingSuccessPage';
import { PosCaixaPage }         from './pages/pos/PosCaixaPage';
import { PosPage }              from './pages/pos/PosPage';
import { PosHistoryPage }       from './pages/pos/PosHistoryPage';
import { PosTerminalsPage }     from './pages/pos/PosTerminalsPage';
import { PosSessionsPage }     from './pages/pos/PosSessionsPage';
import { ServiceOrdersPage }   from './pages/service-orders/ServiceOrdersPage';
import { ServiceOrdersAgendaPage } from './pages/service-orders/ServiceOrdersAgendaPage';
import { SalesPipelinePage }   from './pages/sales-pipeline/SalesPipelinePage';
import { EmployeesPage }       from './pages/employees/EmployeesPage';
import { PayrollPage }         from './pages/payroll/PayrollPage';
import { PayslipPrintPage }    from './pages/payroll/PayslipPrintPage';
import { GuiaImpostosPrintPage } from './pages/fiscal/GuiaImpostosPrintPage';
import { ServiceOrderPrintPage } from './pages/service-orders/ServiceOrderPrintPage';
import { ContractBillingReceiptPrintPage } from './pages/contracts/ContractBillingReceiptPrintPage';
import { ContractPrintPage } from './pages/contracts/ContractPrintPage';
import { TechniciansPage }     from './pages/service-orders/TechniciansPage';
import { TechnicianLoginPage }       from './pages/technician/TechnicianLoginPage';
import { TechnicianVisitsPage }      from './pages/technician/TechnicianVisitsPage';
import { TechnicianVisitDetailPage } from './pages/technician/TechnicianVisitDetailPage';
import { RolesPage }        from './pages/users/RolesPage';
import { AccessDeniedPage } from './pages/AccessDeniedPage';
import { ProtectedRoute }   from './rbac';
import { SchedulingDashboardPage }  from './pages/scheduling/SchedulingDashboardPage';
import { SchedulingCalendarPage }   from './pages/scheduling/SchedulingCalendarPage';
import { BookingRequestsPage }      from './pages/scheduling/BookingRequestsPage';
import { AreasPage }                from './pages/scheduling/AreasPage';
import { ProfessionalsPage }        from './pages/scheduling/ProfessionalsPage';
import { ProfessionalDetailPage }   from './pages/scheduling/ProfessionalDetailPage';
import { PackageTemplatesPage }     from './pages/scheduling/PackageTemplatesPage';
import { SchedulingClientDetailPage } from './pages/scheduling/SchedulingClientDetailPage';
import { SchedulingSettingsPage }   from './pages/scheduling/SchedulingSettingsPage';
import { SchedulingOnboardingPage } from './pages/scheduling/SchedulingOnboardingPage';
import { WhatsAppPage } from './pages/whatsapp/WhatsAppPage';
import { PortalLayout }       from './pages/portal/PortalLayout';
import { PortalLoginPage }    from './pages/portal/PortalLoginPage';
import { PortalHomePage }     from './pages/portal/PortalHomePage';
import { PortalSessionsPage } from './pages/portal/PortalSessionsPage';
import { PortalBookingPage }  from './pages/portal/PortalBookingPage';
import { PortalPackagesPage } from './pages/portal/PortalPackagesPage';
import { PortalProfilePage }  from './pages/portal/PortalProfilePage';

function GuardedRoutes() {
  const { user, loading, tenantActivated } = useAuth();
  if (loading) return <div className="spinner">Carregando…</div>;
  if (!user)   return <Navigate to="/login" replace />;
  // Papel 'client' (portal de agendamentos) nunca navega o admin — o backend
  // já barra tudo via clientRoleGuard; aqui é UX (mesma dupla camada do técnico).
  if (user.role === 'client') return <Navigate to="/portal" replace />;

  // Ativação de conta por e-mail — só UX (o controle de acesso de verdade é
  // sempre tenantActivationGuard.ts no backend); evita renderizar um app
  // cheio de erros 403 pra um tenant ainda não verificado.
  if (!tenantActivated) return <EmailNotVerifiedScreen />;

  // Cada rota privada exige a permissão de visualização do seu módulo. Sem ela,
  // ProtectedRoute redireciona para /403. A autoridade real é o backend.
  const gate = (permission: string, element: JSX.Element) => (
    <ProtectedRoute permission={permission}>{element}</ProtectedRoute>
  );

  // Home por papel: o profissional não tem dashboard:view — mandá-lo pro
  // /dashboard era um /403 garantido logo após o login (fix de auditoria).
  const home = user.role === 'professional' ? '/scheduling' : '/dashboard';

  return (
    <Layout>
      <Routes>
        <Route path="/"           element={<Navigate to={home} replace />} />
        <Route path="/dashboard"  element={gate('dashboard:view', <DashboardPage />)} />
        <Route path="/clients"    element={gate('clients:view', <ClientsPage />)} />
        <Route path="/materials"  element={gate('materials:view', <MaterialsPage />)} />
        <Route path="/users"      element={gate('users:view', <UsersPage />)} />
        <Route path="/roles"      element={gate('roles:view', <RolesPage />)} />
        <Route path="/orders"      element={gate('orders:view', <OrdersPage />)} />
        <Route path="/projects"    element={gate('projects:view', <ProjectsPage />)} />
        <Route path="/invoices"     element={gate('invoices:view', <InvoicesPage />)} />
        <Route path="/invoices/new" element={gate('invoices:create', <InvoiceNewPage />)} />
        <Route path="/stock"       element={gate('stock:view', <StockPage />)} />
        <Route path="/receivables" element={gate('receivables:view', <ReceivablesPage />)} />
        <Route path="/suppliers"   element={gate('suppliers:view', <SuppliersPage />)} />
        <Route path="/payables"    element={gate('payables:view', <PayablesPage />)} />
        <Route path="/company"     element={gate('company:view', <CompanyPage />)} />
        <Route path="/contracts"   element={gate('contracts:view', <ContractsPage />)} />
        <Route path="/nfse"        element={gate('nfse:view', <NfsePage />)} />
        <Route path="/nfse/new"    element={gate('nfse:emit', <NfseNewPage />)} />
        {/* TODO(follow-up RBAC): simples-remessa e sales-pipeline são módulos novos
            de develop, sem chave no catálogo de permissões ainda — deixados sem
            gate() para não bloquear ninguém além do owner até o catálogo cobrir. */}
        <Route path="/simples-remessa" element={<SimplesRemessaPage />} />
        <Route path="/fiscal"          element={gate('fiscal:view', <FiscalOverviewPage />)} />
        <Route path="/fiscal/pipeline" element={gate('fiscal:view', <FiscalPage />)} />
        <Route path="/contabil"        element={gate('contabil:view', <AccountingPage />)} />
        <Route path="/proposals"       element={gate('proposals:view', <ProposalsPage />)} />
        <Route path="/reports"              element={gate('reports:view', <ReportsPage />)} />
        <Route path="/reports/cashflow"     element={gate('reports:view', <CashflowPage />)} />
        <Route path="/reports/aging"        element={gate('reports:view', <AgingPage />)} />
        <Route path="/reports/expenses"     element={gate('reports:view', <ExpensesPage />)} />
        <Route path="/reports/pos-cash"     element={gate('reports:view', <PosCashReportPage />)} />
        <Route path="/reports/overdue"      element={gate('reports:view', <OverduePage />)} />
        <Route path="/reports/top-products" element={gate('reports:view', <TopProductsPage />)} />
        <Route path="/reports/commissions"  element={gate('reports:view', <CommissionsPage />)} />
        <Route path="/reports/sales"                    element={gate('reports:view', <SalesPage />)} />
        <Route path="/reports/proposals-funnel"         element={gate('reports:view', <ProposalsFunnelPage />)} />
        <Route path="/reports/pos-payments"             element={gate('reports:view', <PosPaymentsPage />)} />
        <Route path="/reports/stock-position"           element={gate('reports:view', <StockPositionPage />)} />
        <Route path="/reports/abc"                      element={gate('reports:view', <AbcPage />)} />
        <Route path="/reports/kardex"                   element={gate('reports:view', <KardexPage />)} />
        <Route path="/reports/technician-productivity"  element={gate('reports:view', <TechnicianProductivityPage />)} />
        <Route path="/reports/recurring-revenue"        element={gate('reports:view', <RecurringRevenuePage />)} />
        <Route path="/reports/supplier-spend"           element={gate('reports:view', <SupplierSpendPage />)} />
        <Route path="/reports/tax-summary"              element={gate('reports:view', <TaxSummaryPage />)} />
        <Route path="/cost-centers"     element={gate('cost_centers:view', <CostCentersPage />)} />
        <Route path="/cost-centers/:id" element={gate('cost_centers:view', <CostCenterDetailPage />)} />
        <Route path="/payment-plans"    element={gate('payment_plans:view', <PaymentPlansPage />)} />
        <Route path="/sellers"     element={gate('sellers:view', <SellersPage />)} />
        <Route path="/sellers/:id" element={gate('sellers:view', <SellerDetailPage />)} />
        <Route path="/purchase-orders"   element={gate('purchase_orders:view', <PurchaseOrdersPage />)} />
        <Route path="/supplier-invoices" element={gate('supplier_invoices:view', <SupplierInvoicesPage />)} />
        <Route path="/dre"               element={gate('reports:view', <DREPage />)} />
        <Route path="/billing"         element={gate('billing:manage', <BillingPage />)} />
        <Route path="/billing/success" element={gate('billing:manage', <BillingSuccessPage />)} />
        <Route path="/pos/caixa"       element={gate('pos:view', <PosCaixaPage />)} />
        <Route path="/pos"             element={gate('pos:view', <PosPage />)} />
        <Route path="/pos/sales"       element={gate('pos:view', <PosHistoryPage />)} />
        <Route path="/pos/terminals"   element={gate('pos:manage', <PosTerminalsPage />)} />
        <Route path="/pos/sessions"    element={gate('pos:view', <PosSessionsPage />)} />
        <Route path="/service-orders"  element={gate('service_orders:view', <ServiceOrdersPage />)} />
        <Route path="/service-orders/agenda" element={gate('service_orders:view', <ServiceOrdersAgendaPage />)} />
        {/* TODO(follow-up RBAC): sales-pipeline é módulo novo de develop, sem chave
            no catálogo ainda — ver nota acima em simples-remessa. */}
        <Route path="/sales-pipeline"  element={<SalesPipelinePage />} />
        <Route path="/whatsapp"  element={gate('whatsapp:view', <WhatsAppPage />)} />
        <Route path="/technicians"     element={gate('technicians:view', <TechniciansPage />)} />
        {/* RH Simplificado (módulo 'hr', mergeado de develop) — gated pelo
            catálogo RBAC; /access-profiles foi superseded pela tela /roles. */}
        <Route path="/employees"       element={gate('employees:view', <EmployeesPage />)} />
        <Route path="/payroll"         element={gate('payroll:view', <PayrollPage />)} />
        <Route path="/scheduling"                    element={gate('scheduling:view', <SchedulingDashboardPage />)} />
        <Route path="/scheduling/onboarding"         element={gate('scheduling:settings', <SchedulingOnboardingPage />)} />
        <Route path="/scheduling/calendar"           element={gate('scheduling:view', <SchedulingCalendarPage />)} />
        <Route path="/scheduling/requests"           element={gate('scheduling:view', <BookingRequestsPage />)} />
        <Route path="/scheduling/areas"              element={gate('scheduling_areas:view', <AreasPage />)} />
        <Route path="/scheduling/professionals"      element={gate('scheduling_professionals:view', <ProfessionalsPage />)} />
        <Route path="/scheduling/professionals/:id"  element={gate('scheduling_professionals:view', <ProfessionalDetailPage />)} />
        <Route path="/scheduling/package-templates"  element={gate('scheduling_packages:view', <PackageTemplatesPage />)} />
        <Route path="/scheduling/clients/:id"        element={gate('scheduling:view', <SchedulingClientDetailPage />)} />
        <Route path="/scheduling/settings"           element={gate('scheduling:settings', <SchedulingSettingsPage />)} />
        <Route path="/403"             element={<AccessDeniedPage />} />
        <Route path="*"                element={<Navigate to={home} replace />} />
      </Routes>
    </Layout>
  );
}

export function App() {
  // Ordem dos providers: AuthProvider primeiro (fonte de segment_key/branding),
  // depois BrandingProvider (aplica cores + expõe o preset), depois I18nProvider
  // (layer de override de label consome o preset) e ModalProvider por último.
  return (
    <BrowserRouter>
      <AuthProvider>
        <BrandingProvider>
          <I18nProvider>
            <ModalProvider>
              <Modal />
              <Routes>
              <Route path="/login"           element={<LoginPage />} />
              <Route path="/register"        element={<RegisterPage />} />
              <Route path="/forgot-password" element={<ForgotPasswordPage />} />
              <Route path="/reset-password"  element={<ResetPasswordPage />} />
              <Route path="/verify-email"    element={<VerifyEmailPage />} />
              <Route path="/p/:token"        element={<ProposalPublicPage />} />
              <Route path="/proposals/:id/print" element={<ProposalPrintPage />} />
              <Route path="/service-orders/:id/print" element={<ServiceOrderPrintPage />} />
              <Route path="/contracts/:contractId/billings/:billingId/receipt" element={<ContractBillingReceiptPrintPage />} />
              <Route path="/contracts/:contractId/print" element={<ContractPrintPage />} />
              <Route path="/payroll/entries/:id/print" element={<PayslipPrintPage />} />
              <Route path="/fiscal/apuracao/:id/guia" element={<GuiaImpostosPrintPage />} />
              <Route path="/tecnico/entrar"          element={<TechnicianLoginPage />} />
              <Route path="/tecnico/visitas"         element={<TechnicianVisitsPage />} />
              <Route path="/tecnico/visitas/:id"     element={<TechnicianVisitDetailPage />} />
              {/* Portal do Cliente (agendamentos) — mesmo padrão do portal do
                  técnico: grupo próprio fora do GuardedRoutes, shell mínimo. */}
              <Route path="/portal/entrar" element={<PortalLoginPage />} />
              <Route path="/portal" element={<PortalLayout />}>
                <Route index          element={<PortalHomePage />} />
                <Route path="sessoes" element={<PortalSessionsPage />} />
                <Route path="agendar" element={<PortalBookingPage />} />
                <Route path="pacotes" element={<PortalPackagesPage />} />
                <Route path="perfil"  element={<PortalProfilePage />} />
              </Route>
              <Route path="/*"               element={<GuardedRoutes />} />
            </Routes>
            </ModalProvider>
          </I18nProvider>
        </BrandingProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
