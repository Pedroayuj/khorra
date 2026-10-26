import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL não foi configurada.");
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 30000,
  ssl:
    process.env.DATABASE_SSL === "true"
      ? { rejectUnauthorized: true }
      : undefined
});

pool.on("error", error => {
  console.error("Erro inesperado no pool PostgreSQL:", error);
});

export async function checkDatabase() {
  await pool.query("SELECT 1");
}
