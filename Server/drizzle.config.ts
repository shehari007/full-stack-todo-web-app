import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

const connectionString = process.env.DATABASE_URL ?? process.env.SEQ_CONNECTION;

if (!connectionString) {
  throw new Error('DATABASE_URL is not set. Copy .env.example to .env first.');
}

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: connectionString,
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
  },
  verbose: true,
  strict: true,
});
