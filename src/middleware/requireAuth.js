import { COOKIE_NAME, verifyToken } from "../auth.js";
import { pool } from "../db.js";

export async function requireAuth(req, res, next) {
  try {
    const token = req.cookies?.[COOKIE_NAME];

    if (!token) {
      return res.status(401).json({
        error: "Você precisa entrar na sua conta."
      });
    }

    const payload = verifyToken(token);

    const result = await pool.query(
      `SELECT id, username, email
       FROM users
       WHERE id = $1`,
      [payload.sub]
    );

    if (result.rowCount === 0) {
      res.clearCookie(COOKIE_NAME, { path: "/" });

      return res.status(401).json({
        error: "Conta não encontrada."
      });
    }

    req.user = result.rows[0];
    next();
  } catch {
    res.clearCookie(COOKIE_NAME, { path: "/" });

    return res.status(401).json({
      error: "Sessão inválida ou expirada. Entre novamente."
    });
  }
}
