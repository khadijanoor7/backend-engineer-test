import Fastify from "fastify";
import { Pool } from "pg";
import { randomUUID } from "crypto";

const fastify = Fastify({ logger: true });

fastify.get("/", async (request, reply) => {
  return { hello: "world" };
});

fastify.post("/blocks", async (request, reply) => {
  const pool =
    fastify.pgPool || new Pool({ connectionString: process.env.DATABASE_URL });
  const block = request.body;

  // Schema types
  // Block = { id: string, height: number, transactions: Array<Transaction> }
  // Transaction = { id: string, inputs: Array<Input>, outputs: Array<Output> }
  // Input = { txId: string, index: number }
  // Output = { address: string, value: number }

  // 1. Validate block height
  const { rows: lastBlockRows } = await pool.query(
    "SELECT height FROM blocks ORDER BY height DESC LIMIT 1"
  );
  const lastHeight = lastBlockRows.length ? lastBlockRows[0].height : 0;
  if (block.height !== lastHeight + 1) {
    return reply
      .status(400)
      .send({ error: `Block height must be ${lastHeight + 1}` });
  }

  // 2. Validate block id
  const crypto = await import("crypto");
  const txIdsConcat = block.transactions.map((tx) => tx.id).join("");
  const expectedBlockId = crypto
    .createHash("sha256")
    .update(block.height + txIdsConcat)
    .digest("hex");
  if (block.id !== expectedBlockId) {
    return reply.status(400).send({ error: "Invalid block id" });
  }

  // 3. Validate input/output sums for each transaction
  for (const tx of block.transactions) {
    let inputSum = 0;
    if (block.height === 1 && tx.inputs.length === 0) {
      // Allow coinbase in genesis block
      inputSum = tx.outputs.reduce((sum, o) => sum + o.value, 0);
    } else {
      for (const input of tx.inputs) {
        const { rows: utxoRows } = await pool.query(
          "SELECT value, address, spent FROM outputs WHERE tx_id = $1 AND output_index = $2",
          [input.txId, input.index]
        );
        if (!utxoRows.length) {
          return reply
            .status(400)
            .send({ error: `Input not found: ${input.txId}:${input.index}` });
        }
        if (utxoRows[0].spent) {
          return reply.status(400).send({
            error: `Input already spent: ${input.txId}:${input.index}`,
          });
        }
        inputSum += utxoRows[0].value;
      }
      const outputSum = tx.outputs.reduce((sum, o) => sum + o.value, 0);
      if (inputSum !== outputSum) {
        console.log("Input/output sum mismatch", { inputSum, outputSum, tx });
        return reply
          .status(400)
          .send({ error: `Input/output sum mismatch in transaction ${tx.id}` });
      }
    }
  }

  // 4. Insert block, transactions, outputs, inputs, update balances atomically
  try {
    await pool.query("BEGIN");
    await pool.query("INSERT INTO blocks (id, height) VALUES ($1, $2)", [
      block.id,
      block.height,
    ]);
    for (const tx of block.transactions) {
      await pool.query(
        "INSERT INTO transactions (id, block_id) VALUES ($1, $2)",
        [tx.id, block.id]
      );
      // Insert outputs
      for (let i = 0; i < tx.outputs.length; i++) {
        const output = tx.outputs[i];
        await pool.query(
          "INSERT INTO outputs (tx_id, output_index, address, value, spent) VALUES ($1, $2, $3, $4, FALSE)",
          [tx.id, i, output.address, output.value]
        );
        // Update balances
        await pool.query(
          "INSERT INTO balances (address, balance) VALUES ($1, $2) ON CONFLICT (address) DO UPDATE SET balance = balances.balance + $2",
          [output.address, output.value]
        );
      }
      // Insert inputs and mark outputs as spent
      for (const input of tx.inputs) {
        await pool.query(
          "INSERT INTO inputs (tx_id, referenced_tx_id, referenced_output_index) VALUES ($1, $2, $3)",
          [tx.id, input.txId, input.index]
        );
        await pool.query(
          "UPDATE outputs SET spent = TRUE WHERE tx_id = $1 AND output_index = $2",
          [input.txId, input.index]
        );
        // Subtract from balance
        const { rows: utxoRows } = await pool.query(
          "SELECT address, value FROM outputs WHERE tx_id = $1 AND output_index = $2",
          [input.txId, input.index]
        );
        if (utxoRows.length) {
          await pool.query(
            "UPDATE balances SET balance = balance - $1 WHERE address = $2",
            [utxoRows[0].value, utxoRows[0].address]
          );
        }
      }
    }
    await pool.query("COMMIT");
    return reply.status(200).send({ success: true });
  } catch (err) {
    await pool.query("ROLLBACK");
    return reply.status(400).send({ error: err.message });
  }
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
