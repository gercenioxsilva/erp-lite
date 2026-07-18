// Notificações de ciclo de vida do Agendamento (0083) — o gap nº 1 da
// auditoria: até aqui só existiam e-mails de boas-vindas de login; nenhum
// evento de sessão avisava ninguém (cliente solicitava e o profissional só
// via no badge por polling). Tudo aqui é FIRE-AND-FORGET no molde do
// syncSessionEvent do Google Calendar: falha vira log, nunca quebra o fluxo.
//
// Destinatários: eventos de sessão → e-mail do CLIENTE (clients.email);
// solicitação nova → e-mail do PROFISSIONAL (users.email via
// scheduling_professionals.user_id; sem login vinculado, ninguém é avisado —
// limitação documentada). O template em si vive no consumidor externo da
// fila de notificações (mesma limitação já registrada dos alertas fiscais).

import { eq } from 'drizzle-orm';
import { db as _db } from '../db';
import { clients, schedulingProfessionals, users } from '../db/schema';
import { sendSystemNotification } from '../lib/notificationsClient';

export type DrizzleDB = typeof _db;

export type SchedulingEvent =
  | 'scheduling_session_requested'   // cliente pediu → avisa profissional
  | 'scheduling_session_approved'    // → avisa cliente
  | 'scheduling_session_declined'    // → avisa cliente (com motivo)
  | 'scheduling_session_canceled'    // → avisa cliente
  | 'scheduling_session_reminder'    // D-1 → avisa cliente
  | 'scheduling_session_client_canceled'; // cliente cancelou → avisa profissional

export interface SessionForNotify {
  tenant_id: string;
  professional_id: string;
  client_id: string;
  client_name: string | null;
  date: string;          // 'YYYY-MM-DD'
  start_time: string;    // 'HH:mm'
  end_time: string;
  decline_reason?: string | null;
}

const fmtDateBR = (iso: string) => {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
};

async function clientRecipient(clientId: string, db: DrizzleDB) {
  const [c] = await db.select({ email: clients.email, company_name: clients.company_name, full_name: clients.full_name })
    .from(clients).where(eq(clients.id, clientId));
  if (!c?.email) return null;
  return { email: c.email, name: c.company_name ?? c.full_name ?? 'Cliente' };
}

async function professionalRecipient(professionalId: string, db: DrizzleDB) {
  const [p] = await db.select({ name: schedulingProfessionals.name, user_id: schedulingProfessionals.user_id })
    .from(schedulingProfessionals).where(eq(schedulingProfessionals.id, professionalId));
  if (!p?.user_id) return null; // profissional sem login: sem destino de e-mail
  const [u] = await db.select({ email: users.email }).from(users).where(eq(users.id, p.user_id));
  if (!u?.email) return null;
  return { email: u.email, name: p.name };
}

/** Dispara o e-mail do evento — nunca lança (fire-and-forget do chamador). */
export async function notifySessionEvent(
  event: SchedulingEvent, session: SessionForNotify, db: DrizzleDB = _db,
): Promise<void> {
  try {
    const recipient = (event === 'scheduling_session_requested' || event === 'scheduling_session_client_canceled')
      ? await professionalRecipient(session.professional_id, db)
      : await clientRecipient(session.client_id, db);
    if (!recipient) return;

    await sendSystemNotification({
      tenant_id: session.tenant_id,
      type: event,
      recipient,
      data: {
        client_name: session.client_name ?? 'Cliente',
        date: fmtDateBR(session.date),
        start_time: session.start_time,
        end_time: session.end_time,
        ...(session.decline_reason ? { decline_reason: session.decline_reason } : {}),
      },
    });
  } catch (err) {
    console.error(JSON.stringify({ event: 'scheduling_notify_error', type: event, error: String(err) }));
  }
}
