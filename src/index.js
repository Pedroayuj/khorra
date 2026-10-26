import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import { createServer } from "node:http";
import { Server } from "socket.io";
import { randomUUID } from "node:crypto";
import cookieParser from "cookie-parser";

import serverlessExpress from '@codegenie/serverless-express';

import authRoutes from "./routes/auth.routes.js";
import { pool, checkDatabase } from "./db.js";
import { COOKIE_NAME, verifyToken } from "./auth.js";

const app = express();
const httpServer = createServer(app);

app.get('/api/dados', (req, res) => {
  res.json({ mensagem: "Olá do Express na Cloudflare!" });
});

// Em vez de usar app.listen(3000), exportamos como ES Module para a Cloudflare:
const handler = serverlessExpress({ app });

export default {
  async fetch(request, env, ctx) {
    return handler(request, env, ctx);
  }
};

const PORT = Number(process.env.PORT || 3001);
const CLIENT_URL =
  process.env.CLIENT_URL || "http://localhost:5173";

app.disable("x-powered-by");
app.use(helmet());

app.use(
  cors({
    origin: CLIENT_URL,
    credentials: true,
    methods: ["GET", "POST"]
  })
);

app.use(express.json({ limit: "10kb" }));
app.use(cookieParser());

// Verificação da API e do banco.
app.get("/api/health", async (_req, res) => {
  try {
    await checkDatabase();

    return res.json({
      status: "ok",
      database: "connected"
    });
  } catch (error) {
    console.error("Erro ao verificar banco:", error.message);

    return res.status(503).json({
      status: "error",
      database: "unavailable"
    });
  }
});

// Rotas de autenticação.
app.use("/api/auth", authRoutes);

const io = new Server(httpServer, {
  cors: {
    origin: CLIENT_URL,
    credentials: true,
    methods: ["GET", "POST"]
  }
});

// Autenticação Socket.IO usando o cookie JWT.
io.use(async (socket, next) => {
  try {
    const cookieHeader =
      socket.handshake.headers.cookie || "";

    const token = cookieHeader
      .split(";")
      .map(part => part.trim())
      .find(part => part.startsWith(`${COOKIE_NAME}=`))
      ?.slice(COOKIE_NAME.length + 1);

    if (!token) {
      return next(new Error("AUTH_REQUIRED"));
    }

    const payload = verifyToken(
      decodeURIComponent(token)
    );

    const result = await pool.query(
      `SELECT id, username, email
       FROM users
       WHERE id = $1`,
      [payload.sub]
    );

    if (!result.rowCount) {
      return next(new Error("AUTH_INVALID"));
    }

    socket.data.user = result.rows[0];

    return next();
  } catch (error) {
    console.error(
      "Erro na autenticação Socket.IO:",
      error.message
    );

    return next(new Error("AUTH_INVALID"));
  }
});

const channels = [
  { id: "geral", name: "geral", type: "text" },
  { id: "jogos", name: "jogos", type: "text" },
  { id: "voz-geral", name: "Voz geral", type: "voice" }
];

// Estado em memória.
const messages = new Map();
const onlineUsers = new Map();
const voiceUsers = new Map();

const cleanString = (value, max = 1000) =>
  typeof value === "string"
    ? value.trim().slice(0, max)
    : "";

function publicUser(user) {
  return {
    id: String(user.id),
    username: user.username,
    email: user.email
  };
}

function emitPresence() {
  io.emit("members:update", [
    ...onlineUsers.values()
  ]);
}

function getVoiceMembers(channelId) {
  return [
    ...(voiceUsers.get(channelId)?.values() || [])
  ];
}

function emitVoiceMembers(channelId) {
  io.emit("voice:members", {
    channelId,
    members: getVoiceMembers(channelId)
  });
}

function leaveVoice(socket) {
  const channelId = socket.data.voiceChannel;

  if (!channelId) return;

  const members = voiceUsers.get(channelId);

  members?.delete(socket.id);

  if (members?.size === 0) {
    voiceUsers.delete(channelId);
  }

  socket
    .to(`voice:${channelId}`)
    .emit("voice:peer-left", {
      peerId: socket.id
    });

  socket.leave(`voice:${channelId}`);
  socket.data.voiceChannel = null;

  emitVoiceMembers(channelId);
}

