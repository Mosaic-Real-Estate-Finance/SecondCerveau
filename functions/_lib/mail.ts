import nodemailer from "nodemailer";
import type { Env } from "./notion.js";

// The sign-in code, by Gmail SMTP with an app password (brief §10). An HTML
// part drawn like the code screen — one box per digit — and a plain text part
// for clients that show no HTML.

export const mailEnabled = (env: Env) => Boolean(env.SMTP_USER && env.SMTP_APP_PASSWORD);

const INK = "#020342";
const MUTED = "#6b6c8e";
const SLOT = "#F4F4F9";
const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

// Tables and inline styles: the only layout every mail client agrees on.
function html(code: string): string {
  const slots = code
    .split("")
    .map(
      (digit) =>
        `<td style="padding:0 4px"><div style="width:44px;height:52px;line-height:52px;border-radius:12px;background:${SLOT};color:${INK};font-family:${FONT};font-size:22px;font-weight:600;text-align:center">${digit}</div></td>`,
    )
    .join("");
  return `<!doctype html>
<html lang="fr">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>Votre code de connexion</title></head>
<body style="margin:0;padding:0;background:#ffffff">
<span style="display:none;max-height:0;overflow:hidden">Votre code de connexion est ${code}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff">
<tr><td align="center" style="padding:48px 16px">
<table role="presentation" cellpadding="0" cellspacing="0" style="max-width:420px;width:100%">
<tr><td align="center" style="font-family:${FONT};font-size:13px;font-weight:600;letter-spacing:0.14em;text-transform:uppercase;color:${INK}">Mosaic</td></tr>
<tr><td align="center" style="padding-top:28px;font-family:Georgia,'Times New Roman',serif;font-size:24px;color:${INK}">Votre code de connexion</td></tr>
<tr><td align="center" style="padding-top:28px"><table role="presentation" cellpadding="0" cellspacing="0"><tr>${slots}</tr></table></td></tr>
<tr><td align="center" style="padding-top:28px;font-family:${FONT};font-size:14px;line-height:1.5;color:${MUTED}">Valable 10 minutes, pour une seule connexion.<br>Si vous n'avez rien demandé, ignorez ce message.</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

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
    subject: `Votre code de connexion est ${code}`,
    text: [
      `Votre code de connexion à Mosaic : ${code}`,
      "",
      "Il est valable 10 minutes et ne sert qu'une fois.",
      "Si vous n'avez rien demandé, ignorez ce message.",
    ].join("\n"),
    html: html(code),
  });
}
