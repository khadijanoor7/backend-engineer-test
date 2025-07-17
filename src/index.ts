import Fastify from "fastify";
import { Pool } from "pg";

const fastify = Fastify({ logger: true });

fastify.get("/", async (request, reply) => {
  return { hello: "world" };
});

async function createTables(pool: Pool) {
  // Create blocks table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS blocks (
      id TEXT PRIMARY KEY,
      height INTEGER UNIQUE NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  // Create transactions table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY,
      block_id TEXT NOT NULL REFERENCES blocks(id) ON DELETE CASCADE
    );
  `);

  // Create outputs table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS outputs (
      id SERIAL PRIMARY KEY,
      tx_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
      output_index INTEGER NOT NULL,
      address TEXT NOT NULL,
      value INTEGER NOT NULL,
      spent BOOLEAN DEFAULT FALSE
    );
  `);

  // Create inputs table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS inputs (
      id SERIAL PRIMARY KEY,
      tx_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
      referenced_tx_id TEXT NOT NULL,
      referenced_output_index INTEGER NOT NULL
    );
  `);

  // Create balances table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS balances (
      address TEXT PRIMARY KEY,
      balance INTEGER NOT NULL
    );
  `);
}

async function bootstrap() {
  console.log("Bootstrapping...");
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }

  const pool = new Pool({
    connectionString: databaseUrl,
  });

  await createTables(pool);
}

try {
  await bootstrap();
  await fastify.listen({
    port: 3000,
    host: "0.0.0.0",
  });
} catch (err) {
  fastify.log.error(err);
  process.exit(1);
}