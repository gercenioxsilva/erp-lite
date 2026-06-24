export const config = {
  port: Number(process.env.PORT || 3000),
  host: process.env.HOST || '0.0.0.0',
  nodeEnv: process.env.NODE_ENV || 'development',
  jwtSecret: process.env.JWT_SECRET || 'change-me',
  db: process.env.DATABASE_URL
    ? {
        connectionString: process.env.DATABASE_URL,
        // RDS PostgreSQL 16 enforces SSL (rds.force_ssl=1). Disabled locally.
        ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
      }
    : {
        host: process.env.DB_HOST || 'localhost',
        port: Number(process.env.DB_PORT || 5432),
        database: process.env.DB_NAME || 'erp_lite',
        user: process.env.DB_USER || 'erp_lite',
        password: process.env.DB_PASSWORD || 'erp_lite',
      },
};
