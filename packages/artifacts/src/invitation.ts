export type InvitationMessage = { to: string; subject: string; text: string; html: string };
export type InvitationSender = (message: InvitationMessage) => Promise<void>;

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);

export function invitation(to: string, ownerName: string, publicationUrl: string): InvitationMessage {
  const name = ownerName.trim() || 'Usuario de Artifacts';
  const text = `${name} compartió un artefacto contigo.\n\nAbre la publicación e inicia sesión con este correo electrónico.\n${publicationUrl}\n\nEl acceso estará disponible cuando el propietario publique una revisión.`;
  const html = `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Un artefacto compartido contigo</title><body style="margin:0;background:#eff1f5;color:#4c4f69;font-family:Arial,sans-serif;line-height:1.6"><main style="box-sizing:border-box;max-width:600px;margin:0 auto;padding:40px 24px;overflow-wrap:anywhere"><p style="font-size:14px;letter-spacing:2px">ARTIFACTS</p><h1 style="font-size:28px;line-height:1.2">Un artefacto compartido contigo</h1><p><strong>${escapeHtml(name)}</strong> te dio acceso a una publicación.</p><p>Abre el enlace e inicia sesión con este correo electrónico.</p><p style="margin:32px 0"><a href="${escapeHtml(publicationUrl)}" style="display:inline-block;background:#1e66f5;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none">Abrir publicación</a></p><p style="font-size:14px">El acceso estará disponible cuando el propietario publique una revisión.</p></main></body></html>`;
  return { to, subject: 'Un artefacto compartido contigo', text, html };
}
