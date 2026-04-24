// _shared/mail-template.ts — Elegant, mobile-friendly responsive HTML wrapper.

export interface MailSection {
  title: string;
  emoji?: string;
  items: Array<{ html: string; meta?: string }>;
}

const COLORS = {
  bg: '#0f172a',
  surface: '#ffffff',
  text: '#0f172a',
  muted: '#64748b',
  border: '#e2e8f0',
  accent: '#6366f1',
  accentSoft: '#eef2ff',
};

export function renderDigestEmail(opts: {
  greeting: string;
  intro?: string;
  sections: MailSection[];
  footerNote?: string;
  appUrl?: string;
}): string {
  const sectionsHtml = opts.sections.length
    ? opts.sections.map((s) => `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 18px 0">
        <tr><td style="padding:0 0 8px 0;font:600 13px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:${COLORS.muted};text-transform:uppercase;letter-spacing:.06em">${s.emoji ?? ''} ${escapeHtml(s.title)}</td></tr>
        ${s.items.map((it) => `
          <tr>
            <td style="padding:10px 14px;background:${COLORS.accentSoft};border-radius:10px;font:400 14px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:${COLORS.text}">
              ${it.html}
              ${it.meta ? `<div style="margin-top:4px;color:${COLORS.muted};font-size:12px">${escapeHtml(it.meta)}</div>` : ''}
            </td>
          </tr>
          <tr><td style="height:6px;line-height:6px;font-size:0">&nbsp;</td></tr>
        `).join('')}
      </table>`).join('')
    : `<p style="margin:0;color:${COLORS.muted};font:400 14px/1.6 sans-serif">Nothing scheduled for now &mdash; enjoy the breather. ☕</p>`;

  const cta = opts.appUrl
    ? `<a href="${opts.appUrl}" style="display:inline-block;margin-top:8px;padding:10px 18px;background:${COLORS.accent};color:#fff;text-decoration:none;border-radius:8px;font:600 13px/1 sans-serif">Open Plynth →</a>`
    : '';

  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Plynth digest</title></head>
<body style="margin:0;padding:0;background:${COLORS.bg};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COLORS.bg};padding:32px 12px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:${COLORS.surface};border-radius:16px;overflow:hidden;box-shadow:0 10px 40px rgba(0,0,0,.25)">
        <tr><td style="padding:28px 28px 8px 28px">
          <div style="font:700 22px/1.2 -apple-system,sans-serif;color:${COLORS.text}">Plynth</div>
          <div style="margin-top:4px;font:400 13px/1.4 sans-serif;color:${COLORS.muted}">${escapeHtml(opts.greeting)}</div>
        </td></tr>
        ${opts.intro ? `<tr><td style="padding:8px 28px 0 28px;font:400 14px/1.6 sans-serif;color:${COLORS.text}">${escapeHtml(opts.intro)}</td></tr>` : ''}
        <tr><td style="padding:18px 28px 8px 28px">${sectionsHtml}</td></tr>
        ${cta ? `<tr><td style="padding:0 28px 24px 28px">${cta}</td></tr>` : ''}
        <tr><td style="padding:16px 28px;border-top:1px solid ${COLORS.border};font:400 11px/1.5 sans-serif;color:${COLORS.muted}">
          ${opts.footerNote ? escapeHtml(opts.footerNote) + '<br>' : ''}
          You can change reminders in <em>Settings → Reminders</em>.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
