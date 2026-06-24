const _dbHost = process.env.DB_HOST || 'localhost';
const _isLocal = _dbHost === 'localhost' || _dbHost === '127.0.0.1' || _dbHost === 'db';
const _sslConfig = _isLocal ? undefined : { rejectUnauthorized: false };

export const config = {
  port: Number(process.env.PORT || 3000),
  host: process.env.HOST || '0.0.0.0',
  nodeEnv: process.env.NODE_ENV || 'development',
  jwtSecret: process.env.JWT_SECRET || 'change-me',
  db: process.env.DATABASE_URL
    ? {
        connectionString: process.env.DATABASE_URL,
        // PGSSLMODE=require is injected by ECS task env → { rejectUnauthorized:false }.
        // Not set locally (Docker postgres has no SSL) → ssl:false.
        // Driven off PGSSLMODE, not NODE_ENV — ECS sets NODE_ENV=prod (not "production").
        ssl: process.env.PGSSLMODE === 'require' ? { rejectUnauthorized: false } : false,
      }
    : {
        host: _dbHost,
        port: Number(process.env.DB_PORT || 5432),
        database: process.env.DB_NAME || 'erp_lite',
        user: process.env.DB_USER || 'erp_lite',
        password: process.env.DB_PASSWORD || 'erp_lite',
        ssl: _sslConfig,
      },
};
