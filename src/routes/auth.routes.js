
import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth.js";
import bcrypt from "bcryptjs";
import { rateLimit } from "express-rate-limit";
import { pool } from "../db.js";

import {
  COOKIE_NAME,
  cookieOptions,
  createToken
} from "../auth.js";

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

// VERIFICAR SESSÃO
router.get("/me", requireAuth, async (req, res) => {
  return res.json({
    user: req.user
  });
});

// LOGIN
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
      Buffer.byteLength(senha, "utf8") > 72
    ) {
      return res.status(400).json({
        error: "Informe um e-mail e uma senha válidos."
      });
    }

    const result = await pool.query(
      `SELECT id, username, email, password_hash, avatar_url
       FROM users
       WHERE email = $1`,
      [email]
    );

    const user = result.rows[0];

    if (!user) {
      return res.status(401).json({
        error: "E-mail ou senha incorretos."
      });
    }

    const validPassword = await bcrypt.compare(
      senha,
      user.password_hash
    );

    if (!validPassword) {
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
        email: user.email,
        avatar_url: user.avatar_url || null
      }
    });

  } catch (error) {
    console.error("Erro no login:", error);

    return res.status(500).json({
      error: "Não foi possível realizar o login."
    });
  }
});

// LOGOUT
router.post("/logout", (_req, res) => {
  const {
    maxAge,
    expires,
    ...clearOptions
  } = cookieOptions;

  res.clearCookie(COOKIE_NAME, clearOptions);

  return res.json({
    ok: true
  });
});

// CADASTRO
router.post("/register", loginLimiter, async (req, res) => {
  const client = await pool.connect();

  try {
    const username =
      typeof req.body?.username === "string"
        ? req.body.username.trim()
        : "";

    const email =
      typeof req.body?.email === "string"
        ? req.body.email.trim().toLowerCase()
        : "";

    const senha =
      typeof req.body?.senha === "string"
        ? req.body.senha
        : "";

    if (!/^[a-zA-Z0-9_-]{5,12}$/.test(username)) {
      return res.status(400).json({
        error: "O nome deve ter de 5 a 12 caracteres."
      });
    }

    if (
      email.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    ) {
      return res.status(400).json({
        error: "Informe um e-mail válido."
      });
    }

    if (
      senha.length < 10 ||
      Buffer.byteLength(senha, "utf8") > 72
    ) {
      return res.status(400).json({
        error: "A senha deve ter pelo menos 10 caracteres e no máximo 72 bytes."
      });
    }

    const passwordHash = await bcrypt.hash(senha, 12);

    await client.query("BEGIN");

    const result = await client.query(
      `INSERT INTO users (username, email, password_hash)
       VALUES ($1, $2, $3)
       RETURNING id, username, email, avatar_url`,
      [username, email, passwordHash]
    );

    const user = result.rows[0];

    // Atribuir o cargo padrão somente depois de criar o usuário.
    const roleResult = await client.query(
      `INSERT INTO user_roles (server_id, user_id, role_id)
       SELECT server_id, $1, id
       FROM roles
       WHERE server_id = 1
       AND name = 'Membro'
       ON CONFLICT DO NOTHING
       RETURNING role_id`,
      [user.id]
    );

if (roleResult.rowCount === 0) {
  throw new Error("Não foi possível atribuir o cargo Membro.");
}

    await client.query("COMMIT");

    const token = createToken(user);

    res.cookie(COOKIE_NAME, token, cookieOptions);

    return res.status(201).json({
      user: {
        id: String(user.id),
        username: user.username,
        email: user.email,
        avatar_url: user.avatar_url || null
      }
    });

  } catch (error) {
    await client.query("ROLLBACK");

    if (error.code === "23505") {
      return res.status(409).json({
        error: "Esse nome de usuário ou e-mail já está cadastrado."
      });
    }

    console.error("Erro no cadastro:", error);

    return res.status(500).json({
      error: "Não foi possível criar a conta."
    });

  } finally {
    client.release();
  }
});

export default router;
