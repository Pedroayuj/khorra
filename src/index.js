
import "dotenv/config";

import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";

import { createServer } from "node:http";
import { Server } from "socket.io";

import { pool, checkDatabase } from "./db.js";

import { registerChatEvents } from "./socket/chat.js";

// Rotas
import authRoutes from "./routes/auth.routes.js";
import profileRoutes from "./routes/profile.routes.js";
import mediaRoutes from "./routes/media.routes.js";
import rolesRoutes from "./routes/roles.routes.js";

// Autenticação Socket.IO
import { socketAuth } from "./middleware/socketAuth.js";

// ==========================================
// CONFIGURAÇÕES
// ==========================================

const app = express();
const httpServer = createServer(app);

app.set("trust proxy", 1);

app.get("/", (_req, res) => {
  return res.status(200).json({
    name: "KHORRA API",
    status: "online",
    message: "Backend funcionando corretamente!"
  });
});

const PORT = Number(process.env.PORT || 3001);

const CLIENT_URL =
  process.env.CLIENT_URL || "http://localhost:5173";

// ==========================================
// SEGURANÇA
// ==========================================

app.disable("x-powered-by");

app.use(
  helmet({
    crossOriginResourcePolicy: {
      policy: "cross-origin"
    }
  })
);

app.use(express.json({ limit: "10kb" }));

app.use(cookieParser());

app.use(cors({
  origin: CLIENT_URL,
  credentials: true,
  methods: [
    "GET",
    "POST",
    "PUT",
    "PATCH",
    "DELETE",
    "OPTIONS"
  ],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "Accept"
  ]
}));

app.use(express.json({ limit: "10kb" }));
app.use(cookieParser());

// ==========================================
// SOCKET.IO
// ==========================================

const io = new Server(httpServer, {
  cors: {
    origin: CLIENT_URL,
    credentials: true,
    methods: ["GET", "POST"]
  }
});

io.use(socketAuth);

// ==========================================
// CANAIS DE VOZ
// ==========================================

// channelId -> Set(socketId)
const voiceRooms = new Map();

// ==========================================
// MEMBROS ONLINE
// ==========================================

// userId -> user
const onlineUsers = new Map();

// ==========================================
// VALIDAR ID DO CANAL
// ==========================================

function isValidChannelId(channelId) {
  return (
    typeof channelId === "string" &&
    /^[a-zA-Z0-9_-]{1,100}$/.test(channelId)
  );
}

// ==========================================
// BROADCAST MEMBROS ONLINE
// ==========================================

function broadcastOnlineMembers() {
  const members = Array.from(onlineUsers.values()).map(user => ({
    id: user.id,
    userId: user.userId,
    username: user.username,
    avatar_url: user.avatar_url
  }));

  io.emit("members:update", members);
}

// ==========================================
// LISTAR PARTICIPANTES DA VOZ
// ==========================================

function getVoiceMembers(channelId) {
  const normalizedId = String(channelId);

  const members = voiceRooms.get(normalizedId);

  if (!members) return [];

  return Array.from(members)
    .map(peerId => {
      const peerSocket = io.sockets.sockets.get(peerId);

      if (!peerSocket) return null;

      const user = peerSocket.data.user;

      return {
        id: peerId,
        userId: String(user.id),
        username: user.username,
        avatar_url: user.avatar_url || null,
        muted: Boolean(peerSocket.data.muted)
      };
    })
    .filter(Boolean);
}

// ==========================================
// ATUALIZAR PARTICIPANTES DA VOZ
// ==========================================

function broadcastVoiceMembers(channelId) {
  const normalizedId = String(channelId);

  io.emit("voice:members", {
    channelId: normalizedId,
    members: getVoiceMembers(normalizedId)
  });
}

// ==========================================
// VERIFICAR PERMISSÃO DO CANAL
// ==========================================

async function canJoinVoiceChannel(userId, channelId) {
  const result = await pool.query(
    `SELECT c.id
     FROM channels c
     WHERE c.id = $1
       AND c.type = 'voice'
       AND EXISTS (
         SELECT 1
         FROM user_roles ur
         WHERE ur.server_id = c.server_id
           AND ur.user_id = $2
       )
     LIMIT 1`,
    [channelId, userId]
  );

  return result.rowCount > 0;
}

// ==========================================
// SAIR DO CANAL DE VOZ
// ==========================================

function leaveVoiceChannel(socket) {
  const channelId = socket.data.voiceChannelId;

  if (!channelId) return;

  const normalizedId = String(channelId);
  const room = `voice:${normalizedId}`;

  const members = voiceRooms.get(normalizedId);

  if (members) {
    members.delete(socket.id);

    if (members.size === 0) {
      voiceRooms.delete(normalizedId);
    }
  }

  socket.leave(room);

  socket.data.voiceChannelId = null;
  socket.data.muted = false;

  socket.to(room).emit("voice:peer-left", {
    peerId: socket.id
  });

  // Atualiza todos os usuários que visualizam os canais.
  broadcastVoiceMembers(normalizedId);

  console.log("USUÁRIO SAIU DA VOZ:", {
    username: socket.data.user.username,
    channelId: normalizedId
  });
}

