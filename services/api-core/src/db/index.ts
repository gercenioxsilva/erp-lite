import { drizzle } from 'drizzle-orm/node-postgres';
import { pool } from './pool';
import * as schema from './schema';

export const db = drizzle(pool, { schema });

// Re-export pool for lifecycle use (seed, tests)
export { pool };

// Re-export all schema tables
export * from './schema';
