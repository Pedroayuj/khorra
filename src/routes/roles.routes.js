
import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth.js";
import { pool } from "../db.js";

import {
  canManageRole
} from "../middleware/roleHierarchy.js";

const router = Router();

// ==========================================
// CONSULTAR CARGO DO USUÁRIO LOGADO
// ==========================================

router.get(
  "/servers/:serverId/me",
  requireAuth,
  async (req, res) => {
    try {
      const { serverId } = req.params;

      if (!/^\d+$/.test(serverId)) {
        return res.status(400).json({
          error: "Identificador de comunidade inválido."
        });
      }

      const result = await pool.query(
        `SELECT
            r.id,
            r.name,
            r.position,
            r.is_owner,
            r.permissions
         FROM user_roles ur
         JOIN roles r ON r.id = ur.role_id
         WHERE ur.user_id = $1
           AND ur.server_id = $2
           AND r.server_id = $2`,
        [req.user.id, serverId]
      );

      const role = result.rows[0];

      if (!role) {
        return res.status(404).json({
          error: "Você ainda não possui um cargo nesta comunidade."
        });
      }

      return res.json({
        role: {
          id: role.id,
          name: role.name,
          position: role.position,
          is_owner: role.is_owner,
          permissions: role.permissions
        }
      });

    } catch (error) {
      console.error("Erro ao consultar cargo:", error);

      return res.status(500).json({
        error: "Não foi possível consultar seu cargo."
      });
    }
  }
);

// ==========================================
// CONSULTAR CARGO DE UM MEMBRO NO SERVIDOR
// ==========================================

router.get(
  "/servers/:serverId/members/:userId/role",
  requireAuth,
  async (req, res) => {
    try {
      const { serverId, userId } = req.params;

      if (
        !/^\d+$/.test(serverId) ||
        !/^\d+$/.test(userId)
      ) {
        return res.status(400).json({
          error: "Identificador inválido."
        });
      }

      const result = await pool.query(
        `SELECT
            r.id,
            r.name,
            r.position,
            r.is_owner
         FROM user_roles ur
         JOIN roles r ON r.id = ur.role_id
         WHERE ur.server_id = $1
           AND ur.user_id = $2
           AND r.server_id = $1`,
        [serverId, userId]
      );

      const role = result.rows[0];

      return res.json({
        role: role || null
      });

    } catch (error) {
      console.error(
        "Erro ao consultar cargo do membro:",
        error
      );

      return res.status(500).json({
        error: "Não foi possível consultar o cargo."
      });
    }
  }
);

// ==========================================
// ALTERAR CARGO DE UM MEMBRO
// ==========================================

router.patch(
  "/servers/:serverId/members/:userId/role",
  requireAuth,
  async (req, res) => {

    const client = await pool.connect();
    let transactionStarted = false;

    try {
      const serverId = String(req.params.serverId);
      const actorId = String(req.user.id);
      const targetId = String(req.params.userId);
      const roleId = req.body?.roleId;

      // ======================================
      // VALIDAR IDENTIFICADORES
      // ======================================

      if (
        !/^\d+$/.test(serverId) ||
        !/^\d+$/.test(targetId) ||
        !/^\d+$/.test(String(roleId ?? ""))
      ) {
        return res.status(400).json({
          error: "Identificador inválido."
        });
      }

      if (actorId === targetId) {
        return res.status(403).json({
          error: "Você não pode alterar seu próprio cargo."
        });
      }

      await client.query("BEGIN");
      transactionStarted = true;

      // ======================================
      // VERIFICAR SE A COMUNIDADE EXISTE
      // ======================================

      const serverResult = await client.query(
        `SELECT id
         FROM servers
         WHERE id = $1
         FOR SHARE`,
        [serverId]
      );

      if (!serverResult.rows[0]) {
        await client.query("ROLLBACK");
        transactionStarted = false;

        return res.status(404).json({
          error: "Comunidade não encontrada."
        });
      }

      // ======================================
      // BUSCAR CARGOS DOS USUÁRIOS
      // ======================================

      const membersResult = await client.query(
        `SELECT
            u.id AS user_id,
            r.id AS role_id,
            r.name,
            r.position,
            r.is_owner,
            r.permissions
         FROM user_roles ur
         JOIN users u ON u.id = ur.user_id
         JOIN roles r ON r.id = ur.role_id
         WHERE ur.user_id IN ($1, $2)
           AND ur.server_id = $3
           AND r.server_id = $3
         ORDER BY ur.user_id
         FOR UPDATE OF ur`,
        [actorId, targetId, serverId]
      );

      const actor = membersResult.rows.find(
        row => String(row.user_id) === actorId
      );

      const target = membersResult.rows.find(
        row => String(row.user_id) === targetId
      );

      // ======================================
      // VERIFICAR CARGO DO AUTOR
      // ======================================

      if (!actor) {
        await client.query("ROLLBACK");
        transactionStarted = false;

        return res.status(403).json({
          error: "Você não possui um cargo válido nesta comunidade."
        });
      }

      // ======================================
      // VERIFICAR PERMISSÃO
      // ======================================

      if (
        !actor.is_owner &&
        actor.permissions?.manage_roles !== true
      ) {
        await client.query("ROLLBACK");
        transactionStarted = false;

        return res.status(403).json({
          error: "Você não possui permissão para gerenciar cargos."
        });
      }

      // ======================================
      // VERIFICAR MEMBRO ALVO
      // ======================================

      if (!target) {
        await client.query("ROLLBACK");
        transactionStarted = false;

        return res.status(404).json({
          error: "Usuário não encontrado ou sem cargo nesta comunidade."
        });
      }

      // ======================================
      // BUSCAR NOVO CARGO
      // ======================================

      const newRoleResult = await client.query(
        `SELECT
            id,
            name,
            position,
            is_owner,
            permissions
         FROM roles
         WHERE id = $1
           AND server_id = $2
         FOR SHARE`,
        [roleId, serverId]
      );

      const newRole = newRoleResult.rows[0];

      if (!newRole) {
        await client.query("ROLLBACK");
        transactionStarted = false;

        return res.status(404).json({
          error: "Cargo não encontrado nesta comunidade."
        });
      }

      // ======================================
      // VALIDAR HIERARQUIA
      // ======================================

      if (!canManageRole(actor, target, newRole)) {
        await client.query("ROLLBACK");
        transactionStarted = false;

        return res.status(403).json({
          error: "Você não possui hierarquia suficiente para alterar este cargo."
        });
      }

      // ======================================
      // ATUALIZAR CARGO
      // ======================================

      const updateResult = await client.query(
        `UPDATE user_roles
         SET role_id = $1,
             assigned_at = NOW()
         WHERE user_id = $2
           AND server_id = $3
         RETURNING user_id`,
        [newRole.id, targetId, serverId]
      );

      if (updateResult.rowCount === 0) {
        await client.query("ROLLBACK");
        transactionStarted = false;

        return res.status(404).json({
          error: "Não foi possível atualizar o cargo do membro."
        });
      }

      await client.query("COMMIT");
      transactionStarted = false;

      return res.json({
        ok: true,
        message: "Cargo atualizado com sucesso.",
        member: {
          userId: targetId,
          serverId: serverId,
          role: {
            id: newRole.id,
            name: newRole.name,
            position: newRole.position
          }
        }
      });

    } catch (error) {

      if (transactionStarted) {
        await client.query("ROLLBACK");
      }

      console.error("Erro ao alterar cargo:", error);

      return res.status(500).json({
        error: "Não foi possível alterar o cargo."
      });

    } finally {
      client.release();
    }
  }
);

export default router;
