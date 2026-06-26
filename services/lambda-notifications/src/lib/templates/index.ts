import type { NotificationType, TemplateData, EmailTemplate } from '../types';
import { nfeAuthorizedTemplate }  from './nfe_authorized';
import { nfeRejectedTemplate }    from './nfe_rejected';
import { nfseAuthorizedTemplate } from './nfse_authorized';
import { nfseRejectedTemplate }   from './nfse_rejected';
import { orderConfirmedTemplate } from './order_confirmed';
import { boletoGeneratedTemplate } from './boleto_generated';
import { userWelcomeTemplate }    from './user_welcome';
import { passwordResetTemplate }    from './password_reset';
import { receivableDueSoonTemplate } from './receivable_due_soon';
import { proposalSentTemplate }     from './proposal_sent';
import { proposalAcceptedTemplate } from './proposal_accepted';
import { proposalRejectedTemplate } from './proposal_rejected';

const templateMap: Record<NotificationType, (data: TemplateData) => EmailTemplate> = {
  nfe_authorized:   nfeAuthorizedTemplate,
  nfe_rejected:     nfeRejectedTemplate,
  nfse_authorized:  nfseAuthorizedTemplate,
  nfse_rejected:    nfseRejectedTemplate,
  order_confirmed:  orderConfirmedTemplate,
  boleto_generated: boletoGeneratedTemplate,
  user_welcome:     userWelcomeTemplate,
  password_reset:   passwordResetTemplate,
  receivable_due_soon: receivableDueSoonTemplate,
  proposal_sent:     proposalSentTemplate,
  proposal_accepted: proposalAcceptedTemplate,
  proposal_rejected: proposalRejectedTemplate,
};

export function getTemplate(type: NotificationType, data: TemplateData): EmailTemplate {
  const fn = templateMap[type];
  if (!fn) throw new Error(`Unknown notification type: ${type}`);
  return fn(data);
}
