
import {
  COOKIE_NAME,
  cookieOptions,
  verifyToken
} from "../auth.js";

import { pool } from "../db.js";

export async function requireAuth(req, res, next) {
  try {
    console.log("========== AUTH DEBUG ==========");
    console.log("Origin:", req.headers.origin);
    console.log("Cookie header recebido:", Boolean(req.headers.cookie));
    console.log("Cookies interpretados:", Object.keys(req.cookies || {}));
    console.log("Token encontrado:", Boolean(req.cookies?.[COOKIE_NAME]));

    const token = req.cookies?.[COOKIE_NAME];

    if (!token) {
      console.log("AUTH FALHOU: COOKIE AUSENTE");

      return res.status(401).json({
        error: "Você precisa entrar na sua conta."
      });
    }

    const payload = verifyToken(token);

    console.log("JWT válido:", Boolean(payload?.sub));

    const result = await pool.query(
      `SELECT id, username, email
       FROM users
       WHERE id = $1`,
      [payload.sub]
    );

    if (result.rowCount === 0) {
      res.clearCookie(COOKIE_NAME, cookieOptions);

      return res.status(401).json({
        error: "Conta não encontrada."
      });
    }

    req.user = result.rows[0];

    console.log("AUTH SUCESSO:", req.user.username);
    console.log("================================");

    return next();

  } catch (error) {
    console.error("ERRO AUTH:", error.message);

    res.clearCookie(COOKIE_NAME, cookieOptions);

    return res.status(401).json({
      error: "Sessão inválida ou expirada. Entre novamente."
    });
  }
}
