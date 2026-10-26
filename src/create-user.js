import "dotenv/config";
import bcrypt from "bcryptjs";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { pool } from "./db.js";

const rl = createInterface({ input, output });

try {
  const username = (await rl.question("Nome de usuário: ")).trim();
  const email = (await rl.question("E-mail: ")).trim().toLowerCase();
  const password = await rl.question("Senha (mínimo 5 caracteres): ");

  if (!/^[a-zA-Z0-9_-]{5,12}$/.test(username)) {
    throw new Error(
      "O nome deve ter 5-12 caracteres: letras, números, _ ou -."
    );
  }

  if (
    email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  ) {
    throw new Error("E-mail inválido.");
  }

  if (password.length < 5 || password.length > 10) {
    throw new Error("A senha deve ter entre 5 e 10 caracteres.");
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const result = await pool.query(
    `INSERT INTO users (username, email, password_hash)
     VALUES ($1, $2, $3)
     RETURNING id, username, email`,
    [username, email, passwordHash]
  );

  console.log("Usuário criado:", result.rows[0]);
} catch (error) {
  if (error.code === "23505") {
    console.error("Esse e-mail ou nome de usuário já está cadastrado.");
  } else {
    console.error(error.message);
  }

  process.exitCode = 1;
} finally {
  rl.close();
  await pool.end();
}
