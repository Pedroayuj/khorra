
import { Router } from "express";
import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import { randomUUID } from "node:crypto";

import { pool } from "../db.js";
import { requireAuth } from "../middleware/requireAuth.js";

const router = Router();

const ALLOWED_STATUSES = [
  "online",
  "ausente",
  "ocupado",
  "invisivel"
];

const uploadDir = path.resolve("src/uploads/avatars");

fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, callback) => {
    callback(null, uploadDir);
  },

  filename: (_req, file, callback) => {
    const extension = path.extname(file.originalname).toLowerCase();
    callback(null, `${randomUUID()}${extension}`);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 3 * 1024 * 1024
  },
  fileFilter: (_req, file, callback) => {
    const allowed = [
      "image/jpeg",
      "image/png",
      "image/webp"
    ];

    if (!allowed.includes(file.mimetype)) {
      return callback(
        new Error("Formato de imagem não permitido.")
      );
    }

    callback(null, true);
  }
});

// ==========================================
// VISUALIZAR PERFIL
// ==========================================

router.get("/:userId", requireAuth, async (req, res) => {
  try {
    const userId = req.params.userId;

    if (!/^\d+$/.test(userId)) {
      return res.status(400).json({
        error: "ID de usuário inválido."
      });
    }

    const result = await pool.query(
      `SELECT id, username, avatar_url, bio
       FROM users
       WHERE id = $1`,
      [userId]
    );

    if (!result.rowCount) {
      return res.status(404).json({
        error: "Usuário não encontrado."
      });
    }

    const user = result.rows[0];

    return res.json({
      user: {
        id: String(user.id),
        username: user.username,
        avatar_url: user.avatar_url || null,
        bio: user.bio || "",
        status: "online"
      }
    });

  } catch (error) {
    console.error("Erro ao buscar perfil:", error);

    return res.status(500).json({
      error: "Não foi possível carregar o perfil."
    });
  }
});

// ==========================================
// ATUALIZAR STATUS
// ==========================================

router.patch("/status", requireAuth, async (req, res) => {
  try {
    const status = String(req.body.status || "");

    if (!ALLOWED_STATUSES.includes(status)) {
      return res.status(400).json({
        error: "Status inválido."
      });
    }

    const result = await pool.query(
      `UPDATE users
       SET status = $1
       WHERE id = $2
       RETURNING id, username, avatar_url, status`,
      [status, req.user.id]
    );

    if (!result.rowCount) {
      return res.status(404).json({
        error: "Usuário não encontrado."
      });
    }

    const user = {
      ...result.rows[0],
      id: String(result.rows[0].id)
    };

    return res.json({
      ok: true,
      user
    });

  } catch (error) {
    console.error("ERRO COMPLETO AO ATUALIZAR PERFIL:", {
      message: error.message,
      code: error.code,
      detail: error.detail,
      constraint: error.constraint,
      table: error.table,
      column: error.column
    });

    return res.status(500).json({
      error: "Não foi possível atualizar o status."
    });
  }
});

// ==========================================
// ATUALIZAR PRÓPRIO PERFIL
// ==========================================

router.patch(
  "/",
  requireAuth,
  (req, res, next) => {
    upload.single("avatar")(req, res, error => {
      if (error) {
        return res.status(400).json({
          error: error.message
        });
      }

      next();
    });
  },
  async (req, res) => {
    try {
      const username = String(
        req.body.username || ""
      ).trim();

      const bio = String(
        req.body.bio || ""
      ).trim();

      if (username.length < 3 || username.length > 24) {
        return res.status(400).json({
          error: "O nome deve ter entre 3 e 24 caracteres."
        });
      }

      if (!/^[a-zA-Z0-9_.-]+$/.test(username)) {
        return res.status(400).json({
          error: "Nome de usuário inválido."
        });
      }

      if (bio.length > 190) {
        return res.status(400).json({
          error: "A biografia deve ter no máximo 190 caracteres."
        });
      }

      const avatarUrl = req.file
        ? `/uploads/avatars/${req.file.filename}`
        : null;

      const result = await pool.query(
        `UPDATE users
         SET username = $1,
             bio = $2,
             avatar_url = COALESCE($3, avatar_url)
         WHERE id = $4
         RETURNING id, username, email, avatar_url, bio, status`,
        [
          username,
          bio,
          avatarUrl,
          req.user.id
        ]
      );

      if (!result.rowCount) {
        return res.status(404).json({
          error: "Usuário não encontrado."
        });
      }

      return res.json({
        ok: true,
        user: {
          ...result.rows[0],
          id: String(result.rows[0].id)
        }
      });

    } catch (error) {
      if (error.code === "23505") {
        return res.status(409).json({
          error: "Esse nome já está sendo utilizado."
        });
      }

      console.error("Erro ao atualizar perfil:", error);

      return res.status(500).json({
        error: "Não foi possível atualizar o perfil."
      });
    }
  }
);

export default router;
