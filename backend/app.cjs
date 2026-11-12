const express = require("express");
const multer = require("multer");
const { rateLimit } = require("express-rate-limit");
const { randomBytes, createHash } = require("node:crypto");
const path = require("node:path");
const { hashPassword, verifyPassword } = require("./password.cjs");
const digest = (token) => createHash("sha256").update(token).digest("hex");
const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email });

function createApp({
  pool,
  infer,
  secure = false,
  origin = "http://localhost:3000",
}) {
  const app = express();
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    res.set({
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "same-origin",
      "Content-Security-Policy":
        "default-src 'self'; img-src 'self' data: blob:; style-src 'self'; script-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    });
    if (req.path.startsWith("/api")) res.set("Cache-Control", "no-store");
    if (
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      req.headers.origin &&
      req.headers.origin !== origin
    )
      return res.status(403).json({ error: "Origen no permitido." });
    next();
  });
  app.use(express.json({ limit: "16kb" }));
  const authLimit = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 30,
    standardHeaders: "draft-8",
    legacyHeaders: false,
  });
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 14 * 1024 * 1024, files: 1, fields: 1, fieldSize: 32 },
  });
  const cookie = (res, token, age = 86400) =>
    res.set(
      "Set-Cookie",
      `session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}${secure ? "; Secure" : ""}`,
    );
  async function session(req, res, next) {
    const token = req.headers.cookie?.match(
      /(?:^|;\s*)session=([a-f0-9]{64})(?:;|$)/,
    )?.[1];
    if (!token)
      return res.status(401).json({ error: "Inicia sesión para continuar." });
    const rows = await pool.query(
      "SELECT users.id, users.name, users.email FROM sessions JOIN users ON users.id=sessions.user_id WHERE token=$1 AND expires_at>NOW()",
      [digest(token)],
    );
    if (!rows.rows[0])
      return res.status(401).json({ error: "La sesión expiró." });
    req.user = rows.rows[0];
    req.sessionToken = digest(token);
    next();
  }
  async function signIn(res, user, status = 200) {
    const token = randomBytes(32).toString("hex");
    await pool.query("DELETE FROM sessions WHERE expires_at < NOW()");
    await pool.query(
      "INSERT INTO sessions(token,user_id,expires_at) VALUES($1,$2,$3)",
      [digest(token), user.id, new Date(Date.now() + 86400000)],
    );
    cookie(res, token);
    res.status(status).json({ user: publicUser(user) });
  }
  app.post("/api/register", authLimit, async (req, res) => {
    const { name, email, password } = req.body || {};
    if (
      typeof name !== "string" ||
      !name.trim() ||
      name.length > 100 ||
      typeof email !== "string" ||
      email.length > 150 ||
      !/^\S+@\S+\.\S+$/.test(email) ||
      typeof password !== "string" ||
      password.length < 12 ||
      password.length > 128
    )
      return res
        .status(400)
        .json({
          error:
            "Indica nombre, correo válido y contraseña de 12 a 128 caracteres.",
        });
    try {
      const r = await pool.query(
        "INSERT INTO users(name,email,password) VALUES($1,$2,$3) RETURNING id,name,email",
        [name.trim(), email.trim().toLowerCase(), hashPassword(password)],
      );
      await signIn(res, r.rows[0], 201);
    } catch (e) {
      if (e.code === "23505")
        return res
          .status(409)
          .json({ error: "Este correo ya está registrado." });
      throw e;
    }
  });
  app.post("/api/login", authLimit, async (req, res) => {
    const { email, password } = req.body || {};
    if (
      typeof email !== "string" ||
      typeof password !== "string" ||
      password.length > 128
    )
      return res.status(400).json({ error: "Indica correo y contraseña." });
    const r = await pool.query("SELECT * FROM users WHERE email=$1", [
      email.trim().toLowerCase(),
    ]);
    if (!r.rows[0] || !verifyPassword(password, r.rows[0].password))
      return res.status(401).json({ error: "Credenciales incorrectas." });
    await signIn(res, r.rows[0]);
  });
  app.get("/api/me", session, (req, res) =>
    res.json({ user: publicUser(req.user) }),
  );
  app.post("/api/logout", session, async (req, res) => {
    await pool.query("DELETE FROM sessions WHERE token=$1", [req.sessionToken]);
    cookie(res, "", 0);
    res.sendStatus(204);
  });
  app.get("/api/health", async (req, res) => {
    await pool.query("SELECT 1");
    res.json({ status: "ok" });
  });
  app.get("/api/analyses", session, async (req, res) => {
    const page = Number(req.query.page || 1);
    if (!Number.isSafeInteger(page) || page < 1 || page > 100000)
      return res.status(400).json({ error: "Página inválida." });
    const r = await pool.query(
      "SELECT id,filename,result,created_at FROM analyses WHERE user_id=$1 ORDER BY id DESC LIMIT 20 OFFSET $2",
      [req.user.id, (page - 1) * 20],
    );
    res.json({ data: r.rows, page, pageSize: 20 });
  });
  app.post(
    "/api/analyses",
    session,
    rateLimit({ windowMs: 60000, limit: 10 }),
    upload.single("imagen"),
    async (req, res) => {
      const threshold = Number(req.body?.umbral ?? 0.15);
      if (
        !req.file ||
        !Number.isFinite(threshold) ||
        threshold < 0.01 ||
        threshold > 0.9
      )
        return res
          .status(400)
          .json({
            error: "Selecciona una imagen y un umbral entre 0.01 y 0.9.",
          });
      let result;
      try {
        result = await infer(req.file, threshold);
        if (
          !result ||
          !Array.isArray(result.detecciones) ||
          result.detecciones.length > 40 ||
          !Number.isFinite(result.segundos) ||
          !Number.isInteger(result.ancho) ||
          result.ancho < 1 ||
          !Number.isInteger(result.alto) ||
          result.alto < 1 ||
          typeof result.vista !== "string" ||
          !result.vista.startsWith("data:image/jpeg;base64,") ||
          result.detecciones.some(
            (d) =>
              typeof d.clase !== "string" ||
              !Number.isFinite(d.puntuacion) ||
              !Array.isArray(d.caja) ||
              d.caja.length !== 4 ||
              d.caja.some((v) => !Number.isFinite(v) || v < 0 || v > 1),
          )
        )
          throw new Error("Invalid detector response");
      } catch (e) {
        return res
          .status(e.status === 400 || e.status === 413 ? e.status : 503)
          .json({
            error:
              e.status === 400
                ? "La imagen no es válida. Usa JPEG, PNG o WebP de hasta 20 megapíxeles."
                : "No se pudo analizar. Comprueba que el servicio neuronal esté listo e inténtalo de nuevo.",
          });
      }
      const { vista, ...metadata } = result;
      const r = await pool.query(
        "INSERT INTO analyses(user_id,filename,result) VALUES($1,$2,$3) RETURNING id",
        [
          req.user.id,
          path.basename(req.file.originalname).slice(0, 255),
          metadata,
        ],
      );
      res.status(201).json({ ...result, id: r.rows[0].id });
    },
  );
  app.use("/api", (req, res) =>
    res.status(404).json({ error: "Ruta no encontrada." }),
  );
  app.use(express.static(path.join(__dirname, "../frontend")));
  app.use((err, req, res, next) => {
    const status =
      err instanceof multer.MulterError
        ? err.code === "LIMIT_FILE_SIZE"
          ? 413
          : 400
        : err.status === 400
          ? 400
          : 500;
    if (status === 500) console.error(err.message);
    res
      .status(status)
      .json({
        error:
          status === 413
            ? "La imagen supera los 14 MB."
            : status === 400
              ? "Solicitud inválida."
              : "No se pudo completar la operación.",
      });
  });
  return app;
}
module.exports = { createApp };
