import type { NotificationType, TemplateData, EmailTemplate } from '../types';
import { nfeAuthorizedTemplate } from './nfe_authorized';
import { nfeRejectedTemplate }   from './nfe_rejected';
import { orderConfirmedTemplate } from './order_confirmed';

const templateMap: Record<NotificationType, (data: TemplateData) => EmailTemplate> = {
  nfe_authorized:  nfeAuthorizedTemplate,
  nfe_rejected:    nfeRejectedTemplate,
  order_confirmed: orderConfirmedTemplate,
};

export function getTemplate(type: NotificationType, data: TemplateData): EmailTemplate {
  const fn = templateMap[type];
  if (!fn) throw new Error(`Unknown notification type: ${type}`);
  return fn(data);
}
