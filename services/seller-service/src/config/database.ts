import knex from 'knex';
import { logger } from '../utils/logger';

let db: ReturnType<typeof knex>;

export async function connectDatabase(): Promise<void> {
  try {
    db = knex({
      client: 'pg',
      connection: {
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT || '5432'),
        user: process.env.DB_USER || 'postgres',
        password: process.env.DB_PASSWORD || 'postgres',
        database: process.env.DB_NAME || 'meesho_sellers',
      },
      pool: {
        min: 2,
        max: 10,
      },
    });

    // Test connection
    await db.raw('SELECT 1');
  } catch (error) {
    logger.error('Database connection failed:', error);
    throw error;
  }
}

export function getDatabase(): ReturnType<typeof knex> {
  if (!db) {
    throw new Error('Database not initialized. Call connectDatabase first.');
  }
  return db;
}