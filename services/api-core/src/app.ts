import Fastify, { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import cors from '@fastify/cors';
import sensible from '@fastify/sensible';
import jwt from '@fastify/jwt';
import { customersRoutes } from './routes/customers';
import { materialsRoutes } from './routes/materials';
import { authRoutes }      from './routes/auth';
import { clientsRoutes }   from './routes/clients';
import { usersRoutes }     from './routes/users';
import { ordersRoutes }    from './routes/orders';
import { invoicesRoutes }  from './routes/invoices';
import { taxRoutes }       from './routes/tax';
import { nfeRoutes }                from './routes/nfe';
import { nfseRoutes }               from './routes/nfse';
import { notificationConfigRoutes } from './routes/notificationConfig';
import { receivablesRoutes }        from './routes/receivables';
import { suppliersRoutes }          from './routes/suppliers';
import { payablesRoutes }           from './routes/payables';
import { tenantRoutes }             from './routes/tenant';
import { billingRoutes }            from './routes/billing';
import { clientContactsRoutes }     from './routes/clientContacts';
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
import { subscriptionGuard } from './middleware/subscriptionGuard';
import { startNfeResultsWorker, stopNfeResultsWorker }             from './workers/nfeResultsWorker';
import { startBoletoResultsWorker, stopBoletoResultsWorker }       from './workers/boletoResultsWorker';
import { startContractBillingWorker, stopContractBillingWorker }   from './workers/contractBillingWorker';
import { startRecurringPayablesWorker, stopRecurringPayablesWorker } from './workers/recurringPayablesWorker';
import { startDueSoonWorker, stopDueSoonWorker }                    from './workers/dueSoonWorker';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
    },
  });

  await app.register(cors, { origin: true });
  await app.register(sensible);
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
  await app.register(customersRoutes, { prefix: '/v1' });
  await app.register(materialsRoutes, { prefix: '/v1' });
  await app.register(clientsRoutes,   { prefix: '/v1' });
  await app.register(usersRoutes,     { prefix: '/v1' });
  await app.register(ordersRoutes,    { prefix: '/v1' });
  await app.register(invoicesRoutes,  { prefix: '/v1' });
  await app.register(taxRoutes,       { prefix: '/v1' });
  await app.register(nfeRoutes,                { prefix: '/v1' });
  await app.register(nfseRoutes,               { prefix: '/v1' });
  await app.register(notificationConfigRoutes, { prefix: '/v1' });
  await app.register(receivablesRoutes,        { prefix: '/v1' });
  await app.register(suppliersRoutes,          { prefix: '/v1' });
  await app.register(payablesRoutes,           { prefix: '/v1' });
  await app.register(tenantRoutes,             { prefix: '/v1' });
  await app.register(billingRoutes,            { prefix: '/v1' });
  await app.register(clientContactsRoutes,     { prefix: '/v1' });
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

  app.addHook('preHandler', subscriptionGuard);

  app.addHook('onReady', async () => {
    startNfeResultsWorker();
    startBoletoResultsWorker();
    startContractBillingWorker();
    startRecurringPayablesWorker();
    startDueSoonWorker();
  });
  app.addHook('onClose', async () => {
    stopNfeResultsWorker();
    stopBoletoResultsWorker();
    stopContractBillingWorker();
    stopRecurringPayablesWorker();
    stopDueSoonWorker();
  });

  return app;
}
