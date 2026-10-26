import jwt from "jsonwebtoken";
import dotenv from "dotenv";

dotenv.config();

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  throw new Error(
    "JWT_SECRET precisa ter pelo menos 32 caracteres."
  );
}

export const COOKIE_NAME = "khorra_token";

export const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
  path: "/",
  maxAge: 15 * 60 * 1000
};

export function createToken(user) {
  return jwt.sign(
    { email: user.email },
    process.env.JWT_SECRET,
    {
      subject: String(user.id),
      issuer: "khorra-api",
      audience: "khorra-app",
      expiresIn: process.env.JWT_EXPIRES_IN || "15m",
      algorithm: "HS256"
    }
  );
}

export function verifyToken(token) {
  return jwt.verify(token, process.env.JWT_SECRET, {
    issuer: "khorra-api",
    audience: "khorra-app",
    algorithms: ["HS256"]
  });
}
