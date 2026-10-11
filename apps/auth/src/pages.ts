function escape(value: string) { return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!); }

export function authPage(url: URL, dashboard: string, name?: string): Response {
  const consent = url.pathname === '/consent';
  const revoke = url.pathname === '/revoke-all';
  const title = revoke ? 'Cerrar todas las sesiones' : consent ? 'Conectar una herramienta' : 'Tu cuenta de Artifacts';
  const content = revoke
    ? `<p>Se cerrarán tus sesiones en el panel y en las herramientas conectadas.</p><form method="post" action="/revoke-all"><button>Cerrar todas las sesiones</button></form><a href="${escape(dashboard)}">Volver al panel</a>`
    : consent
    ? `<p id="client">Revisando la solicitud…</p><ul id="scopes"></ul><form id="consent"><button name="accept" value="true">Permitir acceso</button><button name="accept" value="false" class="secondary">Cancelar</button></form>`
    : `<p>Inicia sesión para abrir tu espacio y conectar tus herramientas.</p><form id="signin"><label for="email">Correo electrónico</label><input id="email" name="email" type="email" autocomplete="username" required><label for="password">Contraseña</label><input id="password" name="password" type="password" autocomplete="current-password" required><button>Iniciar sesión</button></form>${name ? `<p>Sesión actual de ${escape(name)}.</p><a href="${escape(dashboard)}">Abrir el panel</a>` : ''}`;
  const script = `
const error = document.querySelector('#error');
const query = location.search.slice(1);
const dashboard = ${JSON.stringify(dashboard).replace(/</g, '\\u003c')};
async function post(path, body) {
  const response = await fetch(path, {method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify(body)});
  const result = await response.json();
  if (!response.ok) throw new Error('No se pudo completar la solicitud. Revisa tus datos e inténtalo de nuevo.');
  return result;
}
document.querySelector('#signin')?.addEventListener('submit', async event => {
  event.preventDefault(); error.textContent = '';
  const form = new FormData(event.target);
  try {
    await post('/api/auth/sign-in/email', {email:form.get('email'), password:form.get('password')});
    if (!query) { location.assign(dashboard); return; }
    const result = await post('/api/auth/oauth2/continue', {postLogin:true, oauth_query:query});
    location.assign(result.url || result.redirect_uri);
  } catch (failure) { error.textContent = failure.message; }
});
const consentForm = document.querySelector('#consent');
if (consentForm) {
  const params = new URLSearchParams(query);
  fetch('/api/auth/oauth2/public-client?' + new URLSearchParams({client_id:params.get('client_id')}))
    .then(response => { if(!response.ok) throw new Error(); return response.json(); })
    .then(client => { document.querySelector('#client').textContent = (client.client_name || client.name || 'Esta herramienta') + ' solicita acceso a tu cuenta.'; })
    .catch(() => { document.querySelector('#client').textContent = 'Revisa los permisos de esta herramienta.'; });
  const labels = {openid:'Identificar tu cuenta', profile:'Leer tu nombre', offline_access:'Mantener la conexión', 'artifacts:read':'Leer tus artefactos', 'artifacts:write':'Editar tus artefactos', 'artifacts:publish':'Publicar tus artefactos'};
  for(const scope of (params.get('scope') || '').split(' ').filter(Boolean)) { const li = document.createElement('li'); li.textContent = labels[scope] || scope; document.querySelector('#scopes').append(li); }
  consentForm.addEventListener('submit', async event => { event.preventDefault(); try { const result = await post('/api/auth/oauth2/consent', {accept:event.submitter.value === 'true', oauth_query:query}); location.assign(result.url || result.redirect_uri); } catch(failure) { error.textContent = failure.message; } });
}`;
  return new Response(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} · Artifacts</title><style>
:root{font-family:Optima,Candara,'Segoe UI',sans-serif;color:#132943;background:#eaf0f5}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;grid-template-columns:minmax(220px,1fr) minmax(320px,1.4fr)}aside{padding:clamp(28px,6vw,90px);display:flex;flex-direction:column;justify-content:space-between;background:#dce6ef;border-right:1px solid #c7d5e3}aside strong{font-size:28px;font-weight:600;letter-spacing:-1px}.mark{font-family:Georgia,serif;font-size:clamp(140px,20vw,300px);line-height:1;color:#3154d9}aside p{max-width:25ch;line-height:1.5}main{align-self:center;padding:48px clamp(28px,7vw,110px);max-width:690px}h1{font-size:clamp(30px,4vw,44px);font-weight:500;line-height:1.1;letter-spacing:-1px;margin:0 0 24px}p,li{line-height:1.6}form{display:grid;gap:12px;margin:28px 0}input{font:inherit;padding:13px;background:white;border:1px solid #9baec2;border-radius:4px;width:100%}button{font:inherit;font-weight:600;background:#3154d9;color:white;border:0;border-radius:4px;padding:14px 20px;cursor:pointer;margin-top:8px}.secondary{background:transparent;border:1px solid #9baec2;color:#132943}a{color:#2546c0}input:focus-visible,button:focus-visible,a:focus-visible{outline:3px solid #6885ff;outline-offset:3px}#error{color:#a32035;min-height:24px}@media(max-width:650px){body{display:block}aside{padding:24px;border-right:0;border-bottom:1px solid #c7d5e3}aside .mark,aside p{display:none}main{padding:40px 24px}}</style></head><body><aside><strong>Artifacts</strong><div class="mark" aria-hidden="true">a.</div><p>Un espacio propio para lo que creas.</p></aside><main><h1>${title}</h1>${content}<p id="error" role="alert"></p></main><script>${script}</script></body></html>`, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'same-origin' } });
}