// ==========================================
// CONEXÕES SOCKET.IO
// ==========================================

io.on("connection", socket => {
  const user = socket.data.user;
  const userId = String(user.id);

  // Estado inicial
  socket.data.voiceChannelId = null;
  socket.data.muted = false;

  // ========================================
  // ENTRAR NO CANAL DE VOZ
  // ========================================

  socket.on("voice:join", async (payload, callback) => {
    try {
      const channelId = String(
        payload?.channelId ?? ""
      );

      if (!isValidChannelId(channelId)) {
        return callback?.({
          ok: false,
          error: "ID do canal inválido."
        });
      }

      if (socket.data.voiceChannelId === channelId) {
        return callback?.({
          ok: true,
          channelId,
          members: getVoiceMembers(channelId)
        });
      }

      if (socket.data.voiceChannelId) {
        return callback?.({
          ok: false,
          error: "Saia do canal atual antes de entrar em outro."
        });
      }

      const authorized = await canJoinVoiceChannel(
        userId,
        channelId
      );

      if (!authorized) {
        return callback?.({
          ok: false,
          error: "Você não tem permissão para entrar neste canal."
        });
      }

      // Captura os participantes antes da entrada.
      const existingMembers = getVoiceMembers(channelId);

      const room = `voice:${channelId}`;

      await socket.join(room);

      if (!voiceRooms.has(channelId)) {
        voiceRooms.set(channelId, new Set());
      }

      voiceRooms.get(channelId).add(socket.id);

      socket.data.voiceChannelId = channelId;
      socket.data.muted = false;

      socket.to(room).emit("voice:peer-joined", {
        peerId: socket.id,
        userId,
        username: user.username,
        avatar_url: user.avatar_url || null,
        muted: false,
        channelId
      });

      // Atualiza todos, inclusive quem não está na voz.
      broadcastVoiceMembers(channelId);

      console.log("USUÁRIO ENTROU NA VOZ:", {
        username: user.username,
        channelId
      });

      return callback?.({
        ok: true,
        channelId,
        members: existingMembers
      });

    } catch (error) {
      console.error("ERRO AO ENTRAR NA VOZ:", error);

      return callback?.({
        ok: false,
        error: "Não foi possível entrar no canal de voz."
      });
    }
  });

  // ========================================
  // SAIR DO CANAL DE VOZ
  // ========================================

  socket.on("voice:leave", callback => {
    try {
      leaveVoiceChannel(socket);

      callback?.({ ok: true });

    } catch (error) {
      console.error("ERRO AO SAIR DA VOZ:", error);

      callback?.({
        ok: false,
        error: "Não foi possível sair do canal de voz."
      });
    }
  });

// ========================================
// ESTADO DO MICROFONE
// ========================================

socket.data.muted = false;

socket.on("voice:mute", ({ muted } = {}, callback) => {
  const channelId = socket.data.voiceChannelId;

  if (!channelId) {
    return callback?.({
      ok: false,
      error: "Você não está em um canal de voz."
    });
  }

  if (typeof muted !== "boolean") {
    return callback?.({
      ok: false,
      error: "Estado do microfone inválido."
    });
  }

  socket.data.muted = muted;

  io.emit("voice:mute:update", {
    channelId,
    peerId: socket.id,
    userId: String(socket.data.user.id),
    muted
  });

  callback?.({ ok: true });
});

  // ========================================
  // SINCRONIZAR MICROFONE
  // ========================================

  socket.on("voice:mute", ({ muted } = {}, callback) => {
    const channelId = socket.data.voiceChannelId;

    if (!channelId) {
      return callback?.({
        ok: false,
        error: "Você não está em um canal de voz."
      });
    }

    if (typeof muted !== "boolean") {
      return callback?.({
        ok: false,
        error: "Estado do microfone inválido."
      });
    }

    socket.data.muted = muted;

    broadcastVoiceMembers(channelId);

    callback?.({ ok: true });
  });

  // ========================================
  // SINALIZAÇÃO WEBRTC
  // ========================================

  socket.on("voice:signal", ({ peerId, signal } = {}) => {
    try {
      const channelId = socket.data.voiceChannelId;

      if (!channelId || !peerId || !signal) {
        return;
      }

      const members = voiceRooms.get(channelId);

      if (
        !members?.has(socket.id) ||
        !members?.has(peerId)
      ) {
        return;
      }

      const targetSocket = io.sockets.sockets.get(peerId);

      if (
        !targetSocket ||
        targetSocket.data.voiceChannelId !== channelId
      ) {
        return;
      }

      io.to(peerId).emit("voice:signal", {
        peerId: socket.id,
        signal
      });

    } catch (error) {
      console.error("ERRO NA SINALIZAÇÃO WEBRTC:", error);
    }
  });

  // ========================================
  // COMPARTILHAMENTO DE TELA
  // ========================================

  socket.on("screen:started", callback => {
    const channelId = socket.data.voiceChannelId;

    if (!channelId) {
      return callback?.({
        ok: false,
        error: "Entre em um canal de voz primeiro."
      });
    }

    socket.to(`voice:${channelId}`).emit(
      "screen:started",
      {
        peerId: socket.id,
        username: user.username
      }
    );

    callback?.({ ok: true });
  });

  socket.on("screen:stopped", () => {
    const channelId = socket.data.voiceChannelId;

    if (!channelId) return;

    socket.to(`voice:${channelId}`).emit(
      "screen:stopped",
      {
        peerId: socket.id
      }
    );
  });

  // ========================================
  // EVENTOS DE CHAT
  // ========================================

  registerChatEvents(io, socket, pool);

  // ========================================
  // REGISTRAR USUÁRIO ONLINE
  // ========================================

  console.log("SOCKET CONECTADO:", {
    socketId: socket.id,
    userId,
    username: user.username
  });

  if (!onlineUsers.has(userId)) {
    onlineUsers.set(userId, {
      id: userId,
      userId,
      username: user.username,
      avatar_url: user.avatar_url || null,
      socketIds: new Set()
    });
  }

  const onlineUser = onlineUsers.get(userId);

  onlineUser.socketIds.add(socket.id);

  broadcastOnlineMembers();

  // ========================================
  // DESCONECTAR
  // ========================================

  socket.on("disconnect", reason => {
    console.log("SOCKET DESCONECTADO:", {
      socketId: socket.id,
      username: user.username,
      reason
    });

    // Remove o participante da voz.
    leaveVoiceChannel(socket);
    
    socket.data.muted = false;

    const currentUser = onlineUsers.get(userId);

    if (currentUser) {
      currentUser.socketIds.delete(socket.id);

      if (currentUser.socketIds.size === 0) {
        onlineUsers.delete(userId);
      }
    }

    broadcastOnlineMembers();
  });
});

