import { test } from "bun:test";
import assert from "assert";
import crypto from "crypto";

const API = "http://localhost:3000";

function blockId(height, txIds) {
  return crypto
    .createHash("sha256")
    .update(height + txIds.join(""))
    .digest("hex");
}

test("POST /blocks - genesis block (coinbase)", async () => {
  const tx1 = {
    id: "tx1",
    inputs: [],
    outputs: [{ address: "addr1", value: 10 }],
  };
  const block = {
    id: blockId(1, [tx1.id]),
    height: 1,
    transactions: [tx1],
  };
  const res = await fetch(`${API}/blocks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(block),
  });
  assert.strictEqual(res.status, 200);
  const data = await res.json();
  assert.strictEqual(data.success, true);
});

test("GET /balance/:address - after genesis", async () => {
  const res = await fetch(`${API}/balance/addr1`);
  assert.strictEqual(res.status, 200);
  const data = await res.json();
  assert.strictEqual(data.balance, 10);
});

test("POST /blocks - spend output", async () => {
  const tx2 = {
    id: "tx2",
    inputs: [{ txId: "tx1", index: 0 }],
    outputs: [
      { address: "addr2", value: 4 },
      { address: "addr3", value: 6 },
    ],
  };
  const block = {
    id: blockId(2, [tx2.id]),
    height: 2,
    transactions: [tx2],
  };
  const res = await fetch(`${API}/blocks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(block),
  });
  assert.strictEqual(res.status, 200);
  const data = await res.json();
  assert.strictEqual(data.success, true);
});

test("GET /balance/:address - after spend", async () => {
  let res = await fetch(`${API}/balance/addr1`);
  let data = await res.json();
  assert.strictEqual(data.balance, 0);

  res = await fetch(`${API}/balance/addr2`);
  data = await res.json();
  assert.strictEqual(data.balance, 4);

  res = await fetch(`${API}/balance/addr3`);
  data = await res.json();
  assert.strictEqual(data.balance, 6);
});

test("POST /rollback?height=1", async () => {
  const res = await fetch(`${API}/rollback?height=1`, { method: "POST" });
  assert.strictEqual(res.status, 200);
  const data = await res.json();
  assert.strictEqual(data.success, true);
});

test("GET /balance/:address - after rollback", async () => {
  let res = await fetch(`${API}/balance/addr1`);
  let data = await res.json();
  assert.strictEqual(data.balance, 10);

  res = await fetch(`${API}/balance/addr2`);
  data = await res.json();
  assert.strictEqual(data.balance, 0);

  res = await fetch(`${API}/balance/addr3`);
  data = await res.json();
  assert.strictEqual(data.balance, 0);
});
