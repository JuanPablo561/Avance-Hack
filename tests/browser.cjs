const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { newDb } = require("pg-mem");
const { createApp } = require("../backend/app.cjs");
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=",
  "base64",
);
async function main() {
  let server, pool;
  let base = process.env.TEST_BASE_URL;
  if (!base) {
    const db = newDb();
    db.public.none(
      fs.readFileSync(__dirname + "/../backend/schema.sql", "utf8"),
    );
    const { Pool } = db.adapters.createPg();
    pool = new Pool();
    const app = createApp({
      pool,
      origin: "http://127.0.0.1:3100",
      infer: async () => ({
        detecciones: [{ clase: "Camisa", puntuacion: 0.8, caja: [0, 0, 1, 1] }],
        ancho: 1,
        alto: 1,
        segundos: 0.1,
        vista: "data:image/jpeg;base64," + png.toString("base64"),
      }),
    });
    server = app.listen(3100, "127.0.0.1");
    await new Promise((r) => server.once("listening", r));
    base = "http://127.0.0.1:3100";
  }
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    args: ["--no-sandbox"],
  });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(base);
    await page.locator("#auth").waitFor({ state: "visible" });
    await page.locator("#nombre").fill("Prueba integración");
    await page.locator("#correo").fill(`prueba-${Date.now()}@example.com`);
    await page.locator("#clave").fill("Prueba-segura-12345");
    await page.locator("#registro").click();
    await page.locator("#herramienta").waitFor({ state: "visible" });
    const response = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/analyses") && r.request().method() === "POST",
      { timeout: 240000 },
    );
    if (process.env.TEST_IMAGE)
      await page.locator("#archivo").setInputFiles(process.env.TEST_IMAGE);
    else
      await page
        .locator("#archivo")
        .setInputFiles({
          name: "foto.png",
          mimeType: "image/png",
          buffer: png,
        });
    const r = await response;
    assert.equal(r.status(), 201, await r.text());
    await page.locator("#descargar:enabled").waitFor({ timeout: 10000 });
    await page.waitForFunction(() =>
      document.getElementById("listaHistorial").textContent.includes("·"),
    );
    const detectionCount = await page.locator("#resultados li").count();
    if (!process.env.TEST_BASE_URL) assert.equal(detectionCount, 1);
    for (const width of [320, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
        `Overflow at ${width}`,
      );
    }
    if (process.env.SCREENSHOT_PATH)
      await page.screenshot({
        path: process.env.SCREENSHOT_PATH,
        fullPage: true,
      });
    await page.reload();
    await page.locator("#herramienta").waitFor({ state: "visible" });
    await page.waitForFunction(() =>
      document.getElementById("listaHistorial").textContent.includes("·"),
    );
    await page.locator("#salir").click();
    await page.locator("#auth").waitFor({ state: "visible" });
    assert.equal(await page.locator("#herramienta").isVisible(), false);
    assert.deepEqual(errors, []);
    console.log(
      `Browser OK: registration, inference (${detectionCount} detections), history, reload, responsive widths, logout; no JS exceptions.`,
    );
  } finally {
    await browser.close();
    if (server) await new Promise((r) => server.close(r));
    if (pool) await pool.end();
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
