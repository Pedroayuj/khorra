import { Router } from "express";
import bcrypt from "bcryptjs";
import { rateLimit } from "express-rate-limit";
import { pool } from "../db.js";
import {
  COOKIE_NAME,
  cookieOptions,
  createToken
} from "../auth.js";
import { requireAuth } from "../middleware/requireAuth.js";

const router = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: {
    error: "Muitas tentativas. Aguarde alguns minutos."
  }
});

router.post("/login", loginLimiter, async (req, res) => {
  try {
    const email =
      typeof req.body?.email === "string"
        ? req.body.email.trim().toLowerCase()
        : "";

    const senha =
      typeof req.body?.senha === "string"
        ? req.body.senha
        : "";

    if (
      email.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      senha.length === 0 ||
      senha.length > 72
    ) {
      return res.status(400).json({
        error: "Informe um e-mail e uma senha válidos."
      });
    }

    const result = await pool.query(
      `SELECT id, username, email, password_hash
       FROM users
       WHERE email = $1`,
      [email]
    );

    const user = result.rows[0];

    // Evita revelar se o e-mail existe.
    const validPassword = user
      ? await bcrypt.compare(senha, user.password_hash)
      : await bcrypt.compare(
          senha,
          "$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy"
        ).catch(() => false);

    if (!user || !validPassword) {
      return res.status(401).json({
        error: "E-mail ou senha incorretos."
      });
    }

    const token = createToken(user);

    res.cookie(COOKIE_NAME, token, cookieOptions);

    return res.json({
      user: {
        id: String(user.id),
        username: user.username,
        email: user.email
      }
    });
  } catch (error) {
    console.error("Erro no login:", error);

    return res.status(500).json({
      error: "Não foi possível realizar o login."
    });
  }
});

router.get("/me", requireAuth, (req, res) => {
  res.json({ user: req.user });
});

router.post("/logout", (_req, res) => {
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/"
  });

  res.json({ ok: true });
});

export default router;
