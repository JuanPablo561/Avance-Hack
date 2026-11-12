const { test } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { newDb } = require("pg-mem");
const fs = require("node:fs");
const { createApp } = require("./app.cjs");
const result = {
  detecciones: [{ clase: "Camisa", puntuacion: 0.8, caja: [0, 0, 1, 1] }],
  ancho: 1,
  alto: 1,
  segundos: 0.1,
  vista: "data:image/jpeg;base64,eA==",
};
async function setup(infer = async () => result) {
  const db = newDb();
  db.public.none(fs.readFileSync(__dirname + "/schema.sql", "utf8"));
  const { Pool } = db.adapters.createPg();
  const pool = new Pool();
  return { pool, app: createApp({ pool, infer }) };
}
const user = {
  name: "Juan",
  email: "juan@example.com",
  password: "Prueba-segura-123",
};
test("register, session, analysis persistence, isolation and logout", async () => {
  const { app, pool } = await setup();
  const agent = request.agent(app);
  assert.equal((await agent.get("/api/analyses")).status, 401);
  assert.equal((await agent.post("/api/register").send(user)).status, 201);
  assert.equal((await agent.get("/api/me")).body.user.email, user.email);
  const uploaded = await agent
    .post("/api/analyses")
    .field("umbral", ".2")
    .attach("imagen", Buffer.from("image"), "foto.png");
  assert.equal(uploaded.status, 201);
  assert.equal(uploaded.body.detecciones[0].clase, "Camisa");
  assert.equal((await agent.get("/api/analyses")).body.data.length, 1);
  const stored = await pool.query("SELECT result FROM analyses");
  assert.equal(stored.rows[0].result.vista, undefined);
  const other = request.agent(app);
  await other
    .post("/api/register")
    .send({ ...user, email: "otro@example.com" });
  assert.equal((await other.get("/api/analyses")).body.data.length, 0);
  await agent.post("/api/logout");
  assert.equal((await agent.get("/api/me")).status, 401);
  assert.equal(
    (await agent.post("/api/login").send({ ...user, password: "incorrecta" }))
      .status,
    401,
  );
  assert.equal((await agent.post("/api/login").send(user)).status, 200);
  await pool.end();
});
test("invalid input, duplicates, CSRF origin and inference failure", async () => {
  const { app, pool } = await setup(async () => {
    throw new Error("private detail");
  });
  const agent = request.agent(app);
  assert.equal(
    (await agent.post("/api/register").send({ ...user, password: "short" }))
      .status,
    400,
  );
  await agent.post("/api/register").send(user);
  assert.equal(
    (await request(app).post("/api/register").send(user)).status,
    409,
  );
  assert.equal(
    (await agent.post("/api/logout").set("Origin", "https://evil.example"))
      .status,
    403,
  );
  assert.equal(
    (
      await agent
        .post("/api/analyses")
        .field("umbral", "NaN")
        .attach("imagen", Buffer.from("x"), "x.png")
    ).status,
    400,
  );
  assert.equal((await agent.post("/api/analyses")).status, 400);
  const failed = await agent
    .post("/api/analyses")
    .attach("imagen", Buffer.from("x"), "x.png");
  assert.equal(failed.status, 503);
  assert.ok(!failed.text.includes("private detail"));
  assert.equal((await agent.get("/api/analyses")).body.data.length, 0);
  await pool.end();
});
