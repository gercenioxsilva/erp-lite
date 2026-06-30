import 'package:flutter/material.dart';
import 'package:orquestra_mobile/core/theme/app_colors.dart';

/// Badge de status com cor semântica + rótulo em pt-BR.
/// Cobre as state machines de orders, invoices, nfse, proposals,
/// receivables e payables (README). Status desconhecido cai no neutro.
class StatusBadge extends StatelessWidget {
  const StatusBadge(this.status, {super.key});

  final String status;

  static const Map<String, ({Color fg, Color bg, String label})> _map = {
    // Pedidos
    'draft': (fg: AppColors.textMuted, bg: AppColors.neutralBg, label: 'Rascunho'),
    'confirmed': (fg: AppColors.info, bg: AppColors.infoBg, label: 'Confirmado'),
    'delivered': (fg: AppColors.success, bg: AppColors.successBg, label: 'Entregue'),
    'invoiced': (fg: AppColors.primary, bg: AppColors.infoBg, label: 'Faturado'),
    'cancelled': (fg: AppColors.danger, bg: AppColors.dangerBg, label: 'Cancelado'),
    // Notas (NF-e / NFS-e)
    'queued': (fg: AppColors.warning, bg: AppColors.warningBg, label: 'Na fila'),
    'processing': (fg: AppColors.warning, bg: AppColors.warningBg, label: 'Processando'),
    'authorized': (fg: AppColors.success, bg: AppColors.successBg, label: 'Autorizada'),
    'issued': (fg: AppColors.success, bg: AppColors.successBg, label: 'Emitida'),
    'rejected': (fg: AppColors.danger, bg: AppColors.dangerBg, label: 'Rejeitada'),
    // Propostas
    'sent': (fg: AppColors.info, bg: AppColors.infoBg, label: 'Enviada'),
    'viewed': (fg: AppColors.info, bg: AppColors.infoBg, label: 'Visualizada'),
    'accepted': (fg: AppColors.success, bg: AppColors.successBg, label: 'Aceita'),
    'expired': (fg: AppColors.textMuted, bg: AppColors.neutralBg, label: 'Expirada'),
    // Financeiro (receivables / payables)
    'pending': (fg: AppColors.warning, bg: AppColors.warningBg, label: 'Pendente'),
    'partial': (fg: AppColors.info, bg: AppColors.infoBg, label: 'Parcial'),
    'paid': (fg: AppColors.success, bg: AppColors.successBg, label: 'Pago'),
    'overdue': (fg: AppColors.danger, bg: AppColors.dangerBg, label: 'Vencido'),
    // Genéricos
    'active': (fg: AppColors.success, bg: AppColors.successBg, label: 'Ativo'),
    'disabled': (fg: AppColors.textMuted, bg: AppColors.neutralBg, label: 'Inativo'),
  };

  @override
  Widget build(BuildContext context) {
    final cfg = _map[status.toLowerCase()] ??
        (fg: AppColors.textMuted, bg: AppColors.neutralBg, label: status);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: cfg.bg,
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        cfg.label,
        style: TextStyle(
          color: cfg.fg,
          fontSize: 12,
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }
}