// ==========================================
// ERROS DO SOCKET.IO
// ==========================================

io.engine.on("connection_error", error => {
  console.error("ERRO SOCKET.IO:", {
    code: error.code,
    message: error.message
  });
});

// ==========================================
// ROTA DE TESTE
// ==========================================

app.get("/api/dados", (_req, res) => {
  return res.json({
    mensagem: "Olá do Express na Cloudflare!"
  });
});

// ==========================================
// HEALTH CHECK
// ==========================================

app.get("/api/health", async (_req, res) => {
  try {
    await checkDatabase();

    return res.json({
      status: "ok",
      database: "connected"
    });

  } catch (error) {
    console.error(
      "Erro ao verificar banco:",
      error.message
    );

    return res.status(503).json({
      status: "error",
      database: "unavailable"
    });
  }
});

// ==========================================
// ROTAS DA APLICAÇÃO
// ==========================================

app.use("/api/auth", authRoutes);
app.use("/api/profile", profileRoutes);
app.use("/api/roles", rolesRoutes);
app.use("/api/media", mediaRoutes);

// ==========================================
// ARQUIVOS UPLOADS
// ==========================================

app.use(
  "/uploads",
  express.static("src/uploads", {
    setHeaders: res => {
      res.setHeader(
        "Cross-Origin-Resource-Policy",
        "cross-origin"
      );
    }
  })
);

// ==========================================
// ROTAS NÃO ENCONTRADAS
// ==========================================

app.use("/api", (_req, res) => {
  return res.status(404).json({
    error: "Rota da API não encontrada."
  });
});

// ==========================================
// ERROS GLOBAIS
// ==========================================

app.use((error, _req, res, _next) => {
  console.error("Erro no servidor:", error);

  return res.status(500).json({
    error: "Erro interno do servidor."
  });
});

// ==========================================
// INICIAR SERVIDOR
// ==========================================

async function startServer() {
  try {
    await checkDatabase();

    httpServer.listen(PORT, () => {
      console.log("--------------------------------");
      console.log("KHORRA SERVER INICIADO");
      console.log(`Porta: ${PORT}`);
      console.log(`Frontend: ${CLIENT_URL}`);
      console.log("Express: ativo");
      console.log("Socket.IO: ativo");
      console.log("Autenticação JWT: ativa");
      console.log("PostgreSQL: conectado");
      console.log("Membros online: ativo");
      console.log("Canais de texto: ativo");
      console.log("Canais de voz: ativo");
      console.log("Participantes da voz: sincronizados");
      console.log("Microfone: sincronizado");
      console.log("WebRTC: ativo");
      console.log("Compartilhamento de tela: ativo");
      console.log("Editar mensagens: eventos registrados");
      console.log("Excluir mensagens: eventos registrados");
      console.log("--------------------------------");
    });

  } catch (error) {
    console.error(
      "Não foi possível iniciar o servidor:",
      error.message
    );

    process.exit(1);
  }
}

startServer();
