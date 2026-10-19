import { mkdir, writeFile } from "node:fs/promises";

export interface SendEmailResult {
  sent: boolean;
  provider?: string;
  reason?: string;
  url: string;
}

export async function sendAccountEmail(
  email: string,
  kind: string,
  token: string,
): Promise<SendEmailResult> {
  const appBase =
    process.env.APP_URL || "http://localhost:3100";
  const url = new URL("/account", appBase);
  url.searchParams.set("token", token);

  const isInvite = kind === "invite";
  const subject = isInvite
    ? "Your invitation to OpenScreens"
    : "Reset your OpenScreens password";

  const actionText = isInvite
    ? "Accept Invitation & Set Password"
    : "Reset Password";

  const description = isInvite
    ? "You have been invited to manage digital signage and slideshows for <strong>OpenScreens</strong>."
    : "A request was received to reset your administrator password for OpenScreens.";

  const instructions = isInvite
    ? "Click the button below to confirm your name and set a secure password for your account:"
    : "Click the button below to choose a new password for your account:";

  const text = `${subject}\n\n${description.replace(/<[^>]+>/g, "")}\n\n${instructions}\n${url.toString()}\n\nThis single-use link is valid for ${isInvite ? "48 hours" : "30 minutes"}.\nIf you did not expect this message, you can safely ignore it.`;

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${subject}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background-color: #070d1e; color: #ffffff; margin: 0; padding: 40px 16px; }
    .card { max-width: 540px; margin: 0 auto; background: #0c1836; border: 1px solid rgba(197, 160, 89, 0.35); border-radius: 12px; padding: 36px 28px; box-shadow: 0 10px 30px rgba(0,0,0,0.6); }
    .header { text-align: center; margin-bottom: 24px; }
    .crest { width: 64px; height: auto; margin-bottom: 12px; }
    .eyebrow { color: #c5a059; font-size: 11px; font-weight: 700; letter-spacing: 2px; text-transform: uppercase; margin: 0 0 6px 0; }
    .h1 { color: #ffffff; font-size: 22px; font-weight: 600; margin: 0; }
    .content { color: #d1d5db; font-size: 15px; line-height: 1.6; margin: 20px 0; }
    .btn-wrap { text-align: center; margin: 30px 0; }
    .btn { display: inline-block; background-color: #c5a059; color: #070d1e !important; text-decoration: none; padding: 14px 28px; border-radius: 6px; font-size: 15px; font-weight: 700; letter-spacing: 0.3px; }
    .fallback { font-size: 12px; color: #9ca3af; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 20px; margin-top: 24px; word-break: break-all; }
    .fallback a { color: #c5a059; }
    .footer { text-align: center; font-size: 11px; color: #6b7280; margin-top: 24px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <img src="${appBase}/brand/crest.png" alt="OpenScreens" class="crest" />
      <p class="eyebrow">OPENSCREENS · STUDIO</p>
      <h1 class="h1">${isInvite ? "Administrator Invitation" : "Password Reset"}</h1>
    </div>
    <div class="content">
      <p style="margin: 0 0 12px 0;">${description}</p>
      <p style="margin: 0 0 20px 0;">${instructions}</p>
    </div>
    <div class="btn-wrap">
      <a href="${url.toString()}" class="btn" target="_blank">${actionText}</a>
    </div>
    <div class="fallback">
      If the button above does not work, copy and paste this address into your browser:<br/>
      <a href="${url.toString()}">${url.toString()}</a>
    </div>
    <div class="footer">
      Single-use secure link valid for ${isInvite ? "48 hours" : "30 minutes"}.<br/>
      If you did not expect this message, you may safely ignore it.
    </div>
  </div>
</body>
</html>`;

  // 1. Local mail logging for development
  if (
    process.env.NODE_ENV !== "production" &&
    process.env.LOCAL_EMAIL === "true"
  ) {
    await mkdir(".local/mail", { recursive: true });
    await writeFile(
      `.local/mail/${Date.now()}-${kind}.json`,
      JSON.stringify({ email, subject, url: url.toString() }, null, 2),
    );
    return { sent: true, provider: "local", url: url.toString() };
  }

  // 2. Resend (api.resend.com)
  if (process.env.RESEND_API_KEY) {
    const from =
      process.env.RESEND_FROM_EMAIL ||
      "OpenScreens <onboarding@resend.dev>";
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [email],
        subject,
        html,
        text,
      }),
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      throw new Error(
        `Resend failed: ${err.message || r.statusText || "Delivery error"}`,
      );
    }
    return { sent: true, provider: "resend", url: url.toString() };
  }

  // 3. MailerSend (api.mailersend.com)
  if (process.env.MAILERSEND_API_KEY) {
    const fromEmail =
      process.env.MAILERSEND_SENDER_EMAIL || "screens@example.com";
    const r = await fetch("https://api.mailersend.com/v1/email", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.MAILERSEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: {
          email: fromEmail,
          name: "OpenScreens",
        },
        to: [{ email }],
        subject,
        html,
        text,
      }),
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      throw new Error(
        `MailerSend failed: ${err.message || r.statusText || "Delivery error"}`,
      );
    }
    return { sent: true, provider: "mailersend", url: url.toString() };
  }

  // 4. SendGrid (api.sendgrid.com)
  if (process.env.SENDGRID_API_KEY) {
    const fromEmail =
      process.env.SENDGRID_FROM_EMAIL || "screens@example.com";
    const r = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.SENDGRID_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email }] }],
        from: { email: fromEmail, name: "OpenScreens" },
        subject,
        content: [
          { type: "text/plain", value: text },
          { type: "text/html", value: html },
        ],
      }),
    });
    if (!r.ok) {
      const err = await r.text().catch(() => "");
      throw new Error(
        `SendGrid failed: ${err || r.statusText || "Delivery error"}`,
      );
    }
    return { sent: true, provider: "sendgrid", url: url.toString() };
  }

  // 5. Postmark (api.postmarkapp.com)
  if (process.env.POSTMARK_SERVER_TOKEN) {
    const fromEmail =
      process.env.POSTMARK_FROM_EMAIL || "screens@example.com";
    const r = await fetch("https://api.postmarkapp.com/email", {
      method: "POST",
      headers: {
        "X-Postmark-Server-Token": process.env.POSTMARK_SERVER_TOKEN,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        From: `OpenScreens <${fromEmail}>`,
        To: email,
        Subject: subject,
        HtmlBody: html,
        TextBody: text,
      }),
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      throw new Error(
        `Postmark failed: ${err.Message || r.statusText || "Delivery error"}`,
      );
    }
    return { sent: true, provider: "postmark", url: url.toString() };
  }

  // 6. No provider configured: return invite link gracefully so the user can be invited
  return {
    sent: false,
    reason:
      "No email provider key configured (e.g. RESEND_API_KEY or MAILERSEND_API_KEY).",
    url: url.toString(),
  };
}
