import Fastify, { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import cors from '@fastify/cors';
import sensible from '@fastify/sensible';
import multipart from '@fastify/multipart';
import jwt from '@fastify/jwt';
// customersRoutes: import removida junto com o registro abaixo (hotfix de
// segurança 2026-07-08) — ver comentário na chamada de app.register comentada.
import { materialsRoutes } from './routes/materials';
import { authRoutes }      from './routes/auth';
import { clientsRoutes }   from './routes/clients';
import { usersRoutes }     from './routes/users';
import { ordersRoutes }    from './routes/orders';
import { invoicesRoutes }  from './routes/invoices';
import { taxRoutes }       from './routes/tax';
import { nfeRoutes }                from './routes/nfe';
import { nfseRoutes }               from './routes/nfse';
import { simplesRemessaRoutes }     from './routes/simplesRemessa';
import { salesPipelineRoutes }      from './routes/salesPipeline';
import { employeesRoutes }          from './routes/employees';
import { payrollRoutes }            from './routes/payroll';
import { notificationConfigRoutes } from './routes/notificationConfig';
import { receivablesRoutes }        from './routes/receivables';
import { suppliersRoutes }          from './routes/suppliers';
import { payablesRoutes }           from './routes/payables';
import { tenantRoutes }             from './routes/tenant';
import { billingRoutes }            from './routes/billing';
import { clientContactsRoutes }     from './routes/clientContacts';
import { supplierContactsRoutes }   from './routes/supplierContacts';
import { companiesRoutes }          from './routes/companies';
import { fiscalCompanyConfigRoutes } from './routes/fiscalCompanyConfig';
import { fiscalImportsRoutes }       from './routes/fiscalImports';
import { bankAccountsRoutes }       from './routes/bankAccounts';
import { marketplaceIntegrationRoutes }   from './routes/marketplaceIntegration';
import { materialMarketplaceLinksRoutes } from './routes/materialMarketplaceLinks';
import { marketplaceWebhookRoutes }       from './routes/marketplaceWebhook';
import { whatsappRoutes }           from './routes/whatsapp';
import { whatsappWebhookRoutes }    from './routes/whatsappWebhook';
import { serviceContractsRoutes }   from './routes/serviceContracts';
import { materialImagesRoutes }     from './routes/materialImages';
import { dashboardRoutes }                                          from './routes/dashboard';
import { proposalsRoutes }    from './routes/proposals';
import { publicRoutes }       from './routes/public';
import { reportsRoutes }      from './routes/reports';
import { costCentersRoutes }  from './routes/costCenters';
import { sellersRoutes }         from './routes/sellers';
import { purchaseOrdersRoutes }  from './routes/purchaseOrders';
import { supplierInvoicesRoutes } from './routes/supplierInvoices';
import { subscriptionRoutes, subscriptionWebhookRoute } from './routes/subscription';
import { posRoutes }           from './routes/pos';
import { tenantModulesRoutes }     from './routes/tenantModules';
import { techniciansRoutes }       from './routes/technicians';
import { serviceOrdersRoutes }     from './routes/serviceOrders';
import { technicianPortalRoutes }  from './routes/technicianPortal';
import { rbacRoutes }            from './routes/rbac';
import { schedulingRoutes }      from './routes/scheduling';
import { schedulingSessionsRoutes } from './routes/schedulingSessions';
import { schedulingPortalRoutes }   from './routes/schedulingPortal';
import { calendarIntegrationRoutes } from './routes/calendarIntegration';
import { subscriptionGuard } from './middleware/subscriptionGuard';
import { technicianRoleGuard } from './middleware/technicianRoleGuard';
import { clientRoleGuard } from './middleware/clientRoleGuard';
import { syncRbacCatalog } from './rbac/syncRbacCatalog';
import { tenantActivationGuard } from './middleware/tenantActivationGuard';
import { startNfeResultsWorker, stopNfeResultsWorker }             from './workers/nfeResultsWorker';
import { startBoletoResultsWorker, stopBoletoResultsWorker }       from './workers/boletoResultsWorker';
import { startContractBillingWorker, stopContractBillingWorker }   from './workers/contractBillingWorker';
import { startRecurringPayablesWorker, stopRecurringPayablesWorker } from './workers/recurringPayablesWorker';
import { startDueSoonWorker, stopDueSoonWorker }                    from './workers/dueSoonWorker';
import { startMarketplaceSyncResultsWorker, stopMarketplaceSyncResultsWorker } from './workers/marketplaceSyncResultsWorker';
import { startWhatsAppResultsWorker, stopWhatsAppResultsWorker } from './workers/whatsappResultsWorker';
import { startWhatsAppBillingWorker, stopWhatsAppBillingWorker } from './workers/whatsappBillingWorker';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
    },
    // Fastify's default (1 MiB) is far below what proposal-banner uploads need.
    // routes/tenant.ts checks the base64 string against MAX_BANNER_BYTES (7 MB,
    // itself sized for a 5 MB raw file once base64-inflated) — this needs
    // headroom above THAT 7 MB figure, not the user-facing "5 MB" one.
    bodyLimit: 8 * 1024 * 1024,
  });

  await app.register(cors, { origin: true });
  await app.register(sensible);
  // Upload de arquivos de importação fiscal (OFX/CSV/XLSX) — parse no backend.
  // Limite acima do bodyLimit JSON: extratos reais chegam a dezenas de MB.
  await app.register(multipart, { limits: { fileSize: 25 * 1024 * 1024, files: 1, parts: 20 } });
  await app.register(jwt, {
    secret: process.env.JWT_SECRET || 'dev-secret-change-in-production',
  });

  app.decorate('authenticate', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
    } catch (err) {
      reply.send(err);
    }
  });

  app.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }));

  await app.register(authRoutes,      { prefix: '/v1' });
  // customersRoutes DESREGISTRADO (hotfix de segurança, 2026-07-08): CRUD direto
  // na tabela `tenants` sem authenticate e sem NENHUM filtro de tenant — qualquer
  // um sem login podia listar/editar/cancelar qualquer empresa do SaaS. Sem
  // caller conhecido no repo (frontend/scripts/testes) — parece resíduo de
  // bootstrap nunca protegido. Cross-tenant por natureza (opera sobre `tenants`,
  // não sobre dados de UM tenant), então não faz sentido virar RBAC tenant-scoped
  // como as demais rotas — nenhum papel hoje deveria ter esse poder. Reversível:
  // descomentar a linha abaixo se surgir um uso legítimo (ex.: backoffice interno
  // de sucesso do cliente), mas aí precisa de um conceito de permissão de
  // plataforma separado do RBAC por tenant, não authenticate+requirePermission comum.
  // await app.register(customersRoutes, { prefix: '/v1' });
  await app.register(materialsRoutes, { prefix: '/v1' });
  await app.register(clientsRoutes,   { prefix: '/v1' });
  await app.register(usersRoutes,     { prefix: '/v1' });
  await app.register(ordersRoutes,    { prefix: '/v1' });
  await app.register(invoicesRoutes,  { prefix: '/v1' });
  await app.register(taxRoutes,       { prefix: '/v1' });
  await app.register(nfeRoutes,                { prefix: '/v1' });
  await app.register(nfseRoutes,               { prefix: '/v1' });
  await app.register(simplesRemessaRoutes,     { prefix: '/v1' });
  await app.register(salesPipelineRoutes,      { prefix: '/v1' });
  await app.register(employeesRoutes,          { prefix: '/v1' });
  await app.register(payrollRoutes,            { prefix: '/v1' });
  await app.register(notificationConfigRoutes, { prefix: '/v1' });
  await app.register(receivablesRoutes,        { prefix: '/v1' });
  await app.register(suppliersRoutes,          { prefix: '/v1' });
  await app.register(payablesRoutes,           { prefix: '/v1' });
  await app.register(tenantRoutes,             { prefix: '/v1' });
  await app.register(billingRoutes,            { prefix: '/v1' });
  await app.register(clientContactsRoutes,     { prefix: '/v1' });
  await app.register(supplierContactsRoutes,   { prefix: '/v1' });
  await app.register(companiesRoutes,          { prefix: '/v1' });
  await app.register(fiscalCompanyConfigRoutes, { prefix: '/v1' });
  await app.register(fiscalImportsRoutes,      { prefix: '/v1' });
  await app.register(bankAccountsRoutes,       { prefix: '/v1' });
  await app.register(marketplaceIntegrationRoutes,   { prefix: '/v1' });
  await app.register(materialMarketplaceLinksRoutes, { prefix: '/v1' });
  await app.register(marketplaceWebhookRoutes,       { prefix: '/v1' });
  await app.register(whatsappRoutes,           { prefix: '/v1' });
  await app.register(whatsappWebhookRoutes,    { prefix: '/v1' });
  await app.register(serviceContractsRoutes,   { prefix: '/v1' });
  await app.register(materialImagesRoutes,     { prefix: '/v1' });
  await app.register(dashboardRoutes,          { prefix: '/v1' });
  await app.register(proposalsRoutes,          { prefix: '/v1' });
  await app.register(publicRoutes,             { prefix: '/v1' });
  await app.register(reportsRoutes,            { prefix: '/v1' });
  await app.register(costCentersRoutes,        { prefix: '/v1' });
  await app.register(sellersRoutes,            { prefix: '/v1' });
  await app.register(purchaseOrdersRoutes,     { prefix: '/v1' });
  await app.register(supplierInvoicesRoutes,   { prefix: '/v1' });
  await app.register(subscriptionRoutes,       { prefix: '/v1' });
  await app.register(subscriptionWebhookRoute, { prefix: '/v1' });
  await app.register(posRoutes,                { prefix: '/v1' });
  await app.register(tenantModulesRoutes,      { prefix: '/v1' });
  await app.register(techniciansRoutes,        { prefix: '/v1' });
  await app.register(serviceOrdersRoutes,      { prefix: '/v1' });
  await app.register(technicianPortalRoutes,   { prefix: '/v1' });
  await app.register(rbacRoutes,               { prefix: '/v1' });
  await app.register(schedulingRoutes,         { prefix: '/v1' });
  await app.register(schedulingSessionsRoutes, { prefix: '/v1' });
  await app.register(schedulingPortalRoutes,   { prefix: '/v1' });
  await app.register(calendarIntegrationRoutes, { prefix: '/v1' });

  // Ativação de conta roda antes de assinatura/papel — é o gate mais
  // fundamental (identidade confirmada), faz sentido que ganhe prioridade
  // se um tenant novo, ainda não verificado, também tiver algum outro
  // problema de acesso simultâneo.
  app.addHook('preHandler', tenantActivationGuard);
  app.addHook('preHandler', subscriptionGuard);
  app.addHook('preHandler', technicianRoleGuard);
  app.addHook('preHandler', clientRoleGuard);

  app.addHook('onReady', async () => {
    // Semeia o catálogo RBAC + papéis de sistema (idempotente). Não derruba o
    // boot em caso de falha — owner segue com acesso pleno por código.
    syncRbacCatalog().catch((err) =>
      app.log.error({ event: 'rbac_sync_failed', error: String(err) }, 'rbac_sync_failed'));
    startNfeResultsWorker();
    startBoletoResultsWorker();
    startContractBillingWorker();
    startRecurringPayablesWorker();
    startDueSoonWorker();
    startMarketplaceSyncResultsWorker();
    startWhatsAppResultsWorker();
    startWhatsAppBillingWorker();
  });
  app.addHook('onClose', async () => {
    stopNfeResultsWorker();
    stopBoletoResultsWorker();
    stopContractBillingWorker();
    stopRecurringPayablesWorker();
    stopDueSoonWorker();
    stopMarketplaceSyncResultsWorker();
    stopWhatsAppResultsWorker();
    stopWhatsAppBillingWorker();
  });

  return app;
}
