import { Pool } from 'pg';

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL?.split('?')[0],
  ssl: { rejectUnauthorized: false },
  max: 5,
});
