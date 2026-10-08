import nodemailer from "nodemailer";
import type { Env } from "./notion.js";

// The sign-in code, by Gmail SMTP with an app password (brief §10). Plain and
// French: the code, how long it lasts, and the name of the app.

export const mailEnabled = (env: Env) => Boolean(env.SMTP_USER && env.SMTP_APP_PASSWORD);

export async function sendCode(env: Env, to: string, code: string): Promise<void> {
  const transport = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: { user: env.SMTP_USER, pass: env.SMTP_APP_PASSWORD },
  });
  await transport.sendMail({
    from: env.SMTP_FROM || env.SMTP_USER,
    to,
    subject: `Votre code Mosaic Dictée : ${code}`,
    text: [
      "Bonjour,",
      "",
      `Voici votre code de connexion à Mosaic Dictée : ${code}`,
      "",
      "Il est valable 10 minutes et ne sert qu'une fois.",
      "Si vous n'avez rien demandé, ignorez ce message.",
    ].join("\n"),
  });
}
