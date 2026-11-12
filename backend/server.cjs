const { Pool } = require("pg");
const fs = require("node:fs");
const { createApp } = require("./app.cjs");
async function main() {
  if (!process.env.DATABASE_URL)
    throw new Error("Configura DATABASE_URL. Consulta README.md.");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  await pool.query(fs.readFileSync(__dirname + "/schema.sql", "utf8"));
  const infer = async (file, threshold) => {
    const form = new FormData();
    form.append(
      "imagen",
      new Blob([file.buffer], { type: file.mimetype }),
      "foto",
    );
    form.append("umbral", String(threshold));
    const response = await fetch(
      `${process.env.NEURAL_URL || "http://127.0.0.1:8000"}/predecir`,
      { method: "POST", body: form, signal: AbortSignal.timeout(180000) },
    );
    if (!response.ok) {
      const e = new Error("Neural request failed");
      e.status = response.status;
      throw e;
    }
    return response.json();
  };
  const app = createApp({
    pool,
    infer,
    secure: process.env.NODE_ENV === "production",
    origin: process.env.APP_ORIGIN || "http://localhost:3000",
  });
  const server = app.listen(Number(process.env.PORT || 3000), () =>
    console.log("Avance Hack listo en puerto " + (process.env.PORT || 3000)),
  );
  process.on("SIGTERM", () => server.close(() => pool.end()));
}
main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
