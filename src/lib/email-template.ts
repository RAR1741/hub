export const HUB_URL = "https://hub.redalert1741.org";

export type EmailInput = {
  heading: string; // H1 inside the card
  paragraphs: string[]; // body copy, one <p> each; plain text, escaped
  code?: string; // prominent code block, e.g. "1234-5678"
  footerNote?: string; // small muted line under the paragraphs
};

// ponytail: no link/CTA support; add cta?: {label, href} when the first email needs one.

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderEmail(input: EmailInput): { html: string; text: string } {
  const { heading, paragraphs, code, footerNote } = input;

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta name="color-scheme" content="dark"><meta name="supported-color-schemes" content="dark"><title>${escapeHtml(heading)}</title></head>
<body style="margin:0;padding:0;background-color:#131417;" bgcolor="#131417">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#131417" style="background-color:#131417;">
<tr><td align="center" style="padding:32px 16px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;">
    <tr><td align="center" bgcolor="#ffffff" style="background-color:#ffffff;color:#1b1719;padding:18px 24px;border-radius:8px 8px 0 0;border-bottom:4px solid #e01926;font:700 16px/1.2 -apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
      <img src="${HUB_URL}/redalert-logo.png" width="180" height="50" alt="Red Alert Robotics 1741" style="display:block;border:0;width:180px;height:auto;">
    </td></tr>
    <tr><td bgcolor="#1b1d21" style="background-color:#1b1d21;color:#ece9e4;padding:28px 24px;border:1px solid #2c2f35;border-top:0;border-radius:0 0 8px 8px;font:400 16px/1.5 -apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
      <h1 style="margin:0 0 12px;font-size:22px;line-height:1.25;color:#ece9e4;">${escapeHtml(heading)}</h1>
      ${paragraphs.map((p) => `<p style="margin:0 0 16px;color:#ece9e4;">${escapeHtml(p)}</p>`).join("\n      ")}
      ${
        code
          ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:20px 0;">
        <tr><td align="center" bgcolor="#131417" style="background-color:#131417;color:#ffffff;border:1px solid #ff3b45;border-radius:8px;padding:18px 12px;font:700 32px/1.2 SFMono-Regular,Menlo,Consolas,'Liberation Mono',monospace;letter-spacing:4px;">${escapeHtml(code)}</td></tr>
      </table>`
          : ""
      }
      ${footerNote ? `<p style="margin:16px 0 0;font-size:14px;color:#9c958d;">${escapeHtml(footerNote)}</p>` : ""}
    </td></tr>
    <tr><td style="padding:16px 8px;color:#9c958d;font:400 12px/1.5 -apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;text-align:center;">
      1741 Hub &middot; Red Alert Robotics &middot; FRC Team 1741<br>
      <a href="${HUB_URL}" style="color:#8ea0ad;">hub.redalert1741.org</a>
    </td></tr>
  </table>
</td></tr>
</table>
</body></html>`;

  const text = [heading, ...paragraphs, code, footerNote, `1741 Hub — Red Alert Robotics, FRC Team 1741\n${HUB_URL}`]
    .filter((part): part is string => part !== undefined)
    .join("\n\n");

  return { html, text };
}
