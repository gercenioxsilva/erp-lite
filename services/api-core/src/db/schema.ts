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
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── nfe_configs ───────────────────────────────────────────────────────────────
export const nfeConfigs = pgTable('nfe_configs', {
  tenant_id:   uuid('tenant_id').primaryKey().references(() => tenants.id, { onDelete: 'cascade' }),
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
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
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
});

// ── boletos ───────────────────────────────────────────────────────────────────
export const boletos = pgTable('boletos', {
  id:           uuid('id').primaryKey().defaultRandom(),
  tenant_id:    uuid('tenant_id').notNull().references(() => tenants.id,       { onDelete: 'cascade' }),
  receivable_id: uuid('receivable_id').notNull().references(() => receivables.id, { onDelete: 'cascade' }),

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
  sale_id:    uuid('sale_id'),
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
