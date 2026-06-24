import {
  pgTable, uuid, varchar, text, boolean, timestamp,
  date, decimal, char, smallint, integer, jsonb,
} from 'drizzle-orm/pg-core';

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
  banking_updated_at:     timestamp('banking_updated_at', { withTimezone: true }),
  // SaaS lifecycle
  status:       varchar('status', { length: 20 }).notNull().default('trial'),
  plan:         varchar('plan',   { length: 30 }).notNull().default('starter'),
  trial_ends_at: timestamp('trial_ends_at', { withTimezone: true }),
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
  is_active:        boolean('is_active').notNull().default(true),
  tracks_inventory: boolean('tracks_inventory').notNull().default(true),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
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
  focus_ambiente: smallint('focus_ambiente').notNull().default(2),
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

// ── boletos ───────────────────────────────────────────────────────────────────
export const boletos = pgTable('boletos', {
  id:           uuid('id').primaryKey().defaultRandom(),
  tenant_id:    uuid('tenant_id').notNull().references(() => tenants.id,      { onDelete: 'cascade' }),
  receivable_id: uuid('receivable_id').notNull().references(() => receivables.id, { onDelete: 'cascade' }),

  boleto_id:    varchar('boleto_id',    { length: 100 }),
  brcode:       varchar('brcode',       { length: 100 }),
  pix_qr_code:  text('pix_qr_code'),
  nosso_numero: varchar('nosso_numero', { length: 20  }),

  banco_code:   varchar('banco_code',   { length: 3   }),
  agencia:      varchar('agencia',      { length: 10  }),
  conta:        varchar('conta',        { length: 20  }),
  digito:       varchar('digito',       { length: 2   }),

  status:       varchar('status',       { length: 20  }).notNull().default('draft'),
  issued_at:    timestamp('issued_at',  { withTimezone: true }),
  expires_at:   date('expires_at'),
  paid_at:      timestamp('paid_at',    { withTimezone: true }),

  boleto_url:   text('boleto_url'),
  pdf_s3_key:   text('pdf_s3_key'),

  created_at:   timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at:   timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── boleto_events (append-only) ───────────────────────────────────────────────
export const boletoEvents = pgTable('boleto_events', {
  id:          uuid('id').primaryKey().defaultRandom(),
  boleto_id:   uuid('boleto_id').notNull().references(() => boletos.id, { onDelete: 'cascade' }),
  tenant_id:   uuid('tenant_id').notNull().references(() => tenants.id),
  event_type:  varchar('event_type',  { length: 30 }).notNull(),
  status_code: varchar('status_code', { length: 20 }),
  response:    jsonb('response'),
  created_at:  timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── receivables ───────────────────────────────────────────────────────────────
export const receivables = pgTable('receivables', {
  id:          uuid('id').primaryKey().defaultRandom(),
  tenant_id:   uuid('tenant_id').notNull().references(() => tenants.id,  { onDelete: 'cascade' }),
  client_id:   uuid('client_id').references(() => clients.id,            { onDelete: 'set null' }),
  invoice_id:  uuid('invoice_id').references(() => invoices.id,          { onDelete: 'set null' }),
  boleto_id:   uuid('boleto_id').references(() => boletos.id,            { onDelete: 'set null' }),
  description: varchar('description', { length: 255 }).notNull(),
  amount:      decimal('amount',      { precision: 15, scale: 2 }).notNull(),
  paid_amount: decimal('paid_amount', { precision: 15, scale: 2 }).notNull().default('0'),
  due_date:    date('due_date').notNull(),
  status:      varchar('status', { length: 20 }).notNull().default('pending'),
  notes:       text('notes'),
  created_by:  uuid('created_by'),
  created_at:  timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at:  timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
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

// ── payables ──────────────────────────────────────────────────────────────────
export const payables = pgTable('payables', {
  id:              uuid('id').primaryKey().defaultRandom(),
  tenant_id:       uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  supplier_name:   varchar('supplier_name',   { length: 255 }),
  category:        varchar('category',        { length: 50  }).notNull().default('other'),
  description:     varchar('description',     { length: 255 }).notNull(),
  document_number: varchar('document_number', { length: 50  }),
  amount:          decimal('amount',      { precision: 15, scale: 2 }).notNull(),
  paid_amount:     decimal('paid_amount', { precision: 15, scale: 2 }).notNull().default('0'),
  due_date:        date('due_date').notNull(),
  status:          varchar('status', { length: 20 }).notNull().default('pending'),
  notes:           text('notes'),
  created_by:      uuid('created_by'),
  created_at:      timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at:      timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
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
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
