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
import { technicianWelcomeTemplate }    from './technician_welcome';
import { serviceVisitAssignedTemplate } from './service_visit_assigned';
import { tenantEmailVerificationTemplate } from './tenant_email_verification';
import { contractSentTemplate } from './contract_sent';
import { fiscalAlertTemplate } from './fiscal_alert';
import {
  schedulingSessionRequestedTemplate,
  schedulingSessionApprovedTemplate,
  schedulingSessionDeclinedTemplate,
  schedulingSessionCanceledTemplate,
  schedulingSessionReminderTemplate,
  schedulingSessionClientCanceledTemplate,
} from './scheduling_session';

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
  technician_welcome:      technicianWelcomeTemplate,
  service_visit_assigned:  serviceVisitAssignedTemplate,
  tenant_email_verification: tenantEmailVerificationTemplate,
  contract_sent: contractSentTemplate,
  fiscal_alert: fiscalAlertTemplate,
  scheduling_session_requested:       schedulingSessionRequestedTemplate,
  scheduling_session_approved:        schedulingSessionApprovedTemplate,
  scheduling_session_declined:        schedulingSessionDeclinedTemplate,
  scheduling_session_canceled:        schedulingSessionCanceledTemplate,
  scheduling_session_reminder:        schedulingSessionReminderTemplate,
  scheduling_session_client_canceled: schedulingSessionClientCanceledTemplate,
};

export function getTemplate(type: NotificationType, data: TemplateData): EmailTemplate {
  const fn = templateMap[type];
  if (!fn) throw new Error(`Unknown notification type: ${type}`);
  return fn(data);
}
