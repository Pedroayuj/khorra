
export function registerChatEvents(io, socket, pool) {
  const user = socket.data.user;
  const userId = String(user.id);

  socket.data.textChannelId = null;

  // ========================================
  // LISTAR CANAIS DISPONÍVEIS
  // ========================================

  socket.on("channels:list", async callback => {
    try {
      const result = await pool.query(
        `SELECT DISTINCT
            c.id,
            c.name,
            c.type,
            c.server_id AS "serverId"
         FROM channels c
         INNER JOIN user_roles ur
           ON ur.server_id = c.server_id
          AND ur.user_id = $1
         ORDER BY c.id ASC`,
        [userId]
      );

      callback?.({
        ok: true,
        channels: result.rows
      });

    } catch (error) {
      console.error("Erro ao carregar canais:", error);

      callback?.({
        ok: false,
        error: "Não foi possível carregar os canais."
      });
    }
  });

  // ========================================
  // ENTRAR NO CANAL
  // ========================================

  socket.on("channel:join", async (payload, callback) => {
    try {
      const channelId = String(
        typeof payload === "string"
          ? payload
          : payload?.channelId ?? ""
      );

      if (!channelId || channelId.length > 100) {
        return callback?.({
          ok: false,
          error: "Canal inválido."
        });
      }

      const channelResult = await pool.query(
        `SELECT c.id, c.name, c.type
         FROM channels c
         INNER JOIN user_roles ur
           ON ur.server_id = c.server_id
          AND ur.user_id = $1
         WHERE c.id = $2
           AND c.type = 'text'
         LIMIT 1`,
        [userId, channelId]
      );

      const channel = channelResult.rows[0];

      if (!channel) {
        return callback?.({
          ok: false,
          error: "Canal não encontrado ou sem permissão."
        });
      }

      // Carregar mensagens e anexos.
      const messagesResult = await pool.query(
        `SELECT
            m.id,
            m.channel_id AS "channelId",
            m.user_id AS "userId",
            u.username,
            u.avatar_url,
            m.content,
            m.attachments,
            m.created_at AS "createdAt"
         FROM messages m
         JOIN users u ON u.id = m.user_id
         WHERE m.channel_id = $1
         ORDER BY m.created_at DESC
         LIMIT 50`,
        [channelId]
      );

      const messages = messagesResult.rows.reverse();

      const previousChannel = socket.data.textChannelId;

      if (previousChannel && previousChannel !== channelId) {
        await socket.leave(`channel:${previousChannel}`);
      }

      await socket.join(`channel:${channelId}`);

      socket.data.textChannelId = channelId;

      console.log("ENTROU NO CANAL DE TEXTO:", {
        username: user.username,
        channelId
      });

      return callback?.({
        ok: true,
        channel,
        messages
      });

    } catch (error) {
      console.error("Erro ao entrar no canal:", error);

      callback?.({
        ok: false,
        error: "Não foi possível entrar no canal."
      });
    }
  });

  // ========================================
  // SAIR DO CANAL
  // ========================================

  socket.on("channel:leave", async callback => {
    try {
      const channelId = socket.data.textChannelId;

      if (channelId) {
        await socket.leave(`channel:${channelId}`);
        socket.data.textChannelId = null;
      }

      callback?.({ ok: true });

    } catch (error) {
      console.error("Erro ao sair do canal:", error);

      callback?.({
        ok: false,
        error: "Não foi possível sair do canal."
      });
    }
  });

  // ========================================
  // ENVIAR MENSAGEM E ANEXOS
  // ========================================

  socket.on("message:send", async (payload, callback) => {
    try {
      const channelId = String(payload?.channelId ?? "");
      const content = String(payload?.content ?? "").trim();

      const attachments = Array.isArray(payload?.attachments)
        ? payload.attachments
        : [];

      if (!channelId || channelId.length > 100) {
        return callback?.({
          ok: false,
          error: "Canal inválido."
        });
      }

      if (!content && attachments.length === 0) {
        return callback?.({
          ok: false,
          error: "Digite uma mensagem ou anexe um arquivo."
        });
      }

      if (content.length > 2000) {
        return callback?.({
          ok: false,
          error: "A mensagem ultrapassa o limite de 2000 caracteres."
        });
      }

      if (attachments.length > 4) {
        return callback?.({
          ok: false,
          error: "Limite de 4 anexos por mensagem."
        });
      }

      if (channelId !== socket.data.textChannelId) {
        return callback?.({
          ok: false,
          error: "Entre no canal antes de enviar mensagens."
        });
      }

      // Validar permissão.
      const channelResult = await pool.query(
        `SELECT c.id
         FROM channels c
         INNER JOIN user_roles ur
           ON ur.server_id = c.server_id
          AND ur.user_id = $1
         WHERE c.id = $2
           AND c.type = 'text'
         LIMIT 1`,
        [userId, channelId]
      );

      if (!channelResult.rowCount) {
        return callback?.({
          ok: false,
          error: "Você não tem permissão para enviar mensagens neste canal."
        });
      }


// ========================================
// VALIDAR ANEXOS
// ========================================

for (const attachment of attachments) {
  if (
    !attachment ||
    typeof attachment !== "object" ||
    typeof attachment.url !== "string" ||
    !attachment.url.startsWith("/uploads/chat/") ||
    !["image", "video"].includes(attachment.type)
  ) {
    return callback?.({
      ok: false,
      error: "Anexo inválido."
    });
  }
}


      // Validar formato básico dos anexos.
      for (const attachment of attachments) {
        if (
          !attachment ||
          typeof attachment !== "object" ||
          typeof attachment.url !== "string" ||
          !attachment.url.startsWith("/uploads/")
        ) {
          return callback?.({
            ok: false,
            error: "Anexo inválido."
          });
        }
      }

      // Compatibilidade com tabelas que exigem conteúdo não vazio.
      const messageContent = content || " ";

      // Salvar mensagem e anexos.
      const insertResult = await pool.query(
        `INSERT INTO messages
            (channel_id, user_id, content, attachments)
         VALUES ($1, $2, $3, $4)
         RETURNING
           id,
           channel_id AS "channelId",
           user_id AS "userId",
           content,
           attachments,
           created_at AS "createdAt"`,
  [channelId, userId, content, JSON.stringify(attachments)]
);

      const insertedMessage = insertResult.rows[0];

      const message = {
        ...insertedMessage,
        username: user.username,
        avatar_url: user.avatar_url || null
      };

      // Atualizar todos os participantes do canal.
      io.to(`channel:${channelId}`).emit(
        "message:new",
        message
      );

      console.log("MENSAGEM ENVIADA:", {
        username: user.username,
        channelId,
        messageId: message.id,
        attachments: attachments.length
      });

      return callback?.({
        ok: true,
        message
      });

    } catch (error) {
      console.error("ERRO REAL AO ENVIAR MENSAGEM:", {
        message: error.message,
        code: error.code,
        detail: error.detail,
        constraint: error.constraint
      });

      return callback?.({
        ok: false,
        error: "Não foi possível enviar a mensagem."
      });
    }
  });


  // ========================================
  // EDITAR MENSAGEM
  // ========================================

  socket.on("message:edit", async (payload, callback) => {
    try {
      const messageId = payload?.messageId;
      const content = String(payload?.content ?? "").trim();
      const channelId = socket.data.textChannelId;

      if (!messageId || !channelId) {
        return callback?.({
          ok: false,
          error: "Mensagem ou canal inválido."
        });
      }

      if (!content || content.length > 2000) {
        return callback?.({
          ok: false,
          error: "A mensagem deve ter entre 1 e 2000 caracteres."
        });
      }

      // Atualizar somente mensagens do próprio usuário.
      const result = await pool.query(
        `UPDATE messages m
         SET content = $1,
             edited_at = NOW()
         WHERE m.id = $2
           AND m.user_id = $3
           AND m.channel_id = $4
           AND EXISTS (
             SELECT 1
             FROM channels c
             INNER JOIN user_roles ur
               ON ur.server_id = c.server_id
             WHERE c.id = m.channel_id
               AND c.type = 'text'
               AND ur.user_id = $3
           )
         RETURNING
           m.id,
           m.channel_id AS "channelId",
           m.user_id AS "userId",
           m.content,
           m.attachments,
           m.created_at AS "createdAt",
           m.edited_at AS "editedAt"`,
        [content, messageId, userId, channelId]
      );

      if (!result.rowCount) {
        return callback?.({
          ok: false,
          error: "Mensagem não encontrada ou você não tem permissão para editá-la."
        });
      }

      const updatedMessage = {
        ...result.rows[0],
        username: user.username,
        avatar_url: user.avatar_url || null
      };

      // Avisar todos os usuários do canal.
      io.to(`channel:${channelId}`).emit(
        "message:updated",
        updatedMessage
      );

      callback?.({
        ok: true,
        message: updatedMessage
      });

    } catch (error) {
      console.error("ERRO AO EDITAR MENSAGEM:", error);

      callback?.({
        ok: false,
        error: "Não foi possível editar a mensagem."
      });
    }
  });


  // ========================================
  // EXCLUIR MENSAGEM
  // ========================================

  socket.on("message:delete", async (payload, callback) => {
    try {
      const messageId = payload?.messageId;
      const channelId = socket.data.textChannelId;

      if (!messageId || !channelId) {
        return callback?.({
          ok: false,
          error: "Mensagem ou canal inválido."
        });
      }

      // Excluir somente mensagens do próprio usuário.
      const result = await pool.query(
        `DELETE FROM messages m
         WHERE m.id = $1
           AND m.user_id = $2
           AND m.channel_id = $3
           AND EXISTS (
             SELECT 1
             FROM channels c
             INNER JOIN user_roles ur
               ON ur.server_id = c.server_id
             WHERE c.id = m.channel_id
               AND c.type = 'text'
               AND ur.user_id = $2
           )
         RETURNING m.id`,
        [messageId, userId, channelId]
      );

      if (!result.rowCount) {
        return callback?.({
          ok: false,
          error: "Mensagem não encontrada ou você não tem permissão para excluí-la."
        });
      }

      // Avisar todos os usuários do canal.
      io.to(`channel:${channelId}`).emit(
        "message:deleted",
        { messageId: result.rows[0].id }
      );

      callback?.({
        ok: true
      });

    } catch (error) {
      console.error("ERRO AO EXCLUIR MENSAGEM:", error);

      callback?.({
        ok: false,
        error: "Não foi possível excluir a mensagem."
      });
    }
  });

  // ========================================
  // DESCONECTAR
  // ========================================

  socket.on("disconnect", () => {
    socket.data.textChannelId = null;
  });
}
