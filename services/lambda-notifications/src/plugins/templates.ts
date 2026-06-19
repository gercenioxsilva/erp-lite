import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import { getTemplate } from '../lib/templates';
import type { NotificationType, TemplateData, EmailTemplate } from '../lib/types';

declare module 'fastify' {
  interface FastifyInstance {
    getTemplate: (type: NotificationType, data: TemplateData) => EmailTemplate;
  }
}

const templatesPlugin: FastifyPluginAsync = async (app) => {
  app.decorate('getTemplate', getTemplate);
};

export default fp(templatesPlugin, { name: 'templates' });
