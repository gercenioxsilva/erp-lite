import {
  pgTable, uuid, varchar, text, boolean, timestamp,
  date, decimal, char, smallint, integer, jsonb,
  numeric, pgEnum, primaryKey, unique,
} from 'drizzle-orm/pg-core';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

// ── tenants ───────────────────────────────────────────────────────────────────
export const tenants = pgTable('tenants', {
  id:           uuid('id').primaryKey().defaultRandom(),
  company_name: varchar('company_name', { length: 255 }).notNull(),
  trade_name:   varchar('trade_name',   { length: 255 }),
  tax_id:       varchar('tax_id',       { length: 50  }).notNull(),
  tax_id_type:  varchar('tax_id_type',  { length: 10  }).notNull().default('CNPJ'),
  // Address
  street:        varchar('street',        { length: 255 }),
  street_number: varchar('street_number', { length: 20  }),
  complement:    varchar('complement',    { length: 100 }),
  neighborhood:  varchar('neighborhood',  { length: 100 }),
  city:          varchar('city',          { length: 100 }),
  state:         varchar('state',         { length: 100 }),
  postal_code:   varchar('postal_code',   { length: 20  }),
  country:       char('country',          { length: 2   }).notNull().default('BR'),
  phone:         varchar('phone',         { length: 30  }),
  website:       varchar('website',       { length: 255 }),
  // Contacts
  purchasing_contact_name:  varchar('purchasing_contact_name',  { length: 255 }),
  purchasing_contact_phone: varchar('purchasing_contact_phone', { length: 30  }),
  purchasing_contact_email: varchar('purchasing_contact_email', { length: 255 }),
  maintenance_contact_name:  varchar('maintenance_contact_name',  { length: 255 }),
  maintenance_contact_phone: varchar('maintenance_contact_phone', { length: 30  }),
  maintenance_contact_email: varchar('maintenance_contact_email', { length: 255 }),
  fiscal_contact_name:  varchar('fiscal_contact_name',  { length: 255 }),
  fiscal_contact_phone: varchar('fiscal_contact_phone', { length: 30  }),
  fiscal_contact_email: varchar('fiscal_contact_email', { length: 255 }),
  // Logo (base64 data URI, max ~300 KB — returned via GET /v1/tenant only)
  logo_url: text('logo_url'),
  // Inscrição Estadual (IE) — exibida no rodapé da proposta (migration 0037)
  state_reg: varchar('state_reg', { length: 30 }),
  // Banner de topo da proposta pública (base64 data URI — migration 0037)
  proposal_banner_url: text('proposal_banner_url'),
  // Banking data (for boleto generation)
  bank_code:              varchar('bank_code',              { length: 3   }),
  agency:                 varchar('agency',                 { length: 10  }),
  account:                varchar('account',                { length: 20  }),
  account_digit:          varchar('account_digit',          { length: 2   }),
  billing_provider:       varchar('billing_provider',       { length: 30  }).notNull().default('brcode'),
  billing_days_to_expire: integer('billing_days_to_expire').notNull().default(30),
  billing_webhook_token:  text('billing_webhook_token'),
  itau_client_id:         varchar('itau_client_id',     { length: 100 }),
  itau_client_secret:     varchar('itau_client_secret', { length: 255 }),
  banking_updated_at:     timestamp('banking_updated_at', { withTimezone: true }),
  // SaaS lifecycle
  status:       varchar('status', { length: 20 }).notNull().default('trial'),
  plan:         varchar('plan',   { length: 30 }).notNull().default('starter'),
  trial_ends_at: timestamp('trial_ends_at', { withTimezone: true }),
  // Stripe billing
  stripe_customer_id:      varchar('stripe_customer_id',      { length: 100 }),
  stripe_subscription_id:  varchar('stripe_subscription_id',  { length: 100 }),
  stripe_price_id:         varchar('stripe_price_id',         { length: 100 }),
  subscription_period_end: timestamp('subscription_period_end', { withTimezone: true }),
  cancel_at_period_end:    boolean('cancel_at_period_end').notNull().default(false),
  // Simples Nacional — faturamento acumulado 12 meses (migration 0037), usado para
  // calcular a alíquota efetiva por faixa quando nfe_configs.regime_tributario = 1
  simples_rbt12: decimal('simples_rbt12', { precision: 15, scale: 2 }),
  // Ativação de conta por e-mail (migration 0061) — NULL = tenant ainda não
  // confirmou o e-mail do owner, bloqueado por tenantActivationGuard.ts.
  // Backfill obrigatório: tenants existentes antes desta migration nascem
  // com activated_at = created_at (ver 0061_tenant_activation.sql).
  activated_at: timestamp('activated_at', { withTimezone: true }),
  // Perfil de Segmento + Branding (migration 0065). segment_key = qual preset
  // (barbearia, autoescola…); labels e paleta-padrão vivem no catálogo em código
  // (apps/backoffice/src/branding/segments.ts). brand_primary/accent são hex
  // '#RRGGBB' de override manual — NULL = usar a cor do preset do segmento.
  segment_key:   varchar('segment_key',   { length: 40 }),
  brand_primary: varchar('brand_primary', { length: 9  }),
  brand_accent:  varchar('brand_accent',  { length: 9  }),
  created_at:   timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at:   timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── users ─────────────────────────────────────────────────────────────────────
export const users = pgTable('users', {
  id:            uuid('id').primaryKey().defaultRandom(),
  tenant_id:     uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  email:         varchar('email',         { length: 255 }).notNull(),
  name:          varchar('name',          { length: 255 }),
  password_hash: varchar('password_hash', { length: 255 }).notNull(),
  role:          varchar('role',   { length: 20 }).notNull().default('user'),
  status:        varchar('status', { length: 20 }).notNull().default('active'),
  password_reset_token:   varchar('password_reset_token',   { length: 255 }),
  password_reset_expires: timestamp('password_reset_expires', { withTimezone: true }),
  // Ativação de conta por e-mail (migration 0061) — colunas DEDICADAS, nunca
  // reaproveitam password_reset_token/expires (domínios de segurança
  // diferentes: trocar senha vs. confirmar identidade). email_verified_at é
  // um fato por usuário (auditoria), distinto de tenants.activated_at (o
  // portão de acesso de verdade, no agregado Tenant).
  email_verification_token:   varchar('email_verification_token',   { length: 255 }),
  email_verification_expires: timestamp('email_verification_expires', { withTimezone: true }),
  email_verified_at:          timestamp('email_verified_at', { withTimezone: true }),
  // Perfil de acesso (RBAC, migration 0059) — NULL para role='owner'/'technician',
  // que nunca usam perfil (seu acesso é 100% definido por role). Referência
  // adiantada segura: accessProfiles é definida mais abaixo neste arquivo, mas
  // o callback só é avaliado tardiamente (mesmo padrão já usado por
  // salesOpportunities → sellers/proposals).
  access_profile_id: uuid('access_profile_id').references((): AnyPgColumn => accessProfiles.id, { onDelete: 'set null' }),
  // Papel 'client' (portal de agendamento): vincula o login ao cadastro
  // comercial. Não-único de propósito — dois responsáveis podem ter login
  // para o mesmo aluno (migration 0063).
  client_id:     uuid('client_id').references((): AnyPgColumn => clients.id, { onDelete: 'set null' }),
  created_at:    timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at:    timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── clients ───────────────────────────────────────────────────────────────────
export const clients = pgTable('clients', {
  id:            uuid('id').primaryKey().defaultRandom(),
  tenant_id:     uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  person_type:   char('person_type', { length: 2 }).notNull(),
  // PJ
  company_name:  varchar('company_name',  { length: 255 }),
  trade_name:    varchar('trade_name',    { length: 255 }),
  cnpj:          varchar('cnpj',          { length: 14  }),
  state_reg:     varchar('state_reg',     { length: 30  }),
  municipal_reg: varchar('municipal_reg', { length: 30  }),
  suframa:       varchar('suframa',       { length: 20  }),
  // PF
  full_name:     varchar('full_name',     { length: 255 }),
  cpf:           varchar('cpf',           { length: 11  }),
  birth_date:    date('birth_date'),
  rg:            varchar('rg',            { length: 20  }),
  rg_issuer:     varchar('rg_issuer',     { length: 30  }),
  rg_issue_date: date('rg_issue_date'),
  // Contact
  email:  varchar('email',  { length: 255 }),
  phone:  varchar('phone',  { length: 20  }),
  mobile: varchar('mobile', { length: 20  }),
  // Address
  zip_code:      varchar('zip_code',      { length: 8   }),
  street:        varchar('street',        { length: 255 }),
  street_number: varchar('street_number', { length: 20  }),
  complement:    varchar('complement',    { length: 100 }),
  neighborhood:  varchar('neighborhood',  { length: 100 }),
  city:          varchar('city',          { length: 100 }),
  state:         char('state',            { length: 2   }),
  country:       char('country',          { length: 2   }).default('BR'),
  // NF-e
  icms_taxpayer: char('icms_taxpayer', { length: 1 }).default('9'),
  consumer_type: char('consumer_type', { length: 1 }).default('0'),
  // Misc
  is_active: boolean('is_active').notNull().default(true),
  notes:     text('notes'),
  // Consentimento WhatsApp (migration 0067) — relação 1:1 com o cliente,
  // mesmo raciocínio de tenants.activated_at ser coluna direta em vez de
  // tabela separada. MVP manda mensagem só pro telefone principal do
  // cliente (mobile, com fallback pra phone), não por client_contacts.
  whatsapp_opt_in:     boolean('whatsapp_opt_in').notNull().default(false),
  whatsapp_opt_in_at:  timestamp('whatsapp_opt_in_at',  { withTimezone: true }),
  whatsapp_opt_out_at: timestamp('whatsapp_opt_out_at', { withTimezone: true }),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── materials ─────────────────────────────────────────────────────────────────
export const materials = pgTable('materials', {
  id:        uuid('id').primaryKey().defaultRandom(),
  tenant_id: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  sku:       varchar('sku',  { length: 100 }).notNull(),
  name:      varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  type:      varchar('type',     { length: 30 }).notNull().default('product'),
  category:  varchar('category', { length: 100 }),
  brand:     varchar('brand',    { length: 100 }),
  unit:      varchar('unit',     { length: 20  }).notNull().default('UN'),
  sale_price: decimal('sale_price', { precision: 15, scale: 2 }).notNull().default('0'),
  cost_price: decimal('cost_price', { precision: 15, scale: 2 }).notNull().default('0'),
  ncm_code:  varchar('ncm_code',  { length: 10 }),
  tax_group: varchar('tax_group', { length: 50 }),
  weight_kg: decimal('weight_kg', { precision: 10, scale: 3 }),
  length_cm: decimal('length_cm', { precision: 10, scale: 2 }),
  width_cm:  decimal('width_cm',  { precision: 10, scale: 2 }),
  height_cm: decimal('height_cm', { precision: 10, scale: 2 }),
  cfop:      varchar('cfop',      { length: 4  }),
  cst_csosn: varchar('cst_csosn', { length: 4  }),
  gtin:      varchar('gtin',      { length: 14 }),
  // Reforma Tributária (migration 0049) — cClassTrib não deriva de NCM/CFOP,
  // exige override manual por produto (mesmo padrão de cfop/cst_csosn acima).
  class_trib: varchar('class_trib', { length: 6 }),
  // Observações internas (migration 0057) — distinto de `description`
  // (descrição do produto, buscável/usada em propostas); nunca aparece fora
  // do cadastro/importação de materiais.
  notes:     text('notes'),
  is_active:        boolean('is_active').notNull().default(true),
  tracks_inventory: boolean('tracks_inventory').notNull().default(true),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── material_images ───────────────────────────────────────────────────────────
export const materialImages = pgTable('material_images', {
  id:          uuid('id').primaryKey().defaultRandom(),
  tenant_id:   uuid('tenant_id').notNull().references(() => tenants.id,   { onDelete: 'cascade' }),
  material_id: uuid('material_id').notNull().references(() => materials.id, { onDelete: 'cascade' }),
  image_data:  text('image_data').notNull(),   // base64 data URI (jpeg/png/webp)
  filename:    varchar('filename', { length: 255 }),
  position:    smallint('position').notNull().default(0),
  is_cover:    boolean('is_cover').notNull().default(false),
  alt:         text('alt'),
  created_at:  timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── material_components ───────────────────────────────────────────────────────
// Composição de um kit: liga um material 'kit' às suas peças (componentes).
export const materialComponents = pgTable('material_components', {
  id:           uuid('id').primaryKey().defaultRandom(),
  tenant_id:    uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  kit_id:       uuid('kit_id').notNull().references(() => materials.id, { onDelete: 'cascade' }),
  component_id: uuid('component_id').notNull().references(() => materials.id, { onDelete: 'restrict' }),
  quantity:     decimal('quantity', { precision: 15, scale: 3 }).notNull().default('1'),
  sort_order:   integer('sort_order').notNull().default(0),
  created_at:   timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── inventory ─────────────────────────────────────────────────────────────────
export const inventory = pgTable('inventory', {
  id:          uuid('id').primaryKey().defaultRandom(),
  tenant_id:   uuid('tenant_id').notNull().references(() => tenants.id,   { onDelete: 'cascade' }),
  material_id: uuid('material_id').notNull().references(() => materials.id, { onDelete: 'cascade' }),
  quantity: decimal('quantity', { precision: 15, scale: 3 }).notNull().default('0'),
  min_qty:  decimal('min_qty',  { precision: 15, scale: 3 }).notNull().default('0'),
  max_qty:  decimal('max_qty',  { precision: 15, scale: 3 }),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── inventory_movements ───────────────────────────────────────────────────────
export const inventoryMovements = pgTable('inventory_movements', {
  id:             uuid('id').primaryKey().defaultRandom(),
  tenant_id:      uuid('tenant_id').notNull().references(() => tenants.id,   { onDelete: 'cascade' }),
  material_id:    uuid('material_id').notNull().references(() => materials.id, { onDelete: 'cascade' }),
  movement_type:  varchar('movement_type',  { length: 20 }).notNull(),
  quantity:       decimal('quantity',       { precision: 15, scale: 3 }).notNull(),
  quantity_before: decimal('quantity_before', { precision: 15, scale: 3 }).notNull(),
  quantity_after:  decimal('quantity_after',  { precision: 15, scale: 3 }).notNull(),
  reason:         text('reason'),
  reference_id:   uuid('reference_id'),
  reference_type: varchar('reference_type', { length: 50 }),
  created_by:     uuid('created_by'),
  created_at:     timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── material_price_history ───────────────────────────────────────────────────
// Append-only (migration 0050) — nunca UPDATE/DELETE após o insert. Uma linha
// por evento de mudança de preço (venda e custo juntos geram uma linha só).
export const materialPriceHistory = pgTable('material_price_history', {
  id:                uuid('id').primaryKey().defaultRandom(),
  tenant_id:         uuid('tenant_id').notNull().references(() => tenants.id,   { onDelete: 'cascade' }),
  material_id:       uuid('material_id').notNull().references(() => materials.id, { onDelete: 'cascade' }),
  sale_price_before: decimal('sale_price_before', { precision: 15, scale: 2 }),
  sale_price_after:  decimal('sale_price_after',  { precision: 15, scale: 2 }),
  cost_price_before: decimal('cost_price_before', { precision: 15, scale: 2 }),
  cost_price_after:  decimal('cost_price_after',  { precision: 15, scale: 2 }),
  source:            varchar('source', { length: 20 }).notNull(), // 'manual_edit' | 'bulk_import'
  import_batch_id:   uuid('import_batch_id'),
  created_by:        uuid('created_by'),
  created_at:        timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── orders ────────────────────────────────────────────────────────────────────
export const orders = pgTable('orders', {
  id:        uuid('id').primaryKey().defaultRandom(),
  tenant_id: uuid('tenant_id').notNull().references(() => tenants.id,  { onDelete: 'cascade' }),
  client_id: uuid('client_id').notNull().references(() => clients.id,  { onDelete: 'restrict' }),
  number:    varchar('number', { length: 20 }).notNull(),
  status:    varchar('status', { length: 20 }).notNull().default('draft'),
  subtotal:  decimal('subtotal', { precision: 15, scale: 2 }).notNull().default('0'),
  discount:  decimal('discount', { precision: 15, scale: 2 }).notNull().default('0'),
  shipping:  decimal('shipping', { precision: 15, scale: 2 }).notNull().default('0'),
  total:     decimal('total',    { precision: 15, scale: 2 }).notNull().default('0'),
  notes:     text('notes'),
  created_by: uuid('created_by'),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  // Centro de Custo (migration 0026)
  cost_center_id: uuid('cost_center_id'),
  // Vendedor (migration 0036)
  seller_id: uuid('seller_id'),
  // Mercado Livre (migration 0048, regra 42) — pedido importado de um marketplace
  marketplace_order_id: varchar('marketplace_order_id', { length: 50 }),
  origin: varchar('origin', { length: 20 }).notNull().default('erp'),
  // Empresa/CNPJ da venda (migration 0068) — receita atribuível por empresa
  // para RBT12/apuração multiempresa; NULL = tenant ainda sem empresa cadastrada.
  company_id: uuid('company_id'),
});

// ── order_items ───────────────────────────────────────────────────────────────
export const orderItems = pgTable('order_items', {
  id:          uuid('id').primaryKey().defaultRandom(),
  order_id:    uuid('order_id').notNull().references(() => orders.id,    { onDelete: 'cascade' }),
  material_id: uuid('material_id').references(() => materials.id, { onDelete: 'set null' }),
  name:       varchar('name', { length: 255 }).notNull(),
  sku:        varchar('sku',  { length: 100 }),
  unit:       varchar('unit', { length: 20  }).notNull().default('UN'),
  quantity:   decimal('quantity',   { precision: 15, scale: 3 }).notNull(),
  unit_price: decimal('unit_price', { precision: 15, scale: 2 }).notNull(),
  total:      decimal('total',      { precision: 15, scale: 2 }).notNull(),
  notes:      text('notes'),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── invoices ──────────────────────────────────────────────────────────────────
export const invoices = pgTable('invoices', {
  id:        uuid('id').primaryKey().defaultRandom(),
  tenant_id: uuid('tenant_id').notNull().references(() => tenants.id,  { onDelete: 'cascade' }),
  client_id: uuid('client_id').notNull().references(() => clients.id,  { onDelete: 'restrict' }),
  order_id:  uuid('order_id').references(() => orders.id,   { onDelete: 'set null' }),
  // Qual empresa/CNPJ emite esta nota (migration 0046, regra 40) — nullable,
  // resolvido para a empresa padrão do tenant quando omitido.
  company_id: uuid('company_id').references(() => nfeConfigs.id, { onDelete: 'set null' }),
  number:    varchar('number', { length: 20 }),
  serie:     varchar('serie',  { length: 5  }).notNull().default('1'),
  status:    varchar('status', { length: 20 }).notNull().default('draft'),
  issue_date: date('issue_date'),
  subtotal:   decimal('subtotal',   { precision: 15, scale: 2 }).notNull().default('0'),
  tax_total:  decimal('tax_total',  { precision: 15, scale: 2 }).notNull().default('0'),
  total:      decimal('total',      { precision: 15, scale: 2 }).notNull().default('0'),
  notes:     text('notes'),
  // Tax fields (migration 0008)
  tax_regime:   varchar('tax_regime',   { length: 50 }),
  origin_state: varchar('origin_state', { length: 2  }),
  icms_total:   decimal('icms_total',   { precision: 15, scale: 2 }),
  pis_total:    decimal('pis_total',    { precision: 15, scale: 2 }),
  cofins_total: decimal('cofins_total', { precision: 15, scale: 2 }),
  // Motor fiscal multi-estado (migration 0037)
  fcp_total:        decimal('fcp_total',        { precision: 15, scale: 2 }).notNull().default('0'),
  icms_difal_total: decimal('icms_difal_total', { precision: 15, scale: 2 }).notNull().default('0'),
  // Reforma Tributária — IBS/CBS (migration 0049) — informativos, nunca somados a `total`.
  ibs_total: decimal('ibs_total', { precision: 15, scale: 2 }).notNull().default('0'),
  cbs_total: decimal('cbs_total', { precision: 15, scale: 2 }).notNull().default('0'),
  // NF-e fields (migration 0009)
  nfe_status:        varchar('nfe_status',        { length: 20  }),
  nfe_chave:         varchar('nfe_chave',          { length: 50  }),
  nfe_protocol:      varchar('nfe_protocol',       { length: 50  }),
  nfe_auth_date:     timestamp('nfe_auth_date',    { withTimezone: true }),
  nfe_reject_reason: text('nfe_reject_reason'),
  nfe_attempts:      integer('nfe_attempts').notNull().default(0),
  nfe_xml_s3_key:    varchar('nfe_xml_s3_key',    { length: 500 }),
  nfe_danfe_url:     varchar('nfe_danfe_url',      { length: 500 }),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  // Centro de Custo (migration 0026)
  cost_center_id: uuid('cost_center_id'),
  // Vendedor (migration 0036)
  seller_id: uuid('seller_id'),
});

// ── invoice_items ─────────────────────────────────────────────────────────────
export const invoiceItems = pgTable('invoice_items', {
  id:          uuid('id').primaryKey().defaultRandom(),
  invoice_id:  uuid('invoice_id').notNull().references(() => invoices.id,  { onDelete: 'cascade' }),
  material_id: uuid('material_id').references(() => materials.id, { onDelete: 'set null' }),
  name:     varchar('name',     { length: 255 }).notNull(),
  ncm_code: varchar('ncm_code', { length: 10  }),
  cfop:     varchar('cfop',     { length: 5   }),
  quantity:   decimal('quantity',   { precision: 15, scale: 3 }).notNull(),
  unit_price: decimal('unit_price', { precision: 15, scale: 2 }).notNull(),
  total:      decimal('total',      { precision: 15, scale: 2 }).notNull(),
  // Tax (migration 0008)
  icms_cst:   varchar('icms_cst',   { length: 3 }),
  icms_base:  decimal('icms_base',  { precision: 15, scale: 2 }),
  icms_rate:  decimal('icms_rate',  { precision: 5,  scale: 2 }),
  icms_value: decimal('icms_value', { precision: 15, scale: 2 }),
  pis_cst:    varchar('pis_cst',    { length: 3 }),
  pis_base:   decimal('pis_base',   { precision: 15, scale: 2 }),
  pis_rate:   decimal('pis_rate',   { precision: 5,  scale: 2 }),
  pis_value:  decimal('pis_value',  { precision: 15, scale: 2 }),
  cofins_cst:   varchar('cofins_cst',   { length: 3 }),
  cofins_base:  decimal('cofins_base',  { precision: 15, scale: 2 }),
  cofins_rate:  decimal('cofins_rate',  { precision: 5,  scale: 2 }),
  cofins_value: decimal('cofins_value', { precision: 15, scale: 2 }),
  ipi_rate:  decimal('ipi_rate',  { precision: 5,  scale: 2 }),
  ipi_value: decimal('ipi_value', { precision: 15, scale: 2 }),
  // Motor fiscal multi-estado (migration 0037)
  fcp_rate:         decimal('fcp_rate',         { precision: 5,  scale: 2 }).notNull().default('0'),
  fcp_value:        decimal('fcp_value',        { precision: 15, scale: 2 }).notNull().default('0'),
  icms_difal_value: decimal('icms_difal_value', { precision: 15, scale: 2 }).notNull().default('0'),
  // Reforma Tributária — IBS/CBS (migration 0049)
  class_trib: varchar('class_trib', { length: 6 }),
  ibs_base:   decimal('ibs_base',  { precision: 15, scale: 2 }).notNull().default('0'),
  ibs_rate:   decimal('ibs_rate',  { precision: 6,  scale: 3 }).notNull().default('0'),
  ibs_value:  decimal('ibs_value', { precision: 15, scale: 2 }).notNull().default('0'),
  cbs_base:   decimal('cbs_base',  { precision: 15, scale: 2 }).notNull().default('0'),
  cbs_rate:   decimal('cbs_rate',  { precision: 6,  scale: 3 }).notNull().default('0'),
  cbs_value:  decimal('cbs_value', { precision: 15, scale: 2 }).notNull().default('0'),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── nfe_configs ───────────────────────────────────────────────────────────────
// nfe_configs é a entidade "Empresa/CNPJ" do tenant (regra 40). Até a migration
// 0046 era um singleton por tenant (tenant_id era a PRIMARY KEY); agora tenant_id
// é uma FK comum e cada linha é uma empresa — is_default marca qual delas é usada
// quando nenhum company_id é informado explicitamente (retrocompatibilidade).
export const nfeConfigs = pgTable('nfe_configs', {
  id:          uuid('id').primaryKey().defaultRandom(),
  tenant_id:   uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  is_default:  boolean('is_default').notNull().default(true),
  is_active:   boolean('is_active').notNull().default(true),
  cnpj:        varchar('cnpj', { length: 14 }).notNull(),
  razao_social: varchar('razao_social', { length: 255 }).notNull(),
  nome_fantasia: varchar('nome_fantasia', { length: 255 }),
  regime_tributario: smallint('regime_tributario').notNull().default(1),
  logradouro:  varchar('logradouro',  { length: 255 }).notNull(),
  numero:      varchar('numero',      { length: 20  }).notNull(),
  complemento: varchar('complemento', { length: 100 }),
  bairro:      varchar('bairro',      { length: 100 }).notNull(),
  municipio:   varchar('municipio',   { length: 100 }).notNull().default('SAO PAULO'),
  uf:          varchar('uf',          { length: 2   }).notNull().default('SP'),
  cep:         varchar('cep',         { length: 8   }).notNull(),
  telefone:    varchar('telefone',    { length: 30  }),
  email:       varchar('email',       { length: 255 }),
  cfop_padrao:        varchar('cfop_padrao',        { length: 4  }).notNull().default('5102'),
  cfop_interestadual: varchar('cfop_interestadual', { length: 4  }).notNull().default('6102'),
  natureza_operacao:  varchar('natureza_operacao',  { length: 100 }).notNull().default('Venda de mercadoria'),
  focus_ambiente:              smallint('focus_ambiente').notNull().default(2),
  focus_token_homologacao: varchar('focus_token_homologacao', { length: 255 }),
  focus_token_producao:    varchar('focus_token_producao',    { length: 255 }),
  // NFS-e municipal data (migration 0019)
  inscricao_municipal:   varchar('inscricao_municipal',   { length: 20 }),
  codigo_municipio_ibge: varchar('codigo_municipio_ibge', { length: 10 }).default('3550308'),
  aliquota_iss_padrao:   decimal('aliquota_iss_padrao', { precision: 5, scale: 2 }).default('5.00'),
  codigo_servico_padrao: varchar('codigo_servico_padrao', { length: 10 }),
  // Responsabilidade de emissão por empresa (migration 0056, regra 53) —
  // default true/true preserva o comportamento de hoje pra tenants com 1
  // empresa só; nunca inferido, sempre decisão explícita do usuário na tela
  // "Minha Empresa" (mesmo espírito de "nunca inferir automaticamente" da
  // regra 44 pra class_trib).
  emite_nfe:  boolean('emite_nfe').notNull().default(true),
  emite_nfse: boolean('emite_nfse').notNull().default(true),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── bank_accounts ────────────────────────────────────────────────────────────
// N contas bancárias por empresa (nfe_configs) — mesma promoção de singleton
// para N-por-escopo já feita em nfe_configs (migration 0046), um nível abaixo.
// is_default marca qual conta é usada quando nenhuma é escolhida explicitamente
// na emissão de boleto/PIX (regra 41).
export const bankAccounts = pgTable('bank_accounts', {
  id:         uuid('id').primaryKey().defaultRandom(),
  tenant_id:  uuid('tenant_id').notNull().references(() => tenants.id,    { onDelete: 'cascade' }),
  company_id: uuid('company_id').notNull().references(() => nfeConfigs.id, { onDelete: 'cascade' }),
  label:      varchar('label', { length: 100 }),
  bank_code:              varchar('bank_code',              { length: 3   }).notNull(),
  agency:                 varchar('agency',                 { length: 10  }).notNull(),
  account:                varchar('account',                { length: 20  }).notNull(),
  account_digit:          varchar('account_digit',          { length: 2   }).notNull(),
  billing_provider:       varchar('billing_provider',       { length: 30  }).notNull().default('brcode'),
  billing_days_to_expire: integer('billing_days_to_expire').notNull().default(30),
  // Deprecated-mas-presentes desde a migration 0064 (sem DROP destrutivo,
  // mesmo espírito da regra 41) — nenhuma rota escreve aqui diretamente mais.
  itau_client_id:         varchar('itau_client_id',     { length: 100 }),
  itau_client_secret:     varchar('itau_client_secret', { length: 255 }),
  // Credenciais genéricas por provedor (migration 0064) — {client_id,
  // client_secret} para Itaú/brcode, {client_id, client_secret, cert, key}
  // para C6 (mTLS). Único ponto de leitura/escrita de credencial daqui em
  // diante, para QUALQUER billing_provider — não precisa de migration nova
  // pro próximo banco (Santander/Bradesco, já cogitados no enum).
  credentials: jsonb('credentials'),
  is_default: boolean('is_default').notNull().default(true),
  is_active:  boolean('is_active').notNull().default(true),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── marketplace_connections ──────────────────────────────────────────────────
// Conexão OAuth do Mercado Livre — uma por empresa (nfe_configs), não por
// tenant: uma conta ML é vinculada a um CNPJ específico (regra 42). Segredos em
// texto puro nesta fase (Fase 1, api-core apenas) — mesmo padrão já usado em
// bank_accounts.itau_client_secret; envelope encryption via KMS fica pra Fase 2.
export const marketplaceConnections = pgTable('marketplace_connections', {
  id:         uuid('id').primaryKey().defaultRandom(),
  tenant_id:  uuid('tenant_id').notNull().references(() => tenants.id,    { onDelete: 'cascade' }),
  company_id: uuid('company_id').notNull().references(() => nfeConfigs.id, { onDelete: 'cascade' }),
  provider:   varchar('provider', { length: 30 }).notNull().default('mercadolivre'),
  ml_user_id: varchar('ml_user_id', { length: 50 }),
  nickname:   varchar('nickname',   { length: 100 }),
  access_token:  text('access_token'),
  refresh_token: text('refresh_token'),
  token_expires_at: timestamp('token_expires_at', { withTimezone: true }),
  scope:      varchar('scope', { length: 100 }),
  status:     varchar('status', { length: 20 }).notNull().default('disconnected'),
  connected_at:      timestamp('connected_at', { withTimezone: true }),
  connected_by:      uuid('connected_by').references(() => users.id, { onDelete: 'set null' }),
  disconnected_at:   timestamp('disconnected_at', { withTimezone: true }),
  last_refreshed_at: timestamp('last_refreshed_at', { withTimezone: true }),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── material_marketplace_links ───────────────────────────────────────────────
// Vínculo material↔item do Mercado Livre — N por conexão. sync_price/sync_stock
// controlam se o ERP empurra preço/estoque para aquele anúncio (Fase 2).
export const materialMarketplaceLinks = pgTable('material_marketplace_links', {
  id:            uuid('id').primaryKey().defaultRandom(),
  tenant_id:     uuid('tenant_id').notNull().references(() => tenants.id,    { onDelete: 'cascade' }),
  material_id:   uuid('material_id').notNull().references(() => materials.id, { onDelete: 'cascade' }),
  connection_id: uuid('connection_id').notNull().references(() => marketplaceConnections.id, { onDelete: 'cascade' }),
  ml_item_id:      varchar('ml_item_id',      { length: 50 }),
  ml_variation_id: varchar('ml_variation_id', { length: 50 }),
  status:     varchar('status', { length: 20 }).notNull().default('pending'),
  sync_price: boolean('sync_price').notNull().default(true),
  sync_stock: boolean('sync_stock').notNull().default(true),
  last_synced_at: timestamp('last_synced_at', { withTimezone: true }),
  last_error: text('last_error'),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── marketplace_webhook_events (append-only) ─────────────────────────────────
// O payload do webhook nunca é fonte de verdade, só um gatilho (regra 42) —
// idempotência via UNIQUE(idempotency_key), mesmo padrão de nfe_events.
export const marketplaceWebhookEvents = pgTable('marketplace_webhook_events', {
  id:             uuid('id').primaryKey().defaultRandom(),
  provider:       varchar('provider', { length: 30 }).notNull().default('mercadolivre'),
  ml_user_id:     varchar('ml_user_id', { length: 50 }),
  topic:          varchar('topic', { length: 50 }),
  resource:       varchar('resource', { length: 255 }),
  application_id: varchar('application_id', { length: 50 }),
  idempotency_key: varchar('idempotency_key', { length: 200 }).notNull(),
  status:         varchar('status', { length: 20 }).notNull().default('received'),
  error_message:  text('error_message'),
  received_at:  timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  processed_at: timestamp('processed_at', { withTimezone: true }),
});

// ── nfe_events ────────────────────────────────────────────────────────────────
export const nfeEvents = pgTable('nfe_events', {
  id:          uuid('id').primaryKey().defaultRandom(),
  invoice_id:  uuid('invoice_id').notNull().references(() => invoices.id,  { onDelete: 'cascade' }),
  tenant_id:   uuid('tenant_id').notNull(),
  event_type:  varchar('event_type',  { length: 50 }).notNull(),
  status_code: varchar('status_code', { length: 10 }),
  protocol:    varchar('protocol',    { length: 50 }),
  payload:     jsonb('payload'),
  created_at:  timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── simples_remessas (migration 0055, regra 51) ────────────────────────────────
// NF-e de Simples Remessa (conserto/demonstração/comodato/industrialização/
// amostra grátis/devolução) — documento fiscal NÃO ONEROSO, distinto de venda
// (invoices) e de NFS-e. Entidade própria (mesmo princípio já usado pra
// separar NFS-e de NF-e de venda): invoices tem client_id NOT NULL e gera
// receivable/comissão, nenhum dos quais cabe numa remessa sem venda.
export const simplesRemessas = pgTable('simples_remessas', {
  id:         uuid('id').primaryKey().defaultRandom(),
  tenant_id:  uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  // Qual empresa/CNPJ emite esta remessa (regra 40) — nullable, resolvido
  // para a empresa padrão do tenant quando omitido, mesmo padrão de invoices.
  company_id: uuid('company_id').references(() => nfeConfigs.id, { onDelete: 'set null' }),
  client_id:  uuid('client_id').notNull().references(() => clients.id, { onDelete: 'restrict' }),
  // Retorno de remessa: quando não nulo, esta linha É o retorno da remessa
  // original apontada aqui — mesma tabela, sem entidade paralela (thunk evita
  // ciclo de definição, já que a tabela referencia a si mesma).
  parent_remessa_id: uuid('parent_remessa_id').references((): AnyPgColumn => simplesRemessas.id, { onDelete: 'set null' }),
  motivo:            varchar('motivo', { length: 30 }).notNull(),
  cfop:              varchar('cfop', { length: 5 }).notNull(),
  natureza_operacao: varchar('natureza_operacao', { length: 100 }).notNull(),
  // Único eixo de status (draft/pending/processing/authorized/rejected/cancelled)
  // — diferente de invoices, aqui não há um eixo "issued" separado da
  // transmissão SEFAZ, então um único campo é suficiente (sem redundância).
  status:            varchar('status', { length: 20 }).notNull().default('draft'),
  subtotal:          decimal('subtotal', { precision: 15, scale: 2 }).notNull().default('0'),
  total:             decimal('total',    { precision: 15, scale: 2 }).notNull().default('0'),
  notes:             text('notes'),
  // Rastreio de NF-e — mesmo vocabulário de invoices.*
  nfe_chave:         varchar('nfe_chave',    { length: 50 }),
  nfe_protocol:      varchar('nfe_protocol', { length: 50 }),
  nfe_auth_date:     timestamp('nfe_auth_date', { withTimezone: true }),
  nfe_reject_reason: text('nfe_reject_reason'),
  nfe_attempts:      integer('nfe_attempts').notNull().default(0),
  nfe_xml_s3_key:    varchar('nfe_xml_s3_key', { length: 500 }),
  nfe_danfe_url:     varchar('nfe_danfe_url',  { length: 500 }),
  // Controle de baixa/devolução de estoque — idempotência (nunca baixar/devolver duas vezes)
  stock_applied_at:  timestamp('stock_applied_at', { withTimezone: true }),
  created_by:        uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  created_at:        timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at:        timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const simplesRemessaItems = pgTable('simples_remessa_items', {
  id:                  uuid('id').primaryKey().defaultRandom(),
  simples_remessa_id:  uuid('simples_remessa_id').notNull().references(() => simplesRemessas.id, { onDelete: 'cascade' }),
  material_id:         uuid('material_id').references(() => materials.id, { onDelete: 'set null' }),
  name:       varchar('name', { length: 255 }).notNull(),
  ncm_code:   varchar('ncm_code', { length: 10 }),
  cfop:       varchar('cfop', { length: 5 }),
  quantity:   decimal('quantity',   { precision: 15, scale: 3 }).notNull(),
  unit_price: decimal('unit_price', { precision: 15, scale: 2 }).notNull(),
  total:      decimal('total',      { precision: 15, scale: 2 }).notNull(),
  // Situação tributária de suspensão (regra 51) — resolvida pelo domínio de
  // remessa, independente do class_trib/CST cadastrado no material p/ venda.
  icms_cst:   varchar('icms_cst', { length: 3 }),
  class_trib: varchar('class_trib', { length: 6 }),
  ibs_rate:   decimal('ibs_rate',  { precision: 6,  scale: 3 }).notNull().default('0'),
  ibs_value:  decimal('ibs_value', { precision: 15, scale: 2 }).notNull().default('0'),
  cbs_rate:   decimal('cbs_rate',  { precision: 6,  scale: 3 }).notNull().default('0'),
  cbs_value:  decimal('cbs_value', { precision: 15, scale: 2 }).notNull().default('0'),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// Append-only (mesmo padrão de nfeEvents/nfseEvents) — nunca UPDATE/DELETE.
export const simplesRemessaEvents = pgTable('simples_remessa_events', {
  id:                  uuid('id').primaryKey().defaultRandom(),
  simples_remessa_id:  uuid('simples_remessa_id').notNull().references(() => simplesRemessas.id, { onDelete: 'cascade' }),
  tenant_id:   uuid('tenant_id').notNull(),
  event_type:  varchar('event_type',  { length: 50 }).notNull(),
  status_code: varchar('status_code', { length: 10 }),
  protocol:    varchar('protocol',    { length: 50 }),
  payload:     jsonb('payload'),
  created_at:  timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── receivables ───────────────────────────────────────────────────────────────
// Defined before boletos to break the circular reference:
//   receivables.boleto_id  →  boletos.id   (constraint exists in migration 0014,
//                                           omitted here so TypeScript can infer types)
//   boletos.receivable_id  →  receivables.id  (normal FK, boletos is declared after)
export const receivables = pgTable('receivables', {
  id:          uuid('id').primaryKey().defaultRandom(),
  tenant_id:   uuid('tenant_id').notNull().references(() => tenants.id,  { onDelete: 'cascade' }),
  client_id:   uuid('client_id').references(() => clients.id,            { onDelete: 'set null' }),
  invoice_id:  uuid('invoice_id').references(() => invoices.id,          { onDelete: 'set null' }),
  boleto_id:   uuid('boleto_id'),  // FK → boletos.id (constraint in migration, no .references() to avoid circular)
  description: varchar('description', { length: 255 }).notNull(),
  amount:      decimal('amount',      { precision: 15, scale: 2 }).notNull(),
  paid_amount: decimal('paid_amount', { precision: 15, scale: 2 }).notNull().default('0'),
  due_date:    date('due_date').notNull(),
  status:      varchar('status', { length: 20 }).notNull().default('pending'),
  notes:       text('notes'),
  due_notification_sent: boolean('due_notification_sent').notNull().default(false),
  created_by:  uuid('created_by'),
  created_at:  timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at:  timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  // Centro de Custo (migration 0026)
  cost_center_id: uuid('cost_center_id'),
  // Origem PDV (migration 0031) — FK → pos_sales.id (constraint na migration; thunk evita ciclo de definição)
  pos_sale_id: uuid('pos_sale_id'),
  // Faturamento de Ordem de Serviço (migration 0052) — FK → service_orders.id
  // (constraint na migration, sem .references() aqui pra evitar ciclo de
  // definição, já que service_orders é declarada mais adiante neste arquivo).
  // UNIQUE parcial (na migration) garante no máximo 1 receivable por OS.
  service_order_id: uuid('service_order_id'),
});

// ── boletos ───────────────────────────────────────────────────────────────────
export const boletos = pgTable('boletos', {
  id:           uuid('id').primaryKey().defaultRandom(),
  tenant_id:    uuid('tenant_id').notNull().references(() => tenants.id,       { onDelete: 'cascade' }),
  receivable_id: uuid('receivable_id').notNull().references(() => receivables.id, { onDelete: 'cascade' }),
  // Qual conta bancária emitiu este boleto (regra 41) — nullable, rastreabilidade
  // extra; banco_code/agencia/conta/digito abaixo continuam sendo o snapshot real.
  bank_account_id: uuid('bank_account_id').references(() => bankAccounts.id, { onDelete: 'set null' }),

  boleto_id:    varchar('boleto_id',    { length: 100 }),
  brcode:       text('brcode'),
  pix_qr_code:  text('pix_qr_code'),
  nosso_numero: varchar('nosso_numero', { length: 50  }),

  banco_code:   varchar('banco_code',   { length: 3   }),
  agencia:      varchar('agencia',      { length: 10  }),
  conta:        varchar('conta',        { length: 20  }),
  digito:       varchar('digito',       { length: 2   }),

  status:       varchar('status',       { length: 20  }).notNull().default('pending'),
  issued_at:    timestamp('issued_at',  { withTimezone: true }),
  expires_at:   date('expires_at'),
  paid_at:      timestamp('paid_at',    { withTimezone: true }),

  boleto_url:   text('boleto_url'),
  pdf_s3_key:   text('pdf_s3_key'),
  error_reason: text('error_reason'),

  created_at:   timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at:   timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── boleto_events (append-only) ───────────────────────────────────────────────
export const boletoEvents = pgTable('boleto_events', {
  id:          uuid('id').primaryKey().defaultRandom(),
  boleto_id:   uuid('boleto_id').notNull().references(() => boletos.id, { onDelete: 'cascade' }),
  tenant_id:   uuid('tenant_id').notNull().references(() => tenants.id),
  event_type:  varchar('event_type',  { length: 30 }).notNull(),
  status_code: varchar('status_code', { length: 50 }),
  response:    jsonb('response'),
  created_at:  timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── receivable_payments (append-only) ─────────────────────────────────────────
export const receivablePayments = pgTable('receivable_payments', {
  id:             uuid('id').primaryKey().defaultRandom(),
  tenant_id:      uuid('tenant_id').notNull().references(() => tenants.id,      { onDelete: 'cascade' }),
  receivable_id:  uuid('receivable_id').notNull().references(() => receivables.id, { onDelete: 'cascade' }),
  payment_date:   date('payment_date').notNull(),
  amount:         decimal('amount', { precision: 15, scale: 2 }).notNull(),
  payment_method: varchar('payment_method', { length: 30 }).notNull().default('other'),
  reference:      varchar('reference', { length: 100 }),
  notes:          text('notes'),
  created_by:     uuid('created_by'),
  created_at:     timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── suppliers ─────────────────────────────────────────────────────────────────
export const suppliers = pgTable('suppliers', {
  id:            uuid('id').defaultRandom().primaryKey(),
  tenant_id:     uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  person_type:   varchar('person_type', { length: 2 }).notNull().default('PJ'),
  company_name:  varchar('company_name', { length: 255 }),
  trade_name:    varchar('trade_name', { length: 255 }),
  cnpj:          varchar('cnpj', { length: 14 }),
  full_name:     varchar('full_name', { length: 255 }),
  cpf:           varchar('cpf', { length: 11 }),
  email:         varchar('email', { length: 255 }),
  phone:         varchar('phone', { length: 30 }),
  zip_code:      varchar('zip_code', { length: 8 }),
  street:        varchar('street', { length: 255 }),
  street_number: varchar('street_number', { length: 20 }),
  complement:    varchar('complement', { length: 100 }),
  neighborhood:  varchar('neighborhood', { length: 100 }),
  city:          varchar('city', { length: 100 }),
  state:         char('state', { length: 2 }),
  bank_code:     varchar('bank_code', { length: 10 }),
  agency:        varchar('agency', { length: 20 }),
  account:       varchar('account', { length: 20 }),
  account_digit: varchar('account_digit', { length: 5 }),
  pix_key:       varchar('pix_key', { length: 255 }),
  category:      varchar('category', { length: 50 }).notNull().default('services'),
  notes:         text('notes'),
  is_active:     boolean('is_active').notNull().default(true),
  created_at:    timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at:    timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── supplier_contacts ────────────────────────────────────────────────────────
// Mesmo conceito de client_contacts, com contact_type adaptado ao lado do
// fornecedor (comercial/financeiro/suporte/logistica/outro — não reaproveita
// "comprador"/"compras" de client_contacts, que descreve quem compra DE nós).
export const supplierContacts = pgTable('supplier_contacts', {
  id:           uuid('id').primaryKey().defaultRandom(),
  tenant_id:    uuid('tenant_id').notNull().references(() => tenants.id,  { onDelete: 'cascade' }),
  supplier_id:  uuid('supplier_id').notNull().references(() => suppliers.id, { onDelete: 'cascade' }),
  contact_type: varchar('contact_type', { length: 30 }).notNull().default('comercial'),
  name:         varchar('name',  { length: 255 }),
  email:        varchar('email', { length: 255 }),
  phone:        varchar('phone', { length: 20  }),
  notes:        text('notes'),
  is_active:    boolean('is_active').notNull().default(true),
  created_at:   timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at:   timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── payables ──────────────────────────────────────────────────────────────────
export const payables = pgTable('payables', {
  id:              uuid('id').primaryKey().defaultRandom(),
  tenant_id:       uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  supplier_id:     uuid('supplier_id').references(() => suppliers.id, { onDelete: 'set null' }),
  supplier_name:   varchar('supplier_name',   { length: 255 }),
  category:        varchar('category',        { length: 50  }).notNull().default('other'),
  description:     varchar('description',     { length: 255 }).notNull(),
  document_number: varchar('document_number', { length: 50  }),
  amount:          decimal('amount',      { precision: 15, scale: 2 }).notNull(),
  paid_amount:     decimal('paid_amount', { precision: 15, scale: 2 }).notNull().default('0'),
  due_date:        date('due_date').notNull(),
  status:          varchar('status', { length: 20 }).notNull().default('pending'),
  notes:           text('notes'),
  recurrence:                varchar('recurrence', { length: 20 }).notNull().default('none'),
  recurrence_day:            smallint('recurrence_day'),
  recurrence_end_date:       date('recurrence_end_date'),
  recurrence_last_generated: date('recurrence_last_generated'),
  parent_payable_id:         uuid('parent_payable_id').references((): AnyPgColumn => payables.id, { onDelete: 'set null' }),
  created_by:      uuid('created_by'),
  created_at:      timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at:      timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  // Centro de Custo (migration 0026)
  cost_center_id: uuid('cost_center_id'),
  // DRE Gerencial (migration 0042)
  dre_category_id: uuid('dre_category_id'),
  // Parcelamento de NF-e de Entrada (migration 0051) — installment_group_id
  // não é FK, só correlaciona as N parcelas de uma mesma nota (mesmo padrão
  // de material_price_history.import_batch_id). Distinto de
  // parent_payable_id, que já é usado para recorrência.
  installment_number:   smallint('installment_number'),
  installment_total:    smallint('installment_total'),
  installment_group_id: uuid('installment_group_id'),
});

// ── payable_payments (append-only) ────────────────────────────────────────────
export const payablePayments = pgTable('payable_payments', {
  id:             uuid('id').primaryKey().defaultRandom(),
  tenant_id:      uuid('tenant_id').notNull().references(() => tenants.id,    { onDelete: 'cascade' }),
  payable_id:     uuid('payable_id').notNull().references(() => payables.id,  { onDelete: 'cascade' }),
  payment_date:   date('payment_date').notNull(),
  amount:         decimal('amount', { precision: 15, scale: 2 }).notNull(),
  payment_method: varchar('payment_method', { length: 30 }).notNull().default('other'),
  reference:      varchar('reference', { length: 100 }),
  notes:          text('notes'),
  created_by:     uuid('created_by'),
  created_at:     timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── client_contacts ───────────────────────────────────────────────────────────
export const clientContacts = pgTable('client_contacts', {
  id:           uuid('id').primaryKey().defaultRandom(),
  tenant_id:    uuid('tenant_id').notNull().references(() => tenants.id,  { onDelete: 'cascade' }),
  client_id:    uuid('client_id').notNull().references(() => clients.id,  { onDelete: 'cascade' }),
  contact_type: varchar('contact_type', { length: 30 }).notNull().default('comercial'),
  name:         varchar('name',  { length: 255 }),
  email:        varchar('email', { length: 255 }),
  phone:        varchar('phone', { length: 20  }),
  notes:        text('notes'),
  is_active:    boolean('is_active').notNull().default(true),
  created_at:   timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at:   timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── service_contracts ─────────────────────────────────────────────────────────
export const serviceContracts = pgTable('service_contracts', {
  id:                uuid('id').primaryKey().defaultRandom(),
  tenant_id:         uuid('tenant_id').notNull().references(() => tenants.id,  { onDelete: 'cascade' }),
  client_id:         uuid('client_id').notNull().references(() => clients.id,  { onDelete: 'restrict' }),
  material_id:       uuid('material_id').references(() => materials.id, { onDelete: 'set null' }),
  // Qual empresa/CNPJ fatura este contrato (migration 0046, regra 40) — nullable,
  // resolvido para a empresa padrão do tenant quando omitido.
  company_id:        uuid('company_id').references(() => nfeConfigs.id, { onDelete: 'set null' }),
  contract_number:   varchar('contract_number', { length: 20 }).notNull(),
  description:       text('description').notNull(),
  start_date:        date('start_date').notNull(),
  end_date:          date('end_date'),
  billing_frequency: varchar('billing_frequency', { length: 20 }).notNull().default('monthly'),
  billing_day:       smallint('billing_day').notNull().default(1),
  amount:            decimal('amount', { precision: 15, scale: 2 }).notNull(),
  status:            varchar('status', { length: 20 }).notNull().default('active'),
  notes:             text('notes'),
  // NFS-e opt-in (migration 0019)
  nfse_enabled:      boolean('nfse_enabled').notNull().default(false),
  codigo_servico:    varchar('codigo_servico', { length: 10 }),
  aliquota_iss:      decimal('aliquota_iss', { precision: 5, scale: 2 }),
  created_by:        uuid('created_by'),
  created_at:        timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at:        timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── contract_billings ─────────────────────────────────────────────────────────
export const contractBillings = pgTable('contract_billings', {
  id:            uuid('id').primaryKey().defaultRandom(),
  tenant_id:     uuid('tenant_id').notNull().references(() => tenants.id,          { onDelete: 'cascade' }),
  contract_id:   uuid('contract_id').notNull().references(() => serviceContracts.id, { onDelete: 'cascade' }),
  receivable_id: uuid('receivable_id').references(() => receivables.id,            { onDelete: 'set null' }),
  period_start:  date('period_start').notNull(),
  period_end:    date('period_end').notNull(),
  amount:        decimal('amount', { precision: 15, scale: 2 }).notNull(),
  due_date:      date('due_date').notNull(),
  status:        varchar('status', { length: 20 }).notNull().default('pending'),
  notes:         text('notes'),
  // NFS-e link (migration 0019) — FK to nfseInvoices, declared after this table
  nfse_id:       uuid('nfse_id'),
  created_at:    timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at:    timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── notification_configs ──────────────────────────────────────────────────────
export const notificationConfigs = pgTable('notification_configs', {
  tenant_id:              uuid('tenant_id').primaryKey().references(() => tenants.id, { onDelete: 'cascade' }),
  email_enabled:          boolean('email_enabled').notNull().default(true),
  email_from_name:        varchar('email_from_name', { length: 100 }).notNull().default('GAX ERP'),
  email_reply_to:         varchar('email_reply_to',  { length: 255 }),
  notify_nfe_authorized:  boolean('notify_nfe_authorized').notNull().default(true),
  notify_nfe_rejected:    boolean('notify_nfe_rejected').notNull().default(true),
  notify_order_confirmed: boolean('notify_order_confirmed').notNull().default(false),
  notify_boleto_generated: boolean('notify_boleto_generated').notNull().default(true),
  notify_nfse_authorized: boolean('notify_nfse_authorized').notNull().default(true),
  notify_nfse_rejected:   boolean('notify_nfse_rejected').notNull().default(true),
  notify_receivable_due_days: smallint('notify_receivable_due_days').notNull().default(3),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── nfse_invoices ─────────────────────────────────────────────────────────────
export const nfseInvoices = pgTable('nfse_invoices', {
  id:                  uuid('id').primaryKey().defaultRandom(),
  tenant_id:           uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  contract_billing_id: uuid('contract_billing_id').references(() => contractBillings.id, { onDelete: 'set null' }),
  receivable_id:       uuid('receivable_id').references(() => receivables.id, { onDelete: 'set null' }),
  client_id:           uuid('client_id').references(() => clients.id, { onDelete: 'set null' }),
  // Qual empresa/CNPJ emite esta NFS-e (migration 0046, regra 40) — nullable,
  // resolvido para a empresa padrão do tenant quando omitido.
  company_id:          uuid('company_id').references(() => nfeConfigs.id, { onDelete: 'set null' }),
  description:         text('description').notNull(),
  amount:              decimal('amount', { precision: 15, scale: 2 }).notNull(),
  iss_rate:            decimal('iss_rate', { precision: 5, scale: 2 }).notNull(),
  iss_value:           decimal('iss_value', { precision: 15, scale: 2 }).notNull(),
  service_code:        varchar('service_code', { length: 10 }).notNull(),
  period_start:        date('period_start'),
  period_end:          date('period_end'),
  nfse_status:         varchar('nfse_status', { length: 30 }),
  nfse_number:         varchar('nfse_number', { length: 50 }),
  nfse_chave:          varchar('nfse_chave', { length: 255 }),
  nfse_verify_code:    varchar('nfse_verify_code', { length: 100 }),
  nfse_protocol:       varchar('nfse_protocol', { length: 50 }),
  nfse_auth_date:      timestamp('nfse_auth_date', { withTimezone: true }),
  nfse_reject_reason:  text('nfse_reject_reason'),
  nfse_attempts:       smallint('nfse_attempts').notNull().default(0),
  nfse_pdf_url:        text('nfse_pdf_url'),
  nfse_xml_s3_key:     text('nfse_xml_s3_key'),
  created_at:          timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at:          timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  // Motor multi-provider (migration 0074): ciclo completo com adapters próprios.
  provider:            varchar('provider', { length: 16 }),
  municipio_ibge:      varchar('municipio_ibge', { length: 10 }),
  ambiente:            smallint('ambiente').notNull().default(2),
  rps_numero:          integer('rps_numero'),
  rps_serie:           varchar('rps_serie', { length: 5 }),
  lote_protocolo:      varchar('lote_protocolo', { length: 60 }),
  nfse_pdf_s3_key:     text('nfse_pdf_s3_key'),
  cancel_reason:       text('cancel_reason'),
  cancel_date:         timestamp('cancel_date', { withTimezone: true }),
  substitute_of_id:    uuid('substitute_of_id'),
  iss_retido:          boolean('iss_retido').notNull().default(false),
  deducoes:            decimal('deducoes', { precision: 15, scale: 2 }),
  idempotency_key:     varchar('idempotency_key', { length: 160 }),
});

// Registry GLOBAL município → provider/versão/endpoints/perfil de assinatura
// (migration 0074, regra 33 — sem tenant_id). Adicionar prefeitura = 1 linha.
export const nfseMunicipalities = pgTable('nfse_municipalities', {
  codigo_ibge:       varchar('codigo_ibge', { length: 10 }).primaryKey(),
  uf:                char('uf', { length: 2 }).notNull(),
  nome:              varchar('nome', { length: 120 }).notNull(),
  provider:          varchar('provider', { length: 16 }).notNull(),
  abrasf_versao:     varchar('abrasf_versao', { length: 8 }),
  perfil:            varchar('perfil', { length: 20 }),
  endpoint_homolog:  text('endpoint_homolog'),
  endpoint_producao: text('endpoint_producao'),
  signature_algo:    varchar('signature_algo', { length: 12 }).notNull().default('rsa-sha1'),
  c14n:              varchar('c14n', { length: 10 }).notNull().default('inclusive'),
  lote_assincrono:   boolean('lote_assincrono').notNull().default(true),
  ativo:             boolean('ativo').notNull().default(true),
  notes:             text('notes'),
});

// ── nfse_events ───────────────────────────────────────────────────────────────
export const nfseEvents = pgTable('nfse_events', {
  id:          uuid('id').primaryKey().defaultRandom(),
  nfse_id:     uuid('nfse_id').notNull().references(() => nfseInvoices.id, { onDelete: 'cascade' }),
  tenant_id:   uuid('tenant_id').notNull(),
  event_type:  varchar('event_type', { length: 30 }).notNull(),
  status_code: varchar('status_code', { length: 20 }),
  protocol:    varchar('protocol', { length: 50 }),
  payload:     jsonb('payload'),
  created_at:  timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ──────────────────────────────────────────────────────────────────────────────
// proposals + proposal_items  (migration 0024)
// ──────────────────────────────────────────────────────────────────────────────
export const proposals = pgTable('proposals', {
  id:                   uuid('id').notNull().defaultRandom().primaryKey(),
  tenant_id:            uuid('tenant_id').notNull().references(() => tenants.id,  { onDelete: 'cascade' }),
  client_id:            uuid('client_id').references(() => clients.id,              { onDelete: 'set null' }),
  number:               varchar('number',  { length: 20  }).notNull(),
  title:                varchar('title',   { length: 500 }).notNull(),
  status:               varchar('status',  { length: 20  }).notNull().default('draft'),
  subtotal:             decimal('subtotal', { precision: 15, scale: 2 }).notNull().default('0'),
  discount:             decimal('discount', { precision: 15, scale: 2 }).notNull().default('0'),
  shipping:             decimal('shipping', { precision: 15, scale: 2 }).notNull().default('0'),
  total:                decimal('total',    { precision: 15, scale: 2 }).notNull().default('0'),
  valid_until:          date('valid_until'),
  notes:                text('notes'),
  terms_text:           text('terms_text'),
  delivery_time:        varchar('delivery_time',  { length: 120 }),
  payment_method:       varchar('payment_method', { length: 40  }),
  public_token:         varchar('public_token',       { length: 64 }),
  public_viewed_at:     timestamp('public_viewed_at', { withTimezone: true }),
  accepted_at:          timestamp('accepted_at',      { withTimezone: true }),
  accepted_by_name:     varchar('accepted_by_name',   { length: 255 }),
  accepted_by_email:    varchar('accepted_by_email',  { length: 255 }),
  accepted_notes:       text('accepted_notes'),
  rejected_at:          timestamp('rejected_at',      { withTimezone: true }),
  rejected_reason:      text('rejected_reason'),
  converted_to_order_id: uuid('converted_to_order_id').references(() => orders.id, { onDelete: 'set null' }),
  seller_email:         varchar('seller_email', { length: 255 }),
  created_by:           uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  created_at:           timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at:           timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const proposalItems = pgTable('proposal_items', {
  id:           uuid('id').notNull().defaultRandom().primaryKey(),
  proposal_id:  uuid('proposal_id').notNull().references(() => proposals.id, { onDelete: 'cascade' }),
  material_id:  uuid('material_id').references(() => materials.id, { onDelete: 'set null' }),
  name:         varchar('name', { length: 255 }).notNull(),
  sku:          varchar('sku',  { length: 100 }),
  unit:         varchar('unit', { length: 20 }).notNull().default('UN'),
  quantity:     decimal('quantity',    { precision: 15, scale: 3 }).notNull(),
  unit_price:   decimal('unit_price',  { precision: 15, scale: 2 }).notNull(),
  discount_pct: decimal('discount_pct',{ precision: 5,  scale: 2 }).notNull().default('0'),
  total:        decimal('total',       { precision: 15, scale: 2 }).notNull(),
  notes:        text('notes'),
  sort_order:   smallint('sort_order').notNull().default(0),
  created_at:   timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ──────────────────────────────────────────────────────────────────────────────
// Funil de Vendas / CRM (migration 0058) — módulo opcional, desligado por
// padrão. Etapas configuráveis por tenant; status (aberto/ganho/perdido) é um
// eixo separado da etapa — Ganho/Perdido nunca são linhas de
// sales_pipeline_stages, são colunas fixas no Kanban do frontend.
// ──────────────────────────────────────────────────────────────────────────────

export const salesPipelineStages = pgTable('sales_pipeline_stages', {
  id:         uuid('id').primaryKey().defaultRandom(),
  tenant_id:  uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  name:       varchar('name', { length: 80 }).notNull(),
  sort_order: integer('sort_order').notNull().default(0),
  is_active:  boolean('is_active').notNull().default(true),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const salesOpportunities = pgTable('sales_opportunities', {
  id:                  uuid('id').primaryKey().defaultRandom(),
  tenant_id:           uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  stage_id:            uuid('stage_id').notNull().references(() => salesPipelineStages.id, { onDelete: 'restrict' }),
  client_id:           uuid('client_id').references(() => clients.id, { onDelete: 'set null' }),
  seller_id:           uuid('seller_id').references(() => sellers.id, { onDelete: 'set null' }),
  proposal_id:         uuid('proposal_id').references(() => proposals.id, { onDelete: 'set null' }),
  title:               varchar('title', { length: 255 }).notNull(),
  contact_name:        varchar('contact_name',  { length: 255 }),
  contact_email:       varchar('contact_email', { length: 255 }),
  contact_phone:       varchar('contact_phone', { length: 30 }),
  value:               decimal('value', { precision: 15, scale: 2 }).notNull().default('0'),
  source:              varchar('source', { length: 60 }),
  status:              varchar('status', { length: 20 }).notNull().default('open'),
  lost_reason:         text('lost_reason'),
  expected_close_date: date('expected_close_date'),
  notes:               text('notes'),
  won_at:              timestamp('won_at',  { withTimezone: true }),
  lost_at:             timestamp('lost_at', { withTimezone: true }),
  created_by:          uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  created_at:          timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at:          timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// Timeline append-only — nunca UPDATE/DELETE, mesmo padrão de nfe_events.
// stage_change/won/lost são logados automaticamente pelo service, nunca
// manualmente pela rota.
export const salesOpportunityActivities = pgTable('sales_opportunity_activities', {
  id:             uuid('id').primaryKey().defaultRandom(),
  tenant_id:      uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  opportunity_id: uuid('opportunity_id').notNull().references(() => salesOpportunities.id, { onDelete: 'cascade' }),
  type:           varchar('type', { length: 20 }).notNull(),
  description:    text('description'),
  created_by:     uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  created_at:     timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ──────────────────────────────────────────────────────────────────────────────
// Centro de Custo  (migrations 0027 + 0028)
// ──────────────────────────────────────────────────────────────────────────────

export const costCenters = pgTable('cost_centers', {
  id:             uuid('id').primaryKey().defaultRandom(),
  tenant_id:      uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  code:           varchar('code',        { length: 20  }).notNull(),
  name:           varchar('name',        { length: 255 }).notNull(),
  description:    text('description'),
  allow_negative: boolean('allow_negative').notNull().default(false),
  is_active:      boolean('is_active').notNull().default(true),
  created_at:     timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at:     timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ENUMs for cost_center_movements
export const ccMovementDirectionEnum = pgEnum('cc_movement_direction', ['in', 'out']);
export const ccMovementSourceEnum    = pgEnum('cc_movement_source',    ['manual_entry', 'adjustment', 'payable', 'order', 'invoice', 'pos_sale']);

export const costCenterStock = pgTable('cost_center_stock', {
  tenant_id:      uuid('tenant_id').notNull().references(() => tenants.id,      { onDelete: 'cascade' }),
  cost_center_id: uuid('cost_center_id').notNull().references(() => costCenters.id, { onDelete: 'cascade' }),
  material_id:    uuid('material_id').notNull().references(() => materials.id),
  quantity:       numeric('quantity',      { precision: 14, scale: 4 }).notNull().default('0'),
  avg_unit_cost:  numeric('avg_unit_cost', { precision: 14, scale: 2 }).notNull().default('0'),
  updated_at:     timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  pk: primaryKey({ columns: [t.cost_center_id, t.material_id] }),
}));

export const costCenterMovements = pgTable('cost_center_movements', {
  id:              uuid('id').primaryKey().defaultRandom(),
  tenant_id:       uuid('tenant_id').notNull().references(() => tenants.id,          { onDelete: 'cascade' }),
  cost_center_id:  uuid('cost_center_id').notNull().references(() => costCenters.id, { onDelete: 'cascade' }),
  material_id:     uuid('material_id').notNull().references(() => materials.id),
  direction:       ccMovementDirectionEnum('direction').notNull(),
  quantity:        numeric('quantity',      { precision: 14, scale: 4 }).notNull(),
  unit_cost:       numeric('unit_cost',     { precision: 14, scale: 2 }),
  total_cost:      numeric('total_cost',    { precision: 14, scale: 2 }),
  balance_after:   numeric('balance_after', { precision: 14, scale: 4 }).notNull(),
  source:          ccMovementSourceEnum('source').notNull(),
  source_id:       uuid('source_id'),
  note:            text('note'),
  idempotency_key: varchar('idempotency_key', { length: 160 }).notNull(),
  created_by:      uuid('created_by'),
  created_at:      timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uq: unique().on(t.tenant_id, t.idempotency_key),
}));

// ── plans ─────────────────────────────────────────────────────────────────────
export const plans = pgTable('plans', {
  id:                varchar('id',              { length: 50  }).primaryKey(),
  name:              varchar('name',            { length: 100 }).notNull(),
  stripe_price_id:   varchar('stripe_price_id', { length: 100 }).notNull().default('price_placeholder'),
  price_monthly:     numeric('price_monthly',   { precision: 10, scale: 2 }).notNull(),
  max_users:         smallint('max_users'),
  max_nfe_per_month: integer('max_nfe_per_month'),
  max_clients:       integer('max_clients'),
  features:          jsonb('features').notNull().default('{}'),
  display_order:     smallint('display_order').notNull().default(0),
  is_active:         boolean('is_active').notNull().default(true),
});

// ── billing_events ────────────────────────────────────────────────────────────
export const billingEvents = pgTable('billing_events', {
  id:              uuid('id').primaryKey().defaultRandom(),
  tenant_id:       uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  stripe_event_id: varchar('stripe_event_id', { length: 100 }).notNull().unique(),
  event_type:      varchar('event_type',      { length: 100 }).notNull(),
  payload:         jsonb('payload').notNull(),
  processed_at:    timestamp('processed_at', { withTimezone: true }).notNull().defaultNow(),
});

// ──────────────────────────────────────────────────────────────────────────────
// PDV / POS  (migration 0029)
// ──────────────────────────────────────────────────────────────────────────────

export const posSessionStatusEnum  = pgEnum('pos_session_status',  ['open', 'closed']);
export const posSaleStatusEnum     = pgEnum('pos_sale_status',     ['open', 'finalized', 'cancelled']);
export const posPaymentMethodEnum  = pgEnum('pos_payment_method',  ['cash', 'debit', 'credit', 'pix', 'voucher', 'store_credit']);
export const posCashMoveTypeEnum   = pgEnum('pos_cash_move_type',  ['opening', 'suprimento', 'sangria', 'sale_cash', 'closing']);

// ── pos_terminals ─────────────────────────────────────────────────────────────
export const posTerminals = pgTable('pos_terminals', {
  id:             uuid('id').primaryKey().defaultRandom(),
  tenant_id:      uuid('tenant_id').notNull().references(() => tenants.id,       { onDelete: 'cascade' }),
  code:           varchar('code', { length: 20  }).notNull(),
  name:           varchar('name', { length: 255 }).notNull(),
  cost_center_id: uuid('cost_center_id').references(() => costCenters.id,        { onDelete: 'set null' }),
  nfce_series:    integer('nfce_series').notNull().default(1),
  is_active:      boolean('is_active').notNull().default(true),
  created_at:     timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at:     timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── pos_sessions ──────────────────────────────────────────────────────────────
export const posSessions = pgTable('pos_sessions', {
  id:               uuid('id').primaryKey().defaultRandom(),
  tenant_id:        uuid('tenant_id').notNull().references(() => tenants.id,    { onDelete: 'cascade' }),
  terminal_id:      uuid('terminal_id').notNull().references(() => posTerminals.id),
  operator_id:      uuid('operator_id').notNull().references(() => users.id),
  status:           posSessionStatusEnum('status').notNull().default('open'),
  opened_at:        timestamp('opened_at',  { withTimezone: true }).notNull().defaultNow(),
  opening_amount:   numeric('opening_amount',   { precision: 14, scale: 2 }).notNull().default('0'),
  closed_at:        timestamp('closed_at',  { withTimezone: true }),
  closing_counted:  numeric('closing_counted',  { precision: 14, scale: 2 }),
  closing_expected: numeric('closing_expected', { precision: 14, scale: 2 }),
  difference:       numeric('difference',       { precision: 14, scale: 2 }),
  created_at:       timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── pos_cash_movements ────────────────────────────────────────────────────────
export const posCashMovements = pgTable('pos_cash_movements', {
  id:         uuid('id').primaryKey().defaultRandom(),
  tenant_id:  uuid('tenant_id').notNull().references(() => tenants.id,       { onDelete: 'cascade' }),
  session_id: uuid('session_id').notNull().references(() => posSessions.id,  { onDelete: 'cascade' }),
  type:       posCashMoveTypeEnum('type').notNull(),
  amount:     numeric('amount', { precision: 14, scale: 2 }).notNull(),
  reason:     text('reason'),
  sale_id:    uuid('sale_id').references(() => posSales.id, { onDelete: 'set null' }),
  created_by: uuid('created_by').references(() => users.id),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── pos_sales ─────────────────────────────────────────────────────────────────
export const posSales = pgTable('pos_sales', {
  id:              uuid('id').primaryKey().defaultRandom(),
  tenant_id:       uuid('tenant_id').notNull().references(() => tenants.id,       { onDelete: 'cascade' }),
  session_id:      uuid('session_id').notNull().references(() => posSessions.id),
  terminal_id:     uuid('terminal_id').notNull().references(() => posTerminals.id),
  operator_id:     uuid('operator_id').notNull().references(() => users.id),
  cost_center_id:  uuid('cost_center_id').references(() => costCenters.id,        { onDelete: 'set null' }),
  customer_doc:    varchar('customer_doc',  { length: 14  }),
  customer_name:   varchar('customer_name', { length: 255 }),
  status:          posSaleStatusEnum('status').notNull().default('open'),
  subtotal:        numeric('subtotal',        { precision: 14, scale: 2 }).notNull().default('0'),
  discount_amount: numeric('discount_amount', { precision: 14, scale: 2 }).notNull().default('0'),
  total:           numeric('total',           { precision: 14, scale: 2 }).notNull().default('0'),
  focus_ref:        varchar('focus_ref',       { length: 60  }),
  fiscal_status:    varchar('fiscal_status',    { length: 30  }).notNull().default('none'),
  fiscal_chave:     varchar('fiscal_chave',     { length: 44  }),
  fiscal_protocol:  varchar('fiscal_protocol',  { length: 40  }),
  fiscal_number:    integer('fiscal_number'),
  fiscal_series:    integer('fiscal_series'),
  fiscal_qrcode:    text('fiscal_qrcode'),
  fiscal_url_danfe: text('fiscal_url_danfe'),
  fiscal_url_xml:   text('fiscal_url_xml'),
  fiscal_message:   text('fiscal_message'),
  idempotency_key: varchar('idempotency_key', { length: 160 }),
  finalized_at:    timestamp('finalized_at',  { withTimezone: true }),
  cancelled_at:    timestamp('cancelled_at',  { withTimezone: true }),
  cancel_reason:   text('cancel_reason'),
  created_at:      timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at:      timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  // Empresa/CNPJ da venda (migration 0068) — receita de PDV atribuível por
  // empresa para RBT12/apuração multiempresa.
  company_id:      uuid('company_id'),
});

// ── pos_sale_items ────────────────────────────────────────────────────────────
export const posSaleItems = pgTable('pos_sale_items', {
  id:              uuid('id').primaryKey().defaultRandom(),
  sale_id:         uuid('sale_id').notNull().references(() => posSales.id,     { onDelete: 'cascade' }),
  product_id:      uuid('product_id').notNull().references(() => materials.id),
  description:     varchar('description', { length: 255 }).notNull(),
  quantity:        numeric('quantity',        { precision: 14, scale: 4 }).notNull(),
  unit_price:      numeric('unit_price',      { precision: 14, scale: 2 }).notNull(),
  discount_amount: numeric('discount_amount', { precision: 14, scale: 2 }).notNull().default('0'),
  total:           numeric('total',           { precision: 14, scale: 2 }).notNull(),
  ncm:             varchar('ncm',       { length: 8 }),
  cfop:            varchar('cfop',      { length: 4 }),
  cst_csosn:       varchar('cst_csosn', { length: 4 }),
  unit:            varchar('unit',      { length: 6 }),
  // Reforma Tributária — cClassTrib (migration 0049), NFC-e (regra 44). Só a
  // classificação é persistida (copiada de materials no addItem, mesmo padrão
  // de cst_csosn/cfop/ncm acima) — alíquota/valor de IBS/CBS são resolvidos na
  // emissão, nunca persistidos (mesmo comportamento do ICMS da NFC-e hoje).
  class_trib: varchar('class_trib', { length: 6 }),
  created_at:      timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── pos_sale_payments ─────────────────────────────────────────────────────────
export const posSalePayments = pgTable('pos_sale_payments', {
  id:                 uuid('id').primaryKey().defaultRandom(),
  sale_id:            uuid('sale_id').notNull().references(() => posSales.id, { onDelete: 'cascade' }),
  method:             posPaymentMethodEnum('method').notNull(),
  amount:             numeric('amount',       { precision: 14, scale: 2 }).notNull(),
  installments:       integer('installments').notNull().default(1),
  authorization_code: varchar('authorization_code', { length: 60 }),
  change_amount:      numeric('change_amount', { precision: 14, scale: 2 }).notNull().default('0'),
  created_at:         timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ──────────────────────────────────────────────────────────────────────────────
// sellers + commission_entries  (migration 0036)
// ──────────────────────────────────────────────────────────────────────────────

// ── sellers ───────────────────────────────────────────────────────────────────
export const sellers = pgTable('sellers', {
  id:                     uuid('id').primaryKey().defaultRandom(),
  tenant_id:              uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  user_id:                uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  name:                   varchar('name',  { length: 255 }).notNull(),
  email:                  varchar('email', { length: 255 }),
  phone:                  varchar('phone', { length: 20  }),
  document:               varchar('document', { length: 20 }),
  // 'subtotal' (padrão — pós-desconto, pré-imposto) | 'total'
  default_commission_pct: decimal('default_commission_pct', { precision: 5,  scale: 2 }).notNull().default('0'),
  commission_base:        varchar('commission_base', { length: 20 }).notNull().default('subtotal'),
  is_active:              boolean('is_active').notNull().default(true),
  created_at:             timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at:             timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── commission_entries (ledger — uma linha por NF-e autorizada com vendedor) ───
export const commissionEntries = pgTable('commission_entries', {
  id:                uuid('id').primaryKey().defaultRandom(),
  tenant_id:         uuid('tenant_id').notNull().references(() => tenants.id,  { onDelete: 'cascade' }),
  seller_id:         uuid('seller_id').notNull().references(() => sellers.id,  { onDelete: 'cascade' }),
  invoice_id:        uuid('invoice_id').notNull().references(() => invoices.id, { onDelete: 'cascade' }),
  order_id:          uuid('order_id').references(() => orders.id, { onDelete: 'set null' }),
  base_amount:       decimal('base_amount',       { precision: 15, scale: 2 }).notNull(),
  rate:              decimal('rate',              { precision: 5,  scale: 2 }).notNull(),
  commission_amount: decimal('commission_amount', { precision: 15, scale: 2 }).notNull(),
  // 'accrued' | 'cancelled'
  status:            varchar('status', { length: 20 }).notNull().default('accrued'),
  idempotency_key:   varchar('idempotency_key', { length: 160 }).notNull(),
  cancelled_at:      timestamp('cancelled_at', { withTimezone: true }),
  created_at:        timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ──────────────────────────────────────────────────────────────────────────────
// Motor fiscal multi-estado (migration 0037)
// Tabelas centrais, mantidas pela Orquestra — nunca editáveis por tenant.
// ──────────────────────────────────────────────────────────────────────────────

// ── tax_icms_interstate_rates ───────────────────────────────────────────────────
// Regra legal fixa (Resolução do Senado 22/89) — não é dado "estimado".
export const taxIcmsInterstateRates = pgTable('tax_icms_interstate_rates', {
  origin_uf: char('origin_uf', { length: 2 }).notNull(),
  dest_uf:   char('dest_uf',   { length: 2 }).notNull(),
  rate:      decimal('rate', { precision: 5, scale: 2 }).notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.origin_uf, t.dest_uf] }),
}));

// ── tax_icms_internal_rates ─────────────────────────────────────────────────────
// Alíquota de referência por UF — revisar com a contabilidade do tenant antes de
// uso em produção (ver coluna notes e regra 33 do README).
export const taxIcmsInternalRates = pgTable('tax_icms_internal_rates', {
  uf:    char('uf', { length: 2 }).primaryKey(),
  rate:  decimal('rate', { precision: 5, scale: 2 }).notNull(),
  notes: text('notes').notNull(),
});

// ── tax_fcp_rates ────────────────────────────────────────────────────────────────
// Fundo de Combate à Pobreza — estrutura pronta, sem dados pré-populados.
export const taxFcpRates = pgTable('tax_fcp_rates', {
  uf:   char('uf', { length: 2 }).primaryKey(),
  rate: decimal('rate', { precision: 5, scale: 2 }).notNull(),
});

// ── tax_st_rules ─────────────────────────────────────────────────────────────────
// ICMS-ST (Substituição Tributária) — estrutura pronta, sem dados pré-populados.
export const taxStRules = pgTable('tax_st_rules', {
  id:          uuid('id').primaryKey().defaultRandom(),
  ncm:         varchar('ncm', { length: 10 }).notNull(),
  origin_uf:   char('origin_uf', { length: 2 }).notNull(),
  dest_uf:     char('dest_uf',   { length: 2 }).notNull(),
  mva_percent: decimal('mva_percent', { precision: 6, scale: 2 }).notNull(),
}, (t) => ({
  uniq: unique().on(t.ncm, t.origin_uf, t.dest_uf),
}));

// ── tax_simples_nacional_brackets ─────────────────────────────────────────────────
// Anexos I–V, LC 123/2006 pós-reforma 2018. Versionada por ano de vigência
// (migration 0070) — parametrização anual sem mudança de código.
export const taxSimplesNacionalBrackets = pgTable('tax_simples_nacional_brackets', {
  vigencia_ano:     smallint('vigencia_ano').notNull().default(2018),
  anexo:            varchar('anexo', { length: 3 }).notNull().default('I'),
  faixa:            smallint('faixa').notNull(),
  rbt12_min:        decimal('rbt12_min', { precision: 15, scale: 2 }).notNull(),
  rbt12_max:        decimal('rbt12_max', { precision: 15, scale: 2 }).notNull(),
  aliquota_nominal: decimal('aliquota_nominal', { precision: 5, scale: 2 }).notNull(),
  parcela_deduzir:  decimal('parcela_deduzir',  { precision: 15, scale: 2 }).notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.vigencia_ano, t.anexo, t.faixa] }),
}));

// ──────────────────────────────────────────────────────────────────────────────
// P2 — Pedidos de Compra  (migration 0040)
// ──────────────────────────────────────────────────────────────────────────────

export const purchaseOrders = pgTable('purchase_orders', {
  id:            uuid('id').primaryKey().defaultRandom(),
  tenant_id:     uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  supplier_id:   uuid('supplier_id').references(() => suppliers.id, { onDelete: 'restrict' }),
  supplier_name: varchar('supplier_name', { length: 255 }),
  number:        varchar('number', { length: 20 }).notNull(),
  status:        varchar('status', { length: 20 }).notNull().default('draft'),
  expected_date: date('expected_date'),
  subtotal:      decimal('subtotal', { precision: 15, scale: 2 }).notNull().default('0'),
  discount:      decimal('discount', { precision: 15, scale: 2 }).notNull().default('0'),
  shipping:      decimal('shipping', { precision: 15, scale: 2 }).notNull().default('0'),
  total:         decimal('total',    { precision: 15, scale: 2 }).notNull().default('0'),
  notes:         text('notes'),
  cost_center_id: uuid('cost_center_id'),
  created_by:    uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  approved_by:   uuid('approved_by').references(() => users.id, { onDelete: 'set null' }),
  approved_at:   timestamp('approved_at', { withTimezone: true }),
  created_at:    timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at:    timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const purchaseOrderItems = pgTable('purchase_order_items', {
  id:                uuid('id').primaryKey().defaultRandom(),
  purchase_order_id: uuid('purchase_order_id').notNull().references(() => purchaseOrders.id, { onDelete: 'cascade' }),
  material_id:       uuid('material_id').references(() => materials.id, { onDelete: 'set null' }),
  name:              varchar('name', { length: 255 }).notNull(),
  sku:               varchar('sku',  { length: 100 }),
  unit:              varchar('unit', { length: 20 }).notNull().default('UN'),
  quantity:          decimal('quantity',   { precision: 15, scale: 3 }).notNull(),
  unit_price:        decimal('unit_price', { precision: 15, scale: 2 }).notNull(),
  total:             decimal('total',      { precision: 15, scale: 2 }).notNull(),
  notes:             text('notes'),
  created_at:        timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ──────────────────────────────────────────────────────────────────────────────
// P1 — NF-e de Entrada  (migration 0041)
// ──────────────────────────────────────────────────────────────────────────────

export const supplierInvoices = pgTable('supplier_invoices', {
  id:                 uuid('id').primaryKey().defaultRandom(),
  tenant_id:          uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  supplier_id:        uuid('supplier_id').references(() => suppliers.id, { onDelete: 'set null' }),
  supplier_name:      varchar('supplier_name', { length: 255 }),
  purchase_order_id:  uuid('purchase_order_id').references(() => purchaseOrders.id, { onDelete: 'set null' }),
  nfe_key:            varchar('nfe_key',    { length: 44 }),
  nfe_number:         varchar('nfe_number', { length: 20 }),
  nfe_series:         varchar('nfe_series', { length: 5 }).default('1'),
  issue_date:         date('issue_date'),
  subtotal:           decimal('subtotal',  { precision: 15, scale: 2 }).notNull().default('0'),
  tax_total:          decimal('tax_total', { precision: 15, scale: 2 }).notNull().default('0'),
  total:              decimal('total',     { precision: 15, scale: 2 }).notNull().default('0'),
  due_date:           date('due_date'),
  payable_id:         uuid('payable_id'),
  status:             varchar('status', { length: 20 }).notNull().default('draft'),
  notes:              text('notes'),
  cost_center_id:     uuid('cost_center_id'),
  created_by:         uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  confirmed_by:       uuid('confirmed_by').references(() => users.id, { onDelete: 'set null' }),
  confirmed_at:       timestamp('confirmed_at', { withTimezone: true }),
  created_at:         timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at:         timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  // Parcelamento (migration 0051) — installment_group_id não é FK, só
  // correlaciona com os N payables gerados na confirmação.
  installments:         smallint('installments').notNull().default(1),
  installment_group_id: uuid('installment_group_id'),
});

export const supplierInvoiceItems = pgTable('supplier_invoice_items', {
  id:                  uuid('id').primaryKey().defaultRandom(),
  supplier_invoice_id: uuid('supplier_invoice_id').notNull().references(() => supplierInvoices.id, { onDelete: 'cascade' }),
  material_id:         uuid('material_id').references(() => materials.id, { onDelete: 'set null' }),
  name:                varchar('name',     { length: 255 }).notNull(),
  ncm_code:            varchar('ncm_code', { length: 10 }),
  cfop:                varchar('cfop',     { length: 5  }),
  unit:                varchar('unit',     { length: 20 }).notNull().default('UN'),
  quantity:            decimal('quantity',   { precision: 15, scale: 3 }).notNull(),
  unit_price:          decimal('unit_price', { precision: 15, scale: 2 }).notNull(),
  total:               decimal('total',      { precision: 15, scale: 2 }).notNull(),
  icms_rate:           decimal('icms_rate',  { precision: 5,  scale: 2 }),
  icms_value:          decimal('icms_value', { precision: 15, scale: 2 }),
  ipi_rate:            decimal('ipi_rate',   { precision: 5,  scale: 2 }),
  ipi_value:           decimal('ipi_value',  { precision: 15, scale: 2 }),
  created_at:          timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ──────────────────────────────────────────────────────────────────────────────
// P3 — DRE Gerencial  (migration 0042)
// ──────────────────────────────────────────────────────────────────────────────

export const dreCategories = pgTable('dre_categories', {
  id:         uuid('id').primaryKey().defaultRandom(),
  tenant_id:  uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  code:       varchar('code', { length: 30 }).notNull(),
  name:       varchar('name', { length: 120 }).notNull(),
  type:       varchar('type', { length: 30 }).notNull(),
  sign:       smallint('sign').notNull().default(-1),
  sort_order: smallint('sort_order').notNull().default(0),
  is_active:  boolean('is_active').notNull().default(true),
});

// ──────────────────────────────────────────────────────────────────────────────
// Ordens de Serviço / Visita Técnica  (migration 0044) — módulo opcional por tenant
// ──────────────────────────────────────────────────────────────────────────────

// Flag genérica de módulo opcional habilitado por tenant — reaproveitável por
// qualquer módulo de nicho futuro, não é específica de OS.
export const tenantModules = pgTable('tenant_modules', {
  id:          uuid('id').primaryKey().defaultRandom(),
  tenant_id:   uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  module_key:  varchar('module_key', { length: 40 }).notNull(),
  enabled:     boolean('enabled').notNull().default(false),
  enabled_at:  timestamp('enabled_at', { withTimezone: true }),
  enabled_by:  uuid('enabled_by').references(() => users.id, { onDelete: 'set null' }),
  created_at:  timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at:  timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// Perfil do técnico — 1:1 obrigatório com users (login é o próprio requisito
// de segurança, diferente de sellers onde user_id é opcional).
export const technicians = pgTable('technicians', {
  id:         uuid('id').primaryKey().defaultRandom(),
  tenant_id:  uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  user_id:    uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name:       varchar('name',  { length: 255 }).notNull(),
  email:      varchar('email', { length: 255 }).notNull(),
  phone:      varchar('phone', { length: 20 }),
  cpf:        varchar('cpf',   { length: 11 }).notNull(),
  specialty:  varchar('specialty', { length: 120 }),
  is_active:  boolean('is_active').notNull().default(true),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const serviceOrders = pgTable('service_orders', {
  id:             uuid('id').primaryKey().defaultRandom(),
  tenant_id:      uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  client_id:      uuid('client_id').references(() => clients.id, { onDelete: 'set null' }),
  cost_center_id: uuid('cost_center_id').references(() => costCenters.id, { onDelete: 'set null' }),
  number:         varchar('number', { length: 20 }).notNull(),
  title:          varchar('title',  { length: 255 }).notNull(),
  description:    text('description'),
  type:           varchar('type',   { length: 20 }).notNull().default('maintenance'),
  status:         varchar('status', { length: 20 }).notNull().default('draft'),
  subtotal:       decimal('subtotal', { precision: 15, scale: 2 }).notNull().default('0'),
  total:          decimal('total',    { precision: 15, scale: 2 }).notNull().default('0'),
  created_by:     uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  created_at:     timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at:     timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const serviceOrderItems = pgTable('service_order_items', {
  id:                uuid('id').primaryKey().defaultRandom(),
  service_order_id:  uuid('service_order_id').notNull().references(() => serviceOrders.id, { onDelete: 'cascade' }),
  material_id:       uuid('material_id').references(() => materials.id, { onDelete: 'set null' }),
  description:       varchar('description', { length: 255 }).notNull(),
  quantity:          decimal('quantity',   { precision: 15, scale: 3 }).notNull(),
  unit_price:        decimal('unit_price', { precision: 15, scale: 2 }).notNull().default('0'),
  total:             decimal('total',      { precision: 15, scale: 2 }).notNull().default('0'),
  created_at:        timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// Visita técnica — 1:N com a OS. routing_token é só roteamento (qual visita
// mostrar após login), NUNCA autorização — a autorização real é o JWT do
// técnico + technician_id da visita batendo com o technicianId do token.
// technician_name/technician_cpf são snapshot no check-in (mesmo raciocínio
// de order_items/invoice_items congelarem nome/preço).
export const serviceVisits = pgTable('service_visits', {
  id:                uuid('id').primaryKey().defaultRandom(),
  tenant_id:         uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  service_order_id:  uuid('service_order_id').notNull().references(() => serviceOrders.id, { onDelete: 'cascade' }),
  technician_id:     uuid('technician_id').notNull().references(() => technicians.id, { onDelete: 'restrict' }),
  scheduled_at:      timestamp('scheduled_at', { withTimezone: true }).notNull(),
  status:            varchar('status', { length: 20 }).notNull().default('scheduled'),
  routing_token:     varchar('routing_token', { length: 64 }).notNull(),
  token_expires_at:  timestamp('token_expires_at', { withTimezone: true }).notNull(),
  checked_in_at:     timestamp('checked_in_at',  { withTimezone: true }),
  checked_out_at:    timestamp('checked_out_at', { withTimezone: true }),
  technician_name:   varchar('technician_name', { length: 255 }),
  technician_cpf:    varchar('technician_cpf',  { length: 11 }),
  report_notes:      text('report_notes'),
  signature_s3_key:  text('signature_s3_key'),
  signed_by_name:    varchar('signed_by_name', { length: 255 }),
  signed_at:         timestamp('signed_at', { withTimezone: true }),
  created_at:        timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at:        timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// Fotos da visita — append-only. idempotency_key é gerada no navegador (UUID)
// antes do upload — mesma chave vira o sufixo da key no S3 e o valor UNIQUE
// aqui, evitando duplicidade em caso de retry (mesmo padrão de
// cost_center_movements/commission_entries).
export const serviceVisitPhotos = pgTable('service_visit_photos', {
  id:               uuid('id').primaryKey().defaultRandom(),
  tenant_id:        uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  service_visit_id: uuid('service_visit_id').notNull().references(() => serviceVisits.id, { onDelete: 'cascade' }),
  s3_key:           text('s3_key').notNull(),
  content_type:     varchar('content_type', { length: 60 }).notNull(),
  file_size_bytes:  integer('file_size_bytes').notNull(),
  caption:          varchar('caption', { length: 255 }),
  idempotency_key:  varchar('idempotency_key', { length: 80 }).notNull(),
  created_at:       timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ──────────────────────────────────────────────────────────────────────────────
// Controle de Perfil de Acesso por Tenant (RBAC) — migration 0059
// ──────────────────────────────────────────────────────────────────────────────
// role continua existindo, mas com semântica reduzida a 2 papéis de sistema
// não-configuráveis (owner/technician) — todo o resto vira access_profile_id.
// PERMISSION_RESOURCES/actions ficam em código (accessControlDomain.ts), não
// numa tabela de catálogo — mesmo racional de MODULE_KEYS.

export const accessProfiles = pgTable('access_profiles', {
  id:          uuid('id').primaryKey().defaultRandom(),
  tenant_id:   uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  name:        varchar('name', { length: 80 }).notNull(),
  description: varchar('description', { length: 255 }),
  is_system:   boolean('is_system').notNull().default(false),
  created_at:  timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at:  timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const accessProfilePermissions = pgTable('access_profile_permissions', {
  id:                uuid('id').primaryKey().defaultRandom(),
  tenant_id:         uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  access_profile_id: uuid('access_profile_id').notNull().references(() => accessProfiles.id, { onDelete: 'cascade' }),
  resource:          varchar('resource', { length: 40 }).notNull(),
  action:            varchar('action', { length: 10 }).notNull(),
  created_at:        timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const accessProfileEvents = pgTable('access_profile_events', {
  id:                uuid('id').primaryKey().defaultRandom(),
  tenant_id:         uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  access_profile_id: uuid('access_profile_id').references(() => accessProfiles.id, { onDelete: 'set null' }),
  type:              varchar('type', { length: 30 }).notNull(),
  changed_by:        uuid('changed_by').references(() => users.id, { onDelete: 'set null' }),
  payload:           jsonb('payload'),
  created_at:        timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ──────────────────────────────────────────────────────────────────────────────
// RH Simplificado (migration 0060) — módulo opcional. Ferramenta de cálculo/
// organização interna (cadastro + folha calculada) — nunca envia nada ao
// eSocial, ver regra correspondente no README.
// ──────────────────────────────────────────────────────────────────────────────

export const employees = pgTable('employees', {
  id:                uuid('id').primaryKey().defaultRandom(),
  tenant_id:         uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  company_id:        uuid('company_id').references(() => nfeConfigs.id, { onDelete: 'set null' }),
  user_id:           uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  name:              varchar('name', { length: 255 }).notNull(),
  cpf:               varchar('cpf', { length: 11 }).notNull(),
  email:             varchar('email', { length: 255 }),
  phone:             varchar('phone', { length: 30 }),
  role_title:        varchar('role_title', { length: 120 }),
  regime:            varchar('regime', { length: 20 }).notNull().default('clt'),
  base_salary:       decimal('base_salary', { precision: 15, scale: 2 }).notNull().default('0'),
  cost_center_id:    uuid('cost_center_id').references(() => costCenters.id, { onDelete: 'set null' }),
  hire_date:         date('hire_date').notNull(),
  termination_date:  date('termination_date'),
  is_active:         boolean('is_active').notNull().default(true),
  created_at:        timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at:        timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const payrollRuns = pgTable('payroll_runs', {
  id:                     uuid('id').primaryKey().defaultRandom(),
  tenant_id:              uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  company_id:             uuid('company_id').references(() => nfeConfigs.id, { onDelete: 'set null' }),
  reference_month:        date('reference_month').notNull(),
  status:                 varchar('status', { length: 20 }).notNull().default('draft'),
  gross_total:            decimal('gross_total', { precision: 15, scale: 2 }).notNull().default('0'),
  deductions_total:       decimal('deductions_total', { precision: 15, scale: 2 }).notNull().default('0'),
  net_total:              decimal('net_total', { precision: 15, scale: 2 }).notNull().default('0'),
  employer_charges_total: decimal('employer_charges_total', { precision: 15, scale: 2 }).notNull().default('0'),
  closed_at:              timestamp('closed_at', { withTimezone: true }),
  closed_by:              uuid('closed_by').references(() => users.id, { onDelete: 'set null' }),
  created_at:             timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at:             timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const payrollEntries = pgTable('payroll_entries', {
  id:                       uuid('id').primaryKey().defaultRandom(),
  tenant_id:                uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  payroll_run_id:           uuid('payroll_run_id').notNull().references(() => payrollRuns.id, { onDelete: 'cascade' }),
  employee_id:              uuid('employee_id').notNull().references(() => employees.id, { onDelete: 'restrict' }),
  employee_name:            varchar('employee_name', { length: 255 }).notNull(),
  regime:                   varchar('regime', { length: 20 }).notNull(),
  base_salary:              decimal('base_salary', { precision: 15, scale: 2 }).notNull(),
  extra_earnings:           jsonb('extra_earnings').notNull().default([]),
  extra_deductions:         jsonb('extra_deductions').notNull().default([]),
  inss_value:               decimal('inss_value', { precision: 15, scale: 2 }).notNull().default('0'),
  irrf_value:               decimal('irrf_value', { precision: 15, scale: 2 }).notNull().default('0'),
  fgts_value:               decimal('fgts_value', { precision: 15, scale: 2 }).notNull().default('0'),
  ferias_provisao:          decimal('ferias_provisao', { precision: 15, scale: 2 }).notNull().default('0'),
  decimo_terceiro_provisao: decimal('decimo_terceiro_provisao', { precision: 15, scale: 2 }).notNull().default('0'),
  gross_total:              decimal('gross_total', { precision: 15, scale: 2 }).notNull().default('0'),
  deductions_total:         decimal('deductions_total', { precision: 15, scale: 2 }).notNull().default('0'),
  net_total:                decimal('net_total', { precision: 15, scale: 2 }).notNull().default('0'),
  payable_id:               uuid('payable_id').references(() => payables.id, { onDelete: 'set null' }),
  created_at:               timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at:               timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// Global (tenant_id ausente de propósito) — INSS/IRRF são faixas federais,
// iguais pra todo tenant. Mesmo racional de tax_simples_nacional_brackets no
// motor fiscal (regra 15) — precisa de atualização manual quando a lei muda.
export const payrollTaxBrackets = pgTable('payroll_tax_brackets', {
  id:              uuid('id').primaryKey().defaultRandom(),
  type:            varchar('type', { length: 10 }).notNull(),
  min_value:       decimal('min_value', { precision: 15, scale: 2 }).notNull(),
  max_value:       decimal('max_value', { precision: 15, scale: 2 }),
  rate:            decimal('rate', { precision: 6, scale: 4 }).notNull(),
  deduction_value: decimal('deduction_value', { precision: 15, scale: 2 }).notNull().default('0'),
  valid_from:      date('valid_from').notNull(),
});

// ──────────────────────────────────────────────────────────────────────────────
// RBAC por papéis — catálogo module:action + papéis de sistema/custom
// (migration 0062; catálogo é code-authoritative em rbac/permissions.ts e
// semeado no boot por syncRbacCatalog). Convive com as tabelas de
// access_profiles acima (migration 0059), que ficaram SUPERSEDED por este
// modelo — mantidas apenas porque a migration já foi aplicada em ambientes.
// ──────────────────────────────────────────────────────────────────────────────

// ── RBAC: catálogo de permissões + papéis (system + custom por tenant) ──────
// permissions é global (semeado do catálogo em código). roles.tenant_id NULL =
// papel de sistema (owner/admin/...); não-NULL = papel custom do tenant.
// Índices únicos parciais (system: key; custom: tenant_id+key) ficam na migração
// 0055 — Drizzle 0.36 não expressa UNIQUE parcial, e as migrações são a
// autoridade do DDL aqui.
export const permissions = pgTable('permissions', {
  key:         varchar('key',    { length: 60 }).primaryKey(),
  module:      varchar('module', { length: 40 }).notNull(),
  action:      varchar('action', { length: 30 }).notNull(),
  description: varchar('description', { length: 200 }),
});

export const roles = pgTable('roles', {
  id:          uuid('id').primaryKey().defaultRandom(),
  tenant_id:   uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  key:         varchar('key',  { length: 40 }).notNull(),
  name:        varchar('name', { length: 80 }).notNull(),
  description: varchar('description', { length: 200 }),
  is_system:   boolean('is_system').notNull().default(false),
  created_at:  timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at:  timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const rolePermissions = pgTable('role_permissions', {
  role_id:        uuid('role_id').notNull().references(() => roles.id, { onDelete: 'cascade' }),
  permission_key: varchar('permission_key', { length: 60 }).notNull().references(() => permissions.key, { onDelete: 'cascade' }),
}, (t) => ({
  pk: primaryKey({ columns: [t.role_id, t.permission_key] }),
}));


// ════════════════════════════════════════════════════════════════════════════
// Agendamento de Sessões com Pacotes — migration 0060
// (design: docs/superpowers/specs/2026-07-09-scheduling-module-design.md)
// Horários são wall-clock do tenant em varchar(5) 'HH:mm' zero-padded —
// comparação lexicográfica ≡ cronológica; intervalos meio-abertos [início, fim).
// ════════════════════════════════════════════════════════════════════════════

// ── scheduling_settings (1 linha por tenant, seed-on-read) ────────────────────
export const schedulingSettings = pgTable('scheduling_settings', {
  id:                  uuid('id').primaryKey().defaultRandom(),
  tenant_id:           uuid('tenant_id').notNull().unique().references(() => tenants.id, { onDelete: 'cascade' }),
  business_name:       varchar('business_name', { length: 255 }),
  business_type:       varchar('business_type', { length: 120 }),
  allow_self_booking:  boolean('allow_self_booking').notNull().default(false),
  min_advance_hours:   integer('min_advance_hours').notNull().default(12),
  cancel_window_hours: integer('cancel_window_hours').notNull().default(0),
  timezone:            varchar('timezone', { length: 64 }).notNull().default('America/Sao_Paulo'),
  onboarding_complete: boolean('onboarding_complete').notNull().default(false),
  created_at:          timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at:          timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── scheduling_professionals (staff agendável; login opcional) ────────────────
export const schedulingProfessionals = pgTable('scheduling_professionals', {
  id:         uuid('id').primaryKey().defaultRandom(),
  tenant_id:  uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  user_id:    uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  name:       varchar('name',  { length: 255 }).notNull(),
  email:      varchar('email', { length: 255 }),
  phone:      varchar('phone', { length: 20 }),
  bio:        text('bio'),
  is_active:  boolean('is_active').notNull().default(true),
  created_by: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── scheduling_areas (recurso paralelo dentro de um profissional) ─────────────
export const schedulingAreas = pgTable('scheduling_areas', {
  id:                       uuid('id').primaryKey().defaultRandom(),
  tenant_id:                uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  name:                     varchar('name', { length: 120 }).notNull(),
  description:              text('description'),
  default_duration_minutes: integer('default_duration_minutes').notNull(),
  default_price:            decimal('default_price', { precision: 15, scale: 2 }).notNull().default('0'),
  rules_text:               text('rules_text'),
  is_active:                boolean('is_active').notNull().default(true),
  created_by:               uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  created_at:               timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at:               timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── scheduling_professional_areas (vínculo N:N, replace-wholesale) ────────────
export const schedulingProfessionalAreas = pgTable('scheduling_professional_areas', {
  id:              uuid('id').primaryKey().defaultRandom(),
  tenant_id:       uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  professional_id: uuid('professional_id').notNull().references(() => schedulingProfessionals.id, { onDelete: 'cascade' }),
  area_id:         uuid('area_id').notNull().references(() => schedulingAreas.id, { onDelete: 'cascade' }),
  created_at:      timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── scheduling_availability_rules (grade semanal; weekday 0=domingo…6=sábado,
// mesma convenção de Date.getUTCDay()) ────────────────────────────────────────
export const schedulingAvailabilityRules = pgTable('scheduling_availability_rules', {
  id:              uuid('id').primaryKey().defaultRandom(),
  tenant_id:       uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  professional_id: uuid('professional_id').notNull().references(() => schedulingProfessionals.id, { onDelete: 'cascade' }),
  weekday:         smallint('weekday').notNull(),
  start_time:      varchar('start_time', { length: 5 }).notNull(),
  end_time:        varchar('end_time',   { length: 5 }).notNull(),
  created_at:      timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at:      timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── scheduling_availability_exceptions ('block' sem horários = dia inteiro;
// 'open' = abertura extra somada à grade) ─────────────────────────────────────
export const schedulingAvailabilityExceptions = pgTable('scheduling_availability_exceptions', {
  id:              uuid('id').primaryKey().defaultRandom(),
  tenant_id:       uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  professional_id: uuid('professional_id').notNull().references(() => schedulingProfessionals.id, { onDelete: 'cascade' }),
  date:            date('date').notNull(),
  kind:            varchar('kind', { length: 10 }).notNull(),
  start_time:      varchar('start_time', { length: 5 }),
  end_time:        varchar('end_time',   { length: 5 }),
  note:            varchar('note', { length: 255 }),
  created_at:      timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at:      timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── scheduling_package_templates (area_id NULL = qualquer área) ───────────────
export const schedulingPackageTemplates = pgTable('scheduling_package_templates', {
  id:            uuid('id').primaryKey().defaultRandom(),
  tenant_id:     uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  name:          varchar('name', { length: 120 }).notNull(),
  area_id:       uuid('area_id').references(() => schedulingAreas.id, { onDelete: 'set null' }),
  session_count: integer('session_count').notNull(),
  price:         decimal('price', { precision: 15, scale: 2 }).notNull().default('0'),
  validity_days: integer('validity_days'),
  is_active:     boolean('is_active').notNull().default(true),
  created_by:    uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  created_at:    timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at:    timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── scheduling_client_packages (histórico financeiro, NUNCA deletado; saldo é
// sempre derivado total-used; campos são snapshot do modelo na concessão) ─────
export const schedulingClientPackages = pgTable('scheduling_client_packages', {
  id:             uuid('id').primaryKey().defaultRandom(),
  tenant_id:      uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  client_id:      uuid('client_id').notNull().references(() => clients.id),
  template_id:    uuid('template_id').references(() => schedulingPackageTemplates.id, { onDelete: 'set null' }),
  area_id:        uuid('area_id').references(() => schedulingAreas.id, { onDelete: 'set null' }),
  name:           varchar('name', { length: 120 }).notNull(),
  total_sessions: integer('total_sessions').notNull(),
  used_sessions:  integer('used_sessions').notNull().default(0),
  price:          decimal('price', { precision: 15, scale: 2 }).notNull().default('0'),
  payment_status: varchar('payment_status', { length: 10 }).notNull().default('pending'),
  status:         varchar('status', { length: 12 }).notNull().default('active'),
  valid_until:    date('valid_until'),
  notes:          text('notes'),
  created_by:     uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  created_at:     timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at:     timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── scheduling_sessions (intervalo meio-aberto [start,end); conflito = mesmo
// profissional + mesma área + overlap em status bloqueante pending/confirmed;
// client_name é snapshot denormalizado como service_visits.technician_name) ───
export const schedulingSessions = pgTable('scheduling_sessions', {
  id:              uuid('id').primaryKey().defaultRandom(),
  tenant_id:       uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  professional_id: uuid('professional_id').notNull().references(() => schedulingProfessionals.id),
  client_id:       uuid('client_id').notNull().references(() => clients.id),
  client_name:     varchar('client_name', { length: 255 }).notNull(),
  area_id:         uuid('area_id').notNull().references(() => schedulingAreas.id),
  package_id:      uuid('package_id').references(() => schedulingClientPackages.id, { onDelete: 'set null' }),
  date:            date('date').notNull(),
  start_time:      varchar('start_time', { length: 5 }).notNull(),
  end_time:        varchar('end_time',   { length: 5 }).notNull(),
  status:          varchar('status', { length: 10 }).notNull().default('confirmed'),
  requested_by:    varchar('requested_by', { length: 15 }).notNull().default('professional'),
  decline_reason:  text('decline_reason'),
  cancel_reason:   text('cancel_reason'),
  canceled_at:     timestamp('canceled_at', { withTimezone: true }),
  canceled_by:     uuid('canceled_by').references(() => users.id, { onDelete: 'set null' }),
  completed_at:    timestamp('completed_at', { withTimezone: true }),
  notes:           text('notes'),
  // Mapa sessão → evento no Google Calendar (migration 0066) — nullable, só
  // preenchido quando a sessão foi sincronizada; permite update/delete depois.
  google_event_id: varchar('google_event_id', { length: 255 }),
  created_by:      uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  created_at:      timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at:      timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── scheduling_calendar_connections (integração Google Calendar, migration 0066)
// Conexão OAuth por PROFISSIONAL — cada um conecta a própria conta Google e vê
// os próprios atendimentos. Espelho de marketplace_connections. ─────────────────
export const schedulingCalendarConnections = pgTable('scheduling_calendar_connections', {
  id:                   uuid('id').primaryKey().defaultRandom(),
  tenant_id:            uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  professional_id:      uuid('professional_id').notNull().references(() => schedulingProfessionals.id, { onDelete: 'cascade' }),
  provider:             varchar('provider', { length: 30 }).notNull().default('google'),
  google_account_email: varchar('google_account_email', { length: 255 }),
  access_token:         text('access_token'),
  refresh_token:        text('refresh_token'),
  token_expires_at:     timestamp('token_expires_at', { withTimezone: true }),
  scope:                varchar('scope', { length: 255 }),
  calendar_id:          varchar('calendar_id', { length: 255 }).notNull().default('primary'),
  status:               varchar('status', { length: 20 }).notNull().default('disconnected'),
  connected_at:         timestamp('connected_at', { withTimezone: true }),
  connected_by:         uuid('connected_by').references(() => users.id, { onDelete: 'set null' }),
  disconnected_at:      timestamp('disconnected_at', { withTimezone: true }),
  last_refreshed_at:    timestamp('last_refreshed_at', { withTimezone: true }),
  created_at:           timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at:           timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── scheduling_package_movements (append-only; débito atômico na conclusão;
// idempotency_key 'session_completed:<session_id>' UNIQUE = backstop físico
// contra débito duplo — mesmo padrão de cost_center_movements) ────────────────
export const schedulingPackageMovements = pgTable('scheduling_package_movements', {
  id:              uuid('id').primaryKey().defaultRandom(),
  tenant_id:       uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  package_id:      uuid('package_id').notNull().references(() => schedulingClientPackages.id),
  session_id:      uuid('session_id').references(() => schedulingSessions.id, { onDelete: 'set null' }),
  direction:       varchar('direction', { length: 6 }).notNull(),
  quantity:        integer('quantity').notNull().default(1),
  balance_after:   integer('balance_after').notNull(),
  reason:          varchar('reason', { length: 30 }).notNull(),
  idempotency_key: varchar('idempotency_key', { length: 80 }).notNull(),
  created_by:      uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  created_at:      timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── WhatsApp — Cobranças e Notificações (migration 0067) ───────────────────────
// Módulo opcional pago. MVP: mensagens de template disparadas por evento do
// ERP (cobrança a vencer/vencida, pagamento confirmado, nota fiscal emitida,
// proposta enviada) via BSP (Twilio nesta fase). Credenciais são POR TENANT
// (jsonb genérico, mesmo padrão de bank_accounts.credentials — nunca um app
// compartilhado da plataforma), nunca cacheadas.

// 1 conta por tenant nesta fase (multi-número fica pra depois).
export const whatsappAccounts = pgTable('whatsapp_accounts', {
  id:              uuid('id').primaryKey().defaultRandom(),
  tenant_id:       uuid('tenant_id').notNull().unique().references(() => tenants.id, { onDelete: 'cascade' }),
  provider:        varchar('provider', { length: 30 }).notNull().default('twilio'),
  credentials:     jsonb('credentials'),
  whatsapp_number: varchar('whatsapp_number', { length: 20 }),
  display_name:    varchar('display_name', { length: 100 }),
  status:          varchar('status', { length: 20 }).notNull().default('pending'),
  connected_at:    timestamp('connected_at', { withTimezone: true }),
  created_at:      timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at:      timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// Conteúdo é fixo pelo sistema (nunca editável pelo tenant); provider_template_id
// é o Content SID do Twilio, preenchido depois de aprovado (passo manual/
// operacional, fora do escopo de código).
export const whatsappMessageTemplates = pgTable('whatsapp_message_templates', {
  id:                   uuid('id').primaryKey().defaultRandom(),
  tenant_id:            uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  template_key:         varchar('template_key', { length: 40 }).notNull(),
  provider_template_id: varchar('provider_template_id', { length: 100 }),
  status:               varchar('status', { length: 20 }).notNull().default('pending_approval'),
  created_at:           timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at:           timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// 1 linha por (tenant, template_key) — desligada por padrão. config carrega
// {days_before}/{days_after} pros 2 eventos de proximidade de vencimento;
// vazio pros 3 eventos disparados na hora.
export const whatsappAutomations = pgTable('whatsapp_automations', {
  id:           uuid('id').primaryKey().defaultRandom(),
  tenant_id:    uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  template_key: varchar('template_key', { length: 40 }).notNull(),
  enabled:      boolean('enabled').notNull().default(false),
  config:       jsonb('config').notNull().default({}),
  created_at:   timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at:   timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// 1 linha por mensagem enviada. Referências pro documento de origem são
// nullable e mutuamente exclusivas na prática — mesmo padrão de FK nullable
// opcional já usado em receivables.service_order_id.
export const whatsappMessages = pgTable('whatsapp_messages', {
  id:                   uuid('id').primaryKey().defaultRandom(),
  tenant_id:            uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  client_id:            uuid('client_id').references(() => clients.id, { onDelete: 'set null' }),
  phone_e164:           varchar('phone_e164', { length: 20 }).notNull(),
  template_key:         varchar('template_key', { length: 40 }).notNull(),
  receivable_id:        uuid('receivable_id').references(() => receivables.id, { onDelete: 'set null' }),
  invoice_id:           uuid('invoice_id').references(() => invoices.id, { onDelete: 'set null' }),
  proposal_id:          uuid('proposal_id').references(() => proposals.id, { onDelete: 'set null' }),
  provider_message_id:  varchar('provider_message_id', { length: 100 }),
  status:               varchar('status', { length: 20 }).notNull().default('queued'),
  status_reason:        text('status_reason'),
  sent_at:              timestamp('sent_at', { withTimezone: true }),
  delivered_at:         timestamp('delivered_at', { withTimezone: true }),
  read_at:              timestamp('read_at', { withTimezone: true }),
  created_at:           timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// Append-only, mesmo padrão de nfe_events/boleto_events.
export const whatsappMessageEvents = pgTable('whatsapp_message_events', {
  id:                   uuid('id').primaryKey().defaultRandom(),
  tenant_id:            uuid('tenant_id').notNull(),
  whatsapp_message_id:  uuid('whatsapp_message_id').notNull().references(() => whatsappMessages.id, { onDelete: 'cascade' }),
  event_type:           varchar('event_type', { length: 30 }).notNull(),
  payload:              jsonb('payload'),
  created_at:           timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// Idempotência de webhook inbound (status callback + mensagem recebida),
// mesmo padrão de marketplace_webhook_events.
export const whatsappWebhookEvents = pgTable('whatsapp_webhook_events', {
  id:              uuid('id').primaryKey().defaultRandom(),
  provider:        varchar('provider', { length: 30 }).notNull().default('twilio'),
  idempotency_key: varchar('idempotency_key', { length: 200 }).notNull().unique(),
  status:          varchar('status', { length: 20 }).notNull().default('received'),
  error_message:   text('error_message'),
  received_at:     timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  processed_at:    timestamp('processed_at', { withTimezone: true }),
});

// ── fiscal_events (migration 0068) ────────────────────────────────────────────
// ÍNDICE UNIFICADO de auditoria do módulo Fiscal, append-only (nunca UPDATE/
// DELETE). Dono único: 0068_fiscal_core. Os *_events por agregado continuam
// como log detalhado; o dashboard de auditoria lê daqui. Escrita SEMPRE via
// fiscalAuditService.record() (mascara segredos e aplica idempotência 23505).
export const fiscalEvents = pgTable('fiscal_events', {
  id:                 uuid('id').primaryKey().defaultRandom(),
  tenant_id:          uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  company_id:         uuid('company_id').references(() => nfeConfigs.id, { onDelete: 'set null' }),
  aggregate_type:     varchar('aggregate_type', { length: 40 }).notNull(),
  aggregate_id:       uuid('aggregate_id'),
  event_type:         varchar('event_type', { length: 60 }).notNull(),
  // NULL = sistema (worker/job agendado).
  actor_user_id:      uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
  source_file_s3_key: text('source_file_s3_key'),
  xml_s3_key:         text('xml_s3_key'),
  pdf_s3_key:         text('pdf_s3_key'),
  payload_hash:       varchar('payload_hash', { length: 64 }),
  request_payload:    jsonb('request_payload'),
  response_payload:   jsonb('response_payload'),
  attempt:            integer('attempt'),
  idempotency_key:    varchar('idempotency_key', { length: 160 }),
  created_at:         timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── Cadastro fiscal por empresa (migration 0069) ─────────────────────────────
// Tabela FILHA 1:1 de nfe_configs — o cadastro profundo do Simples/NFS-e fica
// atrás do módulo 'fiscal' sem acoplar ao CRUD base de empresa. Campos já
// existentes em nfe_configs são lidos por JOIN, nunca duplicados.
export const fiscalCompanyConfig = pgTable('fiscal_company_config', {
  id:                        uuid('id').primaryKey().defaultRandom(),
  tenant_id:                 uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  company_id:                uuid('company_id').notNull().references(() => nfeConfigs.id, { onDelete: 'cascade' }).unique(),
  // MEI = DAS-SIMEI fixo; apuração percentual é bloqueada para MEI no MVP.
  enquadramento:             varchar('enquadramento', { length: 3 }).notNull().default('ME'),
  optante_simples:           boolean('optante_simples').notNull().default(false),
  data_opcao_simples:        date('data_opcao_simples'),
  // Início de atividade (<12 meses) proporcionaliza o RBT12 (LC123 art.18 §§1-2).
  data_abertura:             date('data_abertura'),
  anexo_padrao:              smallint('anexo_padrao'),
  fator_r_aplicavel:         boolean('fator_r_aplicavel').notNull().default(false),
  regime_apuracao:           varchar('regime_apuracao', { length: 12 }).notNull().default('competencia'),
  iss_retido_padrao:         boolean('iss_retido_padrao').notNull().default(false),
  iss_fixo:                  boolean('iss_fixo').notNull().default(false),
  iss_fixo_valor:            decimal('iss_fixo_valor', { precision: 15, scale: 2 }),
  retencao_federal:          boolean('retencao_federal').notNull().default(false),
  retencoes:                 jsonb('retencoes'),
  // Bootstrap de RBT12 na transição (sem documentos internos no histórico).
  receita_acumulada_abertura: decimal('receita_acumulada_abertura', { precision: 15, scale: 2 }),
  rbt12_manual:              decimal('rbt12_manual', { precision: 15, scale: 2 }),
  nfse_provider:             varchar('nfse_provider', { length: 16 }).notNull().default('focus'),
  nfse_provider_profile:     varchar('nfse_provider_profile', { length: 24 }),
  rps_serie:                 varchar('rps_serie', { length: 5 }).notNull().default('1'),
  rps_proximo_numero:        integer('rps_proximo_numero').notNull().default(1),
  lote_proximo_numero:       integer('lote_proximo_numero').notNull().default(1),
  created_by:                uuid('created_by'),
  created_at:                timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at:                timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const fiscalCompanyCnae = pgTable('fiscal_company_cnae', {
  id:           uuid('id').primaryKey().defaultRandom(),
  tenant_id:    uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  company_id:   uuid('company_id').notNull().references(() => nfeConfigs.id, { onDelete: 'cascade' }),
  codigo:       varchar('codigo', { length: 9 }).notNull(),
  descricao:    varchar('descricao', { length: 255 }),
  is_principal: boolean('is_principal').notNull().default(false),
  created_at:   timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const fiscalCompanyServiceCode = pgTable('fiscal_company_service_code', {
  id:               uuid('id').primaryKey().defaultRandom(),
  tenant_id:        uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  company_id:       uuid('company_id').notNull().references(() => nfeConfigs.id, { onDelete: 'cascade' }),
  codigo_lc116:     varchar('codigo_lc116', { length: 10 }).notNull(),
  codigo_municipal: varchar('codigo_municipal', { length: 20 }),
  descricao:        varchar('descricao', { length: 255 }),
  aliquota_iss:     decimal('aliquota_iss', { precision: 5, scale: 2 }),
  iss_retido:       boolean('iss_retido').notNull().default(false),
  anexo:            smallint('anexo'),
  is_default:       boolean('is_default').notNull().default(false),
  created_at:       timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// Folha + pró-labore por competência ('YYYY-MM') — insumo rolling-12m do Fator R.
export const fiscalCompanyPayrollMonth = pgTable('fiscal_company_payroll_month', {
  id:                uuid('id').primaryKey().defaultRandom(),
  tenant_id:         uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  company_id:        uuid('company_id').notNull().references(() => nfeConfigs.id, { onDelete: 'cascade' }),
  competencia:       varchar('competencia', { length: 7 }).notNull(),
  folha_amount:      decimal('folha_amount', { precision: 15, scale: 2 }).notNull().default('0'),
  pro_labore_amount: decimal('pro_labore_amount', { precision: 15, scale: 2 }).notNull().default('0'),
  source:            varchar('source', { length: 14 }).notNull().default('manual'),
  created_by:        uuid('created_by'),
  created_at:        timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at:        timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// Certificado A1 por empresa — credentials {pfx_base64, senha} em texto puro
// (padrão bank_accounts.credentials; KMS = Fase 2). 1 ativo por empresa
// (UNIQUE parcial); trocar = desativar anterior + inserir (histórico auditável).
export const fiscalCertificates = pgTable('fiscal_certificates', {
  id:          uuid('id').primaryKey().defaultRandom(),
  tenant_id:   uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  company_id:  uuid('company_id').notNull().references(() => nfeConfigs.id, { onDelete: 'cascade' }),
  credentials: jsonb('credentials').notNull(),
  cn:          varchar('cn', { length: 255 }),
  not_before:  timestamp('not_before', { withTimezone: true }),
  not_after:   timestamp('not_after', { withTimezone: true }),
  thumbprint:  varchar('thumbprint', { length: 64 }),
  is_active:   boolean('is_active').notNull().default(true),
  created_by:  uuid('created_by'),
  created_at:  timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── Importação multi-fonte (migration 0071) ──────────────────────────────────
// Molde do importador Mercado Livre: batch (auditoria do upload, original no
// S3 + checksum) + LEDGER CANÔNICO imported_transactions (dedup físico por
// UNIQUE tenant+dedup_key; raw jsonb preserva o não-mapeado). O motor de
// conciliação (0072) é o ÚNICO escritor de reconciliation_status.
export const importBatches = pgTable('import_batches', {
  id:                 uuid('id').primaryKey().defaultRandom(),
  tenant_id:          uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  company_id:         uuid('company_id').notNull().references(() => nfeConfigs.id, { onDelete: 'cascade' }),
  source_kind:        varchar('source_kind', { length: 20 }).notNull(),
  source_template_id: uuid('source_template_id'),
  original_filename:  varchar('original_filename', { length: 255 }).notNull(),
  s3_key:             text('s3_key'),
  checksum_sha256:    char('checksum_sha256', { length: 64 }).notNull(),
  byte_size:          integer('byte_size').notNull().default(0),
  content_type:       varchar('content_type', { length: 100 }),
  status:             varchar('status', { length: 20 }).notNull().default('received'),
  total_rows:         integer('total_rows').notNull().default(0),
  inserted_rows:      integer('inserted_rows').notNull().default(0),
  duplicate_rows:     integer('duplicate_rows').notNull().default(0),
  error_rows:         integer('error_rows').notNull().default(0),
  error_message:      text('error_message'),
  uploaded_by:        uuid('uploaded_by'),
  created_at:         timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  processed_at:       timestamp('processed_at', { withTimezone: true }),
});

export const importSourceTemplates = pgTable('import_source_templates', {
  id:                uuid('id').primaryKey().defaultRandom(),
  tenant_id:         uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  company_id:        uuid('company_id').references(() => nfeConfigs.id, { onDelete: 'cascade' }),
  name:              varchar('name', { length: 80 }).notNull(),
  source_kind:       varchar('source_kind', { length: 20 }).notNull().default('csv'),
  provider_hint:     varchar('provider_hint', { length: 30 }),
  column_map:        jsonb('column_map').notNull(),
  delimiter:         varchar('delimiter', { length: 3 }),
  encoding:          varchar('encoding', { length: 10 }).notNull().default('utf8'),
  date_format:       varchar('date_format', { length: 20 }).notNull().default('DD/MM/YYYY'),
  decimal_separator: char('decimal_separator', { length: 1 }).notNull().default(','),
  has_header:        boolean('has_header').notNull().default(true),
  skip_rows:         smallint('skip_rows').notNull().default(0),
  dedup_strategy:    varchar('dedup_strategy', { length: 12 }).notNull().default('auto'),
  is_active:         boolean('is_active').notNull().default(true),
  created_at:        timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at:        timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const importedTransactions = pgTable('imported_transactions', {
  id:                    uuid('id').primaryKey().defaultRandom(),
  tenant_id:             uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  company_id:            uuid('company_id').notNull().references(() => nfeConfigs.id, { onDelete: 'cascade' }),
  batch_id:              uuid('batch_id').notNull().references(() => importBatches.id, { onDelete: 'cascade' }),
  source:                varchar('source', { length: 10 }).notNull(),
  source_kind:           varchar('source_kind', { length: 20 }).notNull(),
  dedup_key:             varchar('dedup_key', { length: 200 }).notNull(),
  occurred_at:           timestamp('occurred_at', { withTimezone: true }),
  nsu:                   varchar('nsu', { length: 40 }),
  authorization_code:    varchar('authorization_code', { length: 40 }),
  acquirer:              varchar('acquirer', { length: 40 }),
  card_brand:            varchar('card_brand', { length: 30 }),
  customer_name:         varchar('customer_name', { length: 255 }),
  customer_document:     varchar('customer_document', { length: 14 }),
  gross_amount:          decimal('gross_amount', { precision: 15, scale: 2 }),
  fee_amount:            decimal('fee_amount', { precision: 15, scale: 2 }),
  net_amount:            decimal('net_amount', { precision: 15, scale: 2 }),
  installments:          smallint('installments'),
  payment_method:        varchar('payment_method', { length: 30 }),
  establishment:         varchar('establishment', { length: 120 }),
  terminal_serial:       varchar('terminal_serial', { length: 60 }),
  bank_account_ref:      varchar('bank_account_ref', { length: 60 }),
  fitid:                 varchar('fitid', { length: 120 }),
  memo:                  text('memo'),
  trn_type:              varchar('trn_type', { length: 20 }),
  amount:                decimal('amount', { precision: 15, scale: 2 }),
  raw:                   jsonb('raw').notNull(),
  reconciliation_status: varchar('reconciliation_status', { length: 20 }).notNull().default('pending'),
  created_at:            timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── Motor contábil de dupla entrada (migration 0078) ─────────────────────────
export const chartOfAccounts = pgTable('chart_of_accounts', {
  id:                uuid('id').primaryKey().defaultRandom(),
  tenant_id:         uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }), // NULL = global
  code:              varchar('code', { length: 20 }).notNull(),
  name:              varchar('name', { length: 120 }).notNull(),
  nature:            varchar('nature', { length: 10 }).notNull(),
  normal_balance:    varchar('normal_balance', { length: 6 }).notNull(),
  is_postable:       boolean('is_postable').notNull().default(true),
  system_key:        varchar('system_key', { length: 40 }),
  dre_category_code: varchar('dre_category_code', { length: 30 }),
  is_active:         boolean('is_active').notNull().default(true),
});

export const journalEntries = pgTable('journal_entries', {
  id:                   uuid('id').primaryKey().defaultRandom(),
  tenant_id:            uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  company_id:           uuid('company_id').references(() => nfeConfigs.id, { onDelete: 'set null' }),
  entry_date:           date('entry_date').notNull(),
  competencia:          char('competencia', { length: 7 }).notNull(),
  source_type:          varchar('source_type', { length: 30 }).notNull(),
  source_id:            uuid('source_id'),
  description:          varchar('description', { length: 200 }).notNull(),
  reversed_by_entry_id: uuid('reversed_by_entry_id'),
  posted_by:            uuid('posted_by'),
  created_at:           timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const journalLines = pgTable('journal_lines', {
  id:         uuid('id').primaryKey().defaultRandom(),
  tenant_id:  uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  entry_id:   uuid('entry_id').notNull().references(() => journalEntries.id, { onDelete: 'cascade' }),
  account_id: uuid('account_id').notNull().references(() => chartOfAccounts.id),
  side:       varchar('side', { length: 6 }).notNull(),
  amount:     decimal('amount', { precision: 15, scale: 2 }).notNull(),
  line_order: smallint('line_order').notNull().default(0),
});

// ── Fechamento de competência (migration 0077) ───────────────────────────────
// FECHAR ≠ TRAVAR: runs = checklist executável; locks = trava explícita
// (enforcement único via fiscalClosingService.assertCompetenciaAberta).
export const fiscalClosingRuns = pgTable('fiscal_closing_runs', {
  id:          uuid('id').primaryKey().defaultRandom(),
  tenant_id:   uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  company_id:  uuid('company_id').notNull().references(() => nfeConfigs.id, { onDelete: 'cascade' }),
  competencia: char('competencia', { length: 7 }).notNull(),
  status:      varchar('status', { length: 24 }).notNull().default('running'),
  steps:       jsonb('steps').notNull().default({}),
  report:      jsonb('report'),
  started_by:  uuid('started_by'),
  started_at:  timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  finished_at: timestamp('finished_at', { withTimezone: true }),
});

export const fiscalPeriodLocks = pgTable('fiscal_period_locks', {
  id:             uuid('id').primaryKey().defaultRandom(),
  tenant_id:      uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  company_id:     uuid('company_id').notNull().references(() => nfeConfigs.id, { onDelete: 'cascade' }),
  competencia:    char('competencia', { length: 7 }).notNull(),
  status:         varchar('status', { length: 10 }).notNull().default('locked'),
  closing_run_id: uuid('closing_run_id'),
  report:         jsonb('report'),
  locked_by:      uuid('locked_by'),
  locked_at:      timestamp('locked_at', { withTimezone: true }).notNull().defaultNow(),
  unlocked_by:    uuid('unlocked_by'),
  unlocked_at:    timestamp('unlocked_at', { withTimezone: true }),
  unlock_reason:  text('unlock_reason'),
});

// ── Central de alertas fiscais (migration 0076) ──────────────────────────────
// Dedupe físico por dedupe_key TEXT NOT NULL + UNIQUE parcial WHERE status
// <> 'resolved' (resolvido pode recorrer como nova linha). Escrita SEMPRE via
// fiscalAlertService (catch-23505 → touch last_detected_at).
export const fiscalAlerts = pgTable('fiscal_alerts', {
  id:                uuid('id').primaryKey().defaultRandom(),
  tenant_id:         uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  company_id:        uuid('company_id').references(() => nfeConfigs.id, { onDelete: 'cascade' }),
  rule_key:          varchar('rule_key', { length: 40 }).notNull(),
  severity:          varchar('severity', { length: 8 }).notNull(),
  title:             varchar('title', { length: 200 }).notNull(),
  detail:            text('detail'),
  payload:           jsonb('payload'),
  ref_type:          varchar('ref_type', { length: 24 }),
  ref_id:            uuid('ref_id'),
  periodo:           char('periodo', { length: 7 }),
  dedupe_key:        varchar('dedupe_key', { length: 160 }).notNull(),
  status:            varchar('status', { length: 12 }).notNull().default('open'),
  acknowledged_by:   uuid('acknowledged_by'),
  acknowledged_at:   timestamp('acknowledged_at', { withTimezone: true }),
  resolved_by:       uuid('resolved_by'),
  resolved_at:       timestamp('resolved_at', { withTimezone: true }),
  resolution:        varchar('resolution', { length: 8 }),
  email_sent:        boolean('email_sent').notNull().default(false),
  first_detected_at: timestamp('first_detected_at', { withTimezone: true }).notNull().defaultNow(),
  last_detected_at:  timestamp('last_detected_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── Apuração PGDAS-D (migration 0075) ────────────────────────────────────────
export const simplesApuracao = pgTable('simples_apuracao', {
  id:                 uuid('id').primaryKey().defaultRandom(),
  tenant_id:          uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  company_id:         uuid('company_id').notNull().references(() => nfeConfigs.id, { onDelete: 'cascade' }),
  competencia:        char('competencia', { length: 7 }).notNull(),
  rbt12:              decimal('rbt12', { precision: 15, scale: 2 }).notNull(),
  rbt12_source:       varchar('rbt12_source', { length: 10 }).notNull().default('ledger'),
  receita_competencia: decimal('receita_competencia', { precision: 15, scale: 2 }).notNull(),
  fator_r:            decimal('fator_r', { precision: 6, scale: 4 }),
  sublimite_excedido: boolean('sublimite_excedido').notNull().default(false),
  das_total:          decimal('das_total', { precision: 15, scale: 2 }).notNull(),
  valor_irpj:         decimal('valor_irpj', { precision: 15, scale: 2 }).notNull().default('0'),
  valor_csll:         decimal('valor_csll', { precision: 15, scale: 2 }).notNull().default('0'),
  valor_cofins:       decimal('valor_cofins', { precision: 15, scale: 2 }).notNull().default('0'),
  valor_pis:          decimal('valor_pis', { precision: 15, scale: 2 }).notNull().default('0'),
  valor_cpp:          decimal('valor_cpp', { precision: 15, scale: 2 }).notNull().default('0'),
  valor_icms:         decimal('valor_icms', { precision: 15, scale: 2 }).notNull().default('0'),
  valor_ipi:          decimal('valor_ipi', { precision: 15, scale: 2 }).notNull().default('0'),
  valor_iss:          decimal('valor_iss', { precision: 15, scale: 2 }).notNull().default('0'),
  iss_retido:         decimal('iss_retido', { precision: 15, scale: 2 }).notNull().default('0'),
  memoria:            jsonb('memoria').notNull(),
  status:             varchar('status', { length: 14 }).notNull().default('calculated'),
  created_by:         uuid('created_by'),
  created_at:         timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at:         timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const simplesApuracaoEvents = pgTable('simples_apuracao_events', {
  id:          uuid('id').primaryKey().defaultRandom(),
  tenant_id:   uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  apuracao_id: uuid('apuracao_id').notNull().references(() => simplesApuracao.id, { onDelete: 'cascade' }),
  event_type:  varchar('event_type', { length: 30 }).notNull(),
  payload:     jsonb('payload'),
  created_by:  uuid('created_by'),
  created_at:  timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const dasPayments = pgTable('das_payments', {
  id:          uuid('id').primaryKey().defaultRandom(),
  tenant_id:   uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  company_id:  uuid('company_id').notNull().references(() => nfeConfigs.id, { onDelete: 'cascade' }),
  competencia: char('competencia', { length: 7 }).notNull(),
  paid_at:     date('paid_at').notNull(),
  amount:      decimal('amount', { precision: 15, scale: 2 }).notNull(),
  source:      varchar('source', { length: 14 }).notNull().default('manual'),
  reference:   varchar('reference', { length: 100 }),
  created_by:  uuid('created_by'),
  created_at:  timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// Repartição do DAS por tributo (GLOBAL, regra 33; seed na 0075).
export const taxSimplesRepartition = pgTable('tax_simples_repartition', {
  vigencia_ano: smallint('vigencia_ano').notNull(),
  anexo:        varchar('anexo', { length: 3 }).notNull(),
  faixa:        smallint('faixa').notNull(),
  irpj:         decimal('irpj', { precision: 6, scale: 4 }).notNull().default('0'),
  csll:         decimal('csll', { precision: 6, scale: 4 }).notNull().default('0'),
  cofins:       decimal('cofins', { precision: 6, scale: 4 }).notNull().default('0'),
  pis:          decimal('pis', { precision: 6, scale: 4 }).notNull().default('0'),
  cpp:          decimal('cpp', { precision: 6, scale: 4 }).notNull().default('0'),
  icms:         decimal('icms', { precision: 6, scale: 4 }).notNull().default('0'),
  ipi:          decimal('ipi', { precision: 6, scale: 4 }).notNull().default('0'),
  iss:          decimal('iss', { precision: 6, scale: 4 }).notNull().default('0'),
}, (t) => ({
  pk: primaryKey({ columns: [t.vigencia_ano, t.anexo, t.faixa] }),
}));

// Ledger de receita segregada (migration 0070) — base do RBT12 por empresa.
export const fiscalRevenueMonthly = pgTable('fiscal_revenue_monthly', {
  id:                  uuid('id').primaryKey().defaultRandom(),
  tenant_id:           uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  company_id:          uuid('company_id').notNull().references(() => nfeConfigs.id, { onDelete: 'cascade' }),
  competencia:         char('competencia', { length: 7 }).notNull(),
  anexo:               smallint('anexo'),
  municipio_ibge:      varchar('municipio_ibge', { length: 10 }),
  cnae:                char('cnae', { length: 7 }),
  receita_bruta:       decimal('receita_bruta', { precision: 15, scale: 2 }).notNull().default('0'),
  receita_tributavel:  decimal('receita_tributavel', { precision: 15, scale: 2 }).notNull().default('0'),
  receita_isenta:      decimal('receita_isenta', { precision: 15, scale: 2 }).notNull().default('0'),
  receita_com_retencao: decimal('receita_com_retencao', { precision: 15, scale: 2 }).notNull().default('0'),
  receita_exportacao:  decimal('receita_exportacao', { precision: 15, scale: 2 }).notNull().default('0'),
  source_doc_type:     varchar('source_doc_type', { length: 20 }).notNull(),
  source_doc_id:       uuid('source_doc_id'),
  created_at:          timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── Conciliação (migration 0072) ─────────────────────────────────────────────
// Ledger de matches (append-only + reversão auditada). Vínculo POLIMÓRFICO
// target_type/target_id cobre alvos sem receivable (pedido/agenda). Este
// motor é o ÚNICO escritor de imported_transactions.reconciliation_status.
export const reconciliationMatches = pgTable('reconciliation_matches', {
  id:                      uuid('id').primaryKey().defaultRandom(),
  tenant_id:               uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  company_id:              uuid('company_id').notNull().references(() => nfeConfigs.id, { onDelete: 'cascade' }),
  imported_transaction_id: uuid('imported_transaction_id').notNull().references(() => importedTransactions.id, { onDelete: 'cascade' }),
  target_type:             varchar('target_type', { length: 24 }).notNull(),
  target_id:               uuid('target_id'),
  receivable_id:           uuid('receivable_id'),
  receivable_payment_id:   uuid('receivable_payment_id'),
  amount_matched:          decimal('amount_matched', { precision: 15, scale: 2 }).notNull(),
  score:                   decimal('score', { precision: 5, scale: 4 }).notNull().default('0'),
  matched_keys:            jsonb('matched_keys'),
  match_method:            varchar('match_method', { length: 10 }).notNull().default('auto'),
  status:                  varchar('status', { length: 12 }).notNull().default('suggested'),
  dedup_key:               varchar('dedup_key', { length: 200 }).notNull(),
  matched_by:              uuid('matched_by'),
  confirmed_at:            timestamp('confirmed_at', { withTimezone: true }),
  reversed_by:             uuid('reversed_by'),
  reversed_at:             timestamp('reversed_at', { withTimezone: true }),
  created_at:              timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const reconciliationRules = pgTable('reconciliation_rules', {
  id:                     uuid('id').primaryKey().defaultRandom(),
  tenant_id:              uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  company_id:             uuid('company_id').references(() => nfeConfigs.id, { onDelete: 'cascade' }),
  amount_tolerance:       decimal('amount_tolerance', { precision: 15, scale: 2 }).notNull().default('0.01'),
  date_window_days:       smallint('date_window_days').notNull().default(3),
  auto_confirm_threshold: decimal('auto_confirm_threshold', { precision: 5, scale: 4 }).notNull().default('0.90'),
  match_net_amount:       boolean('match_net_amount').notNull().default(true),
  is_active:              boolean('is_active').notNull().default(true),
  created_at:             timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at:             timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── Consolidação (migration 0073) ────────────────────────────────────────────
export const consolidationRules = pgTable('consolidation_rules', {
  id:           uuid('id').primaryKey().defaultRandom(),
  tenant_id:    uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  company_id:   uuid('company_id').notNull().references(() => nfeConfigs.id, { onDelete: 'cascade' }),
  client_id:    uuid('client_id'),
  contract_id:  uuid('contract_id'),
  strategy:     varchar('strategy', { length: 12 }).notNull().default('monthly'),
  service_code: varchar('service_code', { length: 10 }),
  is_active:    boolean('is_active').notNull().default(true),
  created_by:   uuid('created_by'),
  created_at:   timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at:   timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const fiscalDocumentDrafts = pgTable('fiscal_document_drafts', {
  id:                uuid('id').primaryKey().defaultRandom(),
  tenant_id:         uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  company_id:        uuid('company_id').notNull().references(() => nfeConfigs.id, { onDelete: 'cascade' }),
  client_id:         uuid('client_id'),
  rule_id:           uuid('rule_id'),
  strategy_snapshot: varchar('strategy_snapshot', { length: 12 }).notNull(),
  doc_type:          varchar('doc_type', { length: 6 }).notNull().default('nfse'),
  competency_ref:    char('competency_ref', { length: 7 }).notNull(),
  service_code:      varchar('service_code', { length: 10 }),
  grouping_key:      varchar('grouping_key', { length: 200 }).notNull(),
  status:            varchar('status', { length: 12 }).notNull().default('open'),
  amount:            decimal('amount', { precision: 15, scale: 2 }).notNull().default('0'),
  simples_effective_rate: decimal('simples_effective_rate', { precision: 6, scale: 4 }),
  rbt12:             decimal('rbt12', { precision: 15, scale: 2 }),
  anexo:             varchar('anexo', { length: 3 }),
  iss_rate:          decimal('iss_rate', { precision: 5, scale: 2 }),
  iss_value:         decimal('iss_value', { precision: 15, scale: 2 }),
  iss_retido:        boolean('iss_retido').notNull().default(false),
  nfse_id:           uuid('nfse_id'),
  error_message:     text('error_message'),
  created_at:        timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at:        timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const fiscalDocumentDraftLines = pgTable('fiscal_document_draft_lines', {
  id:             uuid('id').primaryKey().defaultRandom(),
  tenant_id:      uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  draft_id:       uuid('draft_id').notNull().references(() => fiscalDocumentDrafts.id, { onDelete: 'cascade' }),
  transaction_id: uuid('transaction_id').notNull().references(() => importedTransactions.id, { onDelete: 'cascade' }),
  service_code:   varchar('service_code', { length: 10 }),
  amount:         decimal('amount', { precision: 15, scale: 2 }).notNull(),
  sale_date:      date('sale_date'),
  created_at:     timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const fiscalDocumentDraftEvents = pgTable('fiscal_document_draft_events', {
  id:         uuid('id').primaryKey().defaultRandom(),
  tenant_id:  uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  draft_id:   uuid('draft_id').notNull().references(() => fiscalDocumentDrafts.id, { onDelete: 'cascade' }),
  event_type: varchar('event_type', { length: 40 }).notNull(),
  payload:    jsonb('payload'),
  created_by: uuid('created_by'),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const acquirerAccounts = pgTable('acquirer_accounts', {
  id:              uuid('id').primaryKey().defaultRandom(),
  tenant_id:       uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  company_id:      uuid('company_id').notNull().references(() => nfeConfigs.id, { onDelete: 'cascade' }),
  label:           varchar('label', { length: 80 }).notNull(),
  provider:        varchar('provider', { length: 30 }).notNull(),
  merchant_id:     varchar('merchant_id', { length: 60 }),
  terminal_serial: varchar('terminal_serial', { length: 60 }),
  fee_schedule:    jsonb('fee_schedule'),
  credentials:     jsonb('credentials'),
  is_active:       boolean('is_active').notNull().default(true),
  created_at:      timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at:      timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
