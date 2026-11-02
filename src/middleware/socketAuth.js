
import { COOKIE_NAME, verifyToken } from "../auth.js";

export async function socketAuth(socket, next) {
  try {
    const cookieHeader = socket.handshake.headers.cookie || "";

    // Interpretar os cookies recebidos.
    const cookies = {};

    cookieHeader.split(";").forEach(item => {
      const separator = item.indexOf("=");

      if (separator === -1) return;

      const name = item.slice(0, separator).trim();
      const value = item.slice(separator + 1).trim();

      cookies[name] = decodeURIComponent(value);
    });

    // Procurar o token JWT.
    const token = cookies[COOKIE_NAME];

    if (!token) {
      console.log("SOCKET: cookie de autenticação ausente");
      return next(new Error("AUTH_REQUIRED"));
    }

    // Validar JWT.
    const payload = verifyToken(token);

    socket.data.user = {
      id: payload.sub
    };

    console.log("SOCKET autenticado:", payload.sub);

    return next();

  } catch (error) {
    console.error("Erro Socket Auth:", error.message);

    return next(new Error("AUTH_REQUIRED"));
  }
}