io.on("connection", socket => {
  const user = socket.data.user;

  onlineUsers.set(socket.id, {
    id: socket.id,
    userId: String(user.id),
    username: user.username,
    status: "online"
  });

  socket.join("community");
  emitPresence();

  socket.emit("auth:ready", {
    user: publicUser(user),
    channels
  });

  // Entrar em um canal de texto.
  socket.on("channel:join", (payload, ack) => {
    const channelId = cleanString(
      payload?.channelId,
      64
    );

    const channel = channels.find(
      item => item.id === channelId
    );

    if (!channel || channel.type !== "text") {
      return ack?.({
        ok: false,
        error: "Canal inválido."
      });
    }

    for (const room of socket.rooms) {
      if (room.startsWith("text:")) {
        socket.leave(room);
      }
    }

    socket.join(`text:${channelId}`);

    return ack?.({
      ok: true,
      messages: messages.get(channelId) || []
    });
  });

  // Enviar mensagem.
  socket.on("message:send", (payload, ack) => {
    const channelId = cleanString(
      payload?.channelId,
      64
    );

    const content = cleanString(
      payload?.content,
      2000
    );

    const channel = channels.find(
      item =>
        item.id === channelId &&
        item.type === "text"
    );

    if (
      !channel ||
      !content ||
      !socket.rooms.has(`text:${channelId}`)
    ) {
      return ack?.({
        ok: false,
        error: "Mensagem ou canal inválido."
      });
    }

    const message = {
      id: randomUUID(),
      channelId,
      userId: String(user.id),
      username: user.username,
      content,
      createdAt: new Date().toISOString()
    };

    const history = messages.get(channelId) || [];

    history.push(message);

    if (history.length > 200) {
      history.shift();
    }

    messages.set(channelId, history);

    io
      .to(`text:${channelId}`)
      .emit("message:new", message);

    return ack?.({ ok: true });
  });

  // Entrar em um canal de voz.
  socket.on("voice:join", (payload, ack) => {
    const channelId = cleanString(
      payload?.channelId,
      64
    );

    const channel = channels.find(
      item =>
        item.id === channelId &&
        item.type === "voice"
    );

    if (!channel) {
      return ack?.({
        ok: false,
        error: "Canal de voz inválido."
      });
    }

    if (socket.data.voiceChannel === channelId) {
      return ack?.({
        ok: true,
        members: getVoiceMembers(channelId).filter(
          member => member.id !== socket.id
        )
      });
    }

    leaveVoice(socket);

    if (!voiceUsers.has(channelId)) {
      voiceUsers.set(channelId, new Map());
    }

    const members = voiceUsers.get(channelId);
    const existingMembers = [...members.values()];

    socket.join(`voice:${channelId}`);
    socket.data.voiceChannel = channelId;

    members.set(socket.id, {
      id: socket.id,
      userId: String(user.id),
      username: user.username
    });

    ack?.({
      ok: true,
      members: existingMembers
    });

    socket
      .to(`voice:${channelId}`)
      .emit("voice:peer-joined", {
        peerId: socket.id,
        username: user.username
      });

    emitVoiceMembers(channelId);
  });

  // Sinalização WebRTC para voz e futuras transmissões
  // de tela. O cliente deve criar os peers e enviar
  // os objetos signal do simple-peer.
 
  // Sinalização WebRTC para voz e compartilhamento de tela.
  socket.on("voice:signal", payload => {
    const peerId = cleanString(payload?.peerId, 100);
    const channelId = socket.data.voiceChannel;
    const signal = payload?.signal;

    if (
      !channelId ||
      !peerId ||
      peerId === socket.id ||
      !signal ||
      typeof signal !== "object" ||
      !voiceUsers.get(channelId)?.has(peerId)
    ) {
      return;
    }

    // Entrega a sinalização somente ao participante de destino.
    io.to(peerId).emit("voice:signal", {
      peerId: socket.id,
      signal
    });
  });

  // Notifica os participantes quando alguém começa a compartilhar.
  socket.on("screen:started", ack => {
    const channelId = socket.data.voiceChannel;

    if (!channelId) {
      ack?.({
        ok: false,
        error: "Entre em um canal de voz primeiro."
      });
      return;
    }

    socket.to(`voice:${channelId}`).emit("screen:started", {
      peerId: socket.id,
      username: user.username
    });

    ack?.({ ok: true });
  });

  // Notifica os participantes quando alguém para de compartilhar.
  socket.on("screen:stopped", () => {
    const channelId = socket.data.voiceChannel;

    if (!channelId) return;

    socket.to(`voice:${channelId}`).emit("screen:stopped", {
      peerId: socket.id
    });
  });

  // Sair do canal de voz.
    // Sair do canal de voz.
  socket.on("voice:leave", () => {
    const channelId = socket.data.voiceChannel;

    if (channelId) {
      socket.to(`voice:${channelId}`).emit("screen:stopped", {
        peerId: socket.id
      });
    }

    leaveVoice(socket);
  });

  // Limpeza ao desconectar.
  socket.on("disconnect", () => {
    leaveVoice(socket);
    onlineUsers.delete(socket.id);
    emitPresence();
  });

}); // Fecha io.on("connection")

httpServer.listen(PORT, async () => {
  try {
    await checkDatabase();

    console.log(`Khorra API disponível na porta ${PORT}`);
    console.log(`Frontend autorizado: ${CLIENT_URL}`);
  } catch (error) {
    console.error(
      "Não foi possível conectar ao PostgreSQL:",
      error.message
    );
  }
});