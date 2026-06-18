# ERP Lite — SaaS Multi-tenant ERP on AWS

## Original Prompt

> "Novo projeto num diretório `D:\repos\erp-lite`. ERP SaaS, multitenant, ambiente AWS.
> Arquitetura monorepo com Fastify + Node, frontend React, abordagem Lambda para serviços pontuais.
> Cadastro de clientes com os campos:
> - Empresa / CNPJ / Endereço / Telefone
> - Contato compras (tel, email)
> - Contato manutenção (tel, email)
> - Contato fiscal (tel, email)
> Campos em inglês para venda global. Banco PostgreSQL."

---

## Architecture

### Multi-tenancy Model

**Strategy: Shared Database, Shared Schema**

Every table carries a `tenant_id` UUID foreign key referencing the `tenants` table.
Access control is enforced at two levels:

| Layer | Mechanism |
|-------|-----------|
| API | `tenant_id` extracted from JWT claim, injected into every query |
| Database | PostgreSQL Row Level Security (RLS) as defense-in-depth |

```
SaaS Customer (Company)
       │
       ▼
  tenants (id, company_name, tax_id, …)
       │
       ├── users          (employees of that company)
       ├── products       (future)
       ├── inventory      (future)
       ├── orders         (future)
       └── …              (all ERP tables carry tenant_id)
```

### Service Decomposition

```
┌─────────────────────────────────────────────────────────┐
│  ERP Lite — AWS Architecture                            │
│                                                         │
│  CloudFront ──► S3                                      │
│      (backoffice React SPA)                             │
│                                                         │
│  ALB ──► ECS Fargate                                    │
│              api-core  (Fastify — CRUD ERP)             │
│                  │                                      │
│                  └──► RDS PostgreSQL (Multi-AZ prod)    │
│                                                         │
│  Lambda (event-driven / stateless)                      │
│    ├── auth          JWT login / token validation       │
│    ├── fiscal        NF-e, SEFAZ, async XML             │
│    ├── notifications Email / WhatsApp                   │
│    └── reports       Async heavy exports                │
│                                                         │
│  SQS ─► Lambda (notifications, reports)                 │
└─────────────────────────────────────────────────────────┘
```

### Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend API | Node.js 20 + Fastify 4 + TypeScript |
| Frontend | React 18 + Vite + TypeScript |
| Database | PostgreSQL 16 (AWS RDS) |
| Auth | Lambda + JWT (HS256) |
| IaC | Terraform |
| CI/CD | GitHub Actions |
| Container | ECS Fargate (api-core) |
| Static hosting | S3 + CloudFront |
| Messaging | SQS |
| Secrets | AWS Parameter Store |

### Why Lambda for Some Services?

| Service | Justification |
|---------|--------------|
| `auth` | Stateless, low frequency, zero idle cost |
| `fiscal` | NF-e emission is async, spiky, up to 14 min |
| `notifications` | Event-driven, SQS-triggered, no baseline traffic |
| `reports` | Heavy computation, runs on demand, suits 15-min Lambda limit |
| `api-core` | Continuous CRUD traffic → ECS Fargate keeps latency predictable |

---

## Directory Structure

```
erp-lite/
├── services/
│   ├── api-core/               ← ECS Fargate — main ERP API (Fastify)
│   │   ├── src/
│   │   │   ├── index.ts        server entry
│   │   │   ├── app.ts          Fastify factory + plugins
│   │   │   ├── config.ts       env-based config
│   │   │   ├── db/
│   │   │   │   └── pool.ts     pg Pool singleton
│   │   │   ├── routes/
│   │   │   │   ├── index.ts    route registry
│   │   │   │   └── customers.ts CRUD /v1/customers
│   │   │   └── middleware/
│   │   │       └── auth.ts     JWT tenant extraction
│   │   ├── db/
│   │   │   └── migrations/
│   │   │       ├── 0001_tenants.sql
│   │   │       └── 0002_users.sql
│   │   ├── Dockerfile
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── auth/                   ← Lambda — JWT auth (future)
│       └── src/
│           └── handler.ts
│
├── apps/
│   └── backoffice/             ← React + Vite SPA (future)
│       └── src/
│           └── main.tsx
│
├── terraform/                  ← AWS infrastructure (future)
│   ├── main.tf
│   ├── ecs.tf
│   ├── rds.tf
│   └── lambda.tf
│
├── scripts/                    ← Operational scripts (future)
│
├── package.json                ← monorepo root (npm workspaces)
└── README.md
```

---

## Database Schema

### `tenants` — SaaS Customers (Companies)

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID PK | Auto-generated |
| `company_name` | VARCHAR(255) | Legal company name |
| `trade_name` | VARCHAR(255) | Doing-business-as name |
| `tax_id` | VARCHAR(50) | CNPJ / EIN / VAT number |
| `tax_id_type` | VARCHAR(10) | `CNPJ` \| `EIN` \| `VAT` \| `OTHER` |
| `street` | VARCHAR(255) | Street address |
| `street_number` | VARCHAR(20) | House/building number |
| `complement` | VARCHAR(100) | Apt, suite, floor |
| `neighborhood` | VARCHAR(100) | District / bairro |
| `city` | VARCHAR(100) | City |
| `state` | VARCHAR(100) | State / province |
| `postal_code` | VARCHAR(20) | CEP / ZIP / postcode |
| `country` | CHAR(2) | ISO 3166-1 alpha-2 (default `BR`) |
| `phone` | VARCHAR(30) | Main company phone |
| `website` | VARCHAR(255) | Company website |
| `purchasing_contact_name` | VARCHAR(255) | Purchasing dept contact |
| `purchasing_contact_phone` | VARCHAR(30) | |
| `purchasing_contact_email` | VARCHAR(255) | |
| `maintenance_contact_name` | VARCHAR(255) | IT/maintenance contact |
| `maintenance_contact_phone` | VARCHAR(30) | |
| `maintenance_contact_email` | VARCHAR(255) | |
| `fiscal_contact_name` | VARCHAR(255) | Tax / fiscal contact |
| `fiscal_contact_phone` | VARCHAR(30) | |
| `fiscal_contact_email` | VARCHAR(255) | |
| `status` | VARCHAR(20) | `trial` \| `active` \| `suspended` \| `cancelled` |
| `plan` | VARCHAR(30) | `starter` \| `professional` \| `enterprise` |
| `trial_ends_at` | TIMESTAMPTZ | Trial expiry date |
| `created_at` | TIMESTAMPTZ | |
| `updated_at` | TIMESTAMPTZ | Auto-updated via trigger |

### `users` — Tenant Employees

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID PK | |
| `tenant_id` | UUID FK → tenants | Tenant isolation key |
| `email` | VARCHAR(255) | Unique per tenant |
| `name` | VARCHAR(255) | |
| `password_hash` | TEXT | bcrypt |
| `role` | VARCHAR(20) | `owner` \| `admin` \| `manager` \| `user` |
| `status` | VARCHAR(20) | `active` \| `disabled` |
| `created_at` | TIMESTAMPTZ | |
| `updated_at` | TIMESTAMPTZ | |

---

## API Reference — Customers

Base URL: `http://localhost:3000`

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/v1/customers` | Create new customer (tenant) |
| `GET` | `/v1/customers` | List customers (paginated) |
| `GET` | `/v1/customers/:id` | Get customer by ID |
| `PATCH` | `/v1/customers/:id` | Update customer |
| `DELETE` | `/v1/customers/:id` | Deactivate customer |

### POST /v1/customers

```json
{
  "company_name": "Acme Corp Ltda",
  "trade_name": "Acme",
  "tax_id": "12345678000195",
  "tax_id_type": "CNPJ",
  "street": "Av. Paulista",
  "street_number": "1000",
  "complement": "10º andar",
  "neighborhood": "Bela Vista",
  "city": "São Paulo",
  "state": "SP",
  "postal_code": "01310-100",
  "country": "BR",
  "phone": "+55 11 99999-9999",
  "purchasing_contact_name": "João Silva",
  "purchasing_contact_phone": "+55 11 98888-8888",
  "purchasing_contact_email": "compras@acme.com",
  "maintenance_contact_name": "Maria Souza",
  "maintenance_contact_phone": "+55 11 97777-7777",
  "maintenance_contact_email": "ti@acme.com",
  "fiscal_contact_name": "Carlos Lima",
  "fiscal_contact_phone": "+55 11 96666-6666",
  "fiscal_contact_email": "fiscal@acme.com",
  "plan": "starter"
}
```

---

## Local Development

### Prerequisites

- Node.js 20+
- Docker + Docker Compose
- PostgreSQL 16 (or use Docker)

### Setup

```bash
# Install all workspace dependencies
npm install

# Start PostgreSQL
docker compose up -d db

# Copy and fill env vars
cp services/api-core/.env.example services/api-core/.env

# Run migrations
npm run migrate --workspace=services/api-core

# Start API in dev mode
npm run dev --workspace=services/api-core
```

### Environment Variables (`services/api-core/.env`)

```
DATABASE_URL=postgres://erp_lite:erp_lite@localhost:5432/erp_lite
PORT=3000
NODE_ENV=development
JWT_SECRET=change-me-before-production
```

---

## Roadmap

- [x] Tenant (Customer) registration — CRUD
- [ ] User management per tenant
- [ ] JWT Authentication (Lambda `auth`)
- [ ] Products module
- [ ] Inventory module
- [ ] Orders module
- [ ] Fiscal / NF-e module (Lambda `fiscal`)
- [ ] Reports module (Lambda `reports`)
- [ ] Terraform — AWS infrastructure
- [ ] CI/CD — GitHub Actions pipeline
- [ ] React backoffice SPA

---

## Security Notes

- `tenant_id` is always sourced from the verified JWT, never from user input
- PostgreSQL RLS enforces tenant isolation at the DB layer
- Secrets are stored in AWS Parameter Store (never in environment variables on ECS)
- `tax_id` uniqueness is scoped to `(tax_id, tax_id_type)` to support global customers
