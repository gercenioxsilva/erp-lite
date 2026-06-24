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
import { notificationConfigRoutes } from './routes/notificationConfig';
import { receivablesRoutes }        from './routes/receivables';
import { payablesRoutes }           from './routes/payables';
import { tenantRoutes }             from './routes/tenant';
import { billingRoutes }            from './routes/billing';
import { startNfeResultsWorker, stopNfeResultsWorker }       from './workers/nfeResultsWorker';
import { startBoletoResultsWorker, stopBoletoResultsWorker } from './workers/boletoResultsWorker';

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
  await app.register(notificationConfigRoutes, { prefix: '/v1' });
  await app.register(receivablesRoutes,        { prefix: '/v1' });
  await app.register(payablesRoutes,           { prefix: '/v1' });
  await app.register(tenantRoutes,             { prefix: '/v1' });
  await app.register(billingRoutes,            { prefix: '/v1' });

  app.addHook('onReady', async () => {
    startNfeResultsWorker();
    startBoletoResultsWorker();
  });
  app.addHook('onClose', async () => {
    stopNfeResultsWorker();
    stopBoletoResultsWorker();
  });

  return app;
}
