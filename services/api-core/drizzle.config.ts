import type { Config } from 'drizzle-kit';

export default {
  schema: './src/db/schema.ts',
  out: './db/drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL || 'postgres://erp_lite:erp_lite@localhost:5432/erp_lite',
  },
} satisfies Config;
