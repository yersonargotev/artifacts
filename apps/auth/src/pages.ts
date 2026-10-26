function escape(value: string) { return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!); }

export function authPage(url: URL, dashboard: string, name?: string, emailCodeEnabled = false): Response {
  const consent = url.pathname === '/consent';
  const revoke = url.pathname === '/revoke-all';
  const title = revoke ? 'Cerrar todas las sesiones' : consent ? 'Conectar una herramienta' : 'Tu cuenta de Artifacts';
  const content = revoke
    ? `<p>Se cerrarán tus sesiones en el panel y en las herramientas conectadas.</p><form method="post" action="/revoke-all"><button>Cerrar todas las sesiones</button></form><a href="${escape(dashboard)}">Volver al panel</a>`
    : consent
    ? `<p id="client">Revisando la solicitud…</p><ul id="scopes"></ul><form id="consent"><button name="accept" value="true">Permitir acceso</button><button name="accept" value="false" class="secondary">Cancelar</button></form>`
    : `<p>Inicia sesión para abrir tu espacio y conectar tus herramientas.</p><form id="signin" method="post" action="/api/auth/sign-in/email"><label for="email">Correo electrónico</label><input id="email" name="email" type="email" autocomplete="username" required><label for="password">Contraseña</label><input id="password" name="password" type="password" autocomplete="current-password" required><button>Iniciar sesión</button></form>${emailCodeEnabled ? `<form id="email-code" method="post" action="/api/auth/sign-in/email-otp"><button id="request-code" class="secondary">Recibir código</button><fieldset id="code-fields" hidden disabled><p id="code-status" role="status">Te enviamos un código</p><p id="code-email"></p><label for="otp">Código de acceso</label><p id="code-hint">Ingresa el código que recibiste por correo.</p><input id="otp" name="otp" type="text" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" minlength="6" maxlength="6" aria-describedby="code-hint code-error" required><p id="code-error" class="field-error" role="alert"></p><button>Iniciar sesión</button><button id="resend-code" type="button" class="secondary">Recibir otro código</button><button id="back-password" type="button" class="secondary">Volver a la contraseña</button></fieldset></form>` : ''}<form id="continuation" method="post" action="/api/auth/oauth2/continue" hidden><button>Continuar</button></form>${name ? `<p>Sesión actual de ${escape(name)}.</p><a href="${escape(dashboard)}">Abrir el panel</a>` : ''}`;
  const script = `
const error = document.querySelector('#error');
const query = location.search.slice(1);
const dashboard = ${JSON.stringify(dashboard).replace(/</g, '\\u003c')};
async function post(path, body) {
  const response = await fetch(path, {method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify(body)});
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const failure = new Error('No se pudo completar la solicitud. Revisa tus datos e inténtalo de nuevo.');
    failure.status = response.status;
    failure.retryAt = ['X-Retry-After', 'Retry-After'].map(name => {
      const retry = response.headers.get(name);
      const seconds = retry && /^\\d+(?:\\.\\d+)?$/.test(retry.trim()) ? Number(retry) : NaN;
      return Number.isFinite(seconds) ? Date.now() + seconds * 1000 : Date.parse(retry || '');
    }).find(Number.isFinite);
    throw failure;
  }
  return result;
}
const signIn = document.querySelector('#signin');
if (signIn) {
  const email = document.querySelector('#email');
  const password = document.querySelector('#password');
  const continuation = document.querySelector('#continuation');
  const codeForm = document.querySelector('#email-code');
  const otp = document.querySelector('#otp');
  const codeError = document.querySelector('#code-error');
  const requestCode = document.querySelector('#request-code');
  const resendCode = document.querySelector('#resend-code');
  const back = document.querySelector('#back-password');
  const state = {phase:'password', email:'', retryAt:{request:0, redeem:0}};
  let retryTimer;
  function render() {
    clearTimeout(retryTimer);
    const code = ['code', 'redeeming', 'sendingAgain'].includes(state.phase);
    const continuing = ['continuing', 'continuationFailed'].includes(state.phase);
    const busy = ['passwordSubmitting', 'sending', 'sendingAgain', 'redeeming', 'continuing'].includes(state.phase);
    signIn.hidden = code || continuing;
    signIn.setAttribute('aria-busy', String(busy));
    for (const control of signIn.elements) control.disabled = busy || code || continuing;
    continuation.hidden = state.phase !== 'continuationFailed';
    continuation.querySelector('button').disabled = state.phase !== 'continuationFailed';
    if (!codeForm) return;
    codeForm.hidden = continuing;
    codeForm.setAttribute('aria-busy', String(busy));
    requestCode.hidden = code;
    requestCode.type = code ? 'button' : 'submit';
    requestCode.disabled = busy || code || continuing || Date.now() < state.retryAt.request;
    requestCode.textContent = state.phase === 'sending' ? 'Solicitando código…' : 'Recibir código';
    document.querySelector('#code-fields').hidden = !code;
    document.querySelector('#code-fields').disabled = !code || busy;
    otp.disabled = !code || busy;
    codeForm.querySelector('#code-fields > button').disabled = !code || busy || Date.now() < state.retryAt.redeem;
    codeForm.querySelector('#code-fields > button').textContent = state.phase === 'redeeming' ? 'Verificando…' : 'Iniciar sesión';
    resendCode.disabled = !code || busy || Date.now() < state.retryAt.request;
    back.disabled = !code || busy;
    const deadlines = Object.values(state.retryAt).filter(deadline => deadline > Date.now());
    if (deadlines.length) retryTimer = setTimeout(render, Math.min(...deadlines) - Date.now() + 20);
  }
  function clearSecrets() { password.value = ''; if (otp) otp.value = ''; }
  async function continueAfterSignIn() {
    state.phase = 'continuing';
    clearSecrets();
    error.textContent = '';
    render();
    try {
      if (!query) { location.assign(dashboard); return; }
      const result = await post('/api/auth/oauth2/continue', {postLogin:true, oauth_query:query});
      location.assign(result.url || result.redirect_uri);
    } catch {
      state.phase = 'continuationFailed';
      error.textContent = 'No se pudo continuar. Inténtalo de nuevo.';
      render();
      continuation.querySelector('button').focus();
    }
  }
  continuation.addEventListener('submit', event => {
    event.preventDefault();
    if (state.phase === 'continuationFailed') void continueAfterSignIn();
  });
  signIn.addEventListener('submit', async event => {
    event.preventDefault();
    if (state.phase !== 'password') return;
    state.phase = 'passwordSubmitting';
    error.textContent = '';
    const body = {email:email.value, password:password.value};
    render();
    try {
      await post('/api/auth/sign-in/email', body);
      await continueAfterSignIn();
    } catch (failure) {
      state.phase = 'password';
      error.textContent = 'No se pudo completar la solicitud. Revisa tus datos e inténtalo de nuevo.';
      render();
    }
  });
  ${emailCodeEnabled ? `async function sendCode() {
    if (!['password', 'code'].includes(state.phase) || Date.now() < state.retryAt.request) return;
    if (state.phase === 'password' && !email.reportValidity()) return;
    const previous = state.phase;
    if (previous === 'password') state.email = email.value;
    state.phase = previous === 'code' ? 'sendingAgain' : 'sending';
    clearSecrets();
    codeError.textContent = '';
    otp.removeAttribute('aria-invalid');
    error.textContent = '';
    render();
    try {
      await post('/api/auth/email-otp/send-verification-otp', {email:state.email, type:'sign-in'});
      state.phase = 'code';
      document.querySelector('#code-email').textContent = state.email;
      render();
      otp.focus();
    } catch (failure) {
      state.phase = previous;
      showFailure(failure, 'request');
      render();
    }
  }
  function showFailure(failure, action) {
    if (failure.status === 429) {
      if (Number.isFinite(failure.retryAt) && failure.retryAt > Date.now()) state.retryAt[action] = failure.retryAt;
      error.textContent = 'Has hecho demasiados intentos. Espera un momento y vuelve a intentarlo.';
    } else if (action === 'redeem' && failure.status === 400) {
      codeError.textContent = 'El código no es válido o ha vencido. Revisa el código o solicita otro.';
      otp.setAttribute('aria-invalid', 'true');
    } else error.textContent = 'No se pudo completar la solicitud. Revisa tus datos e inténtalo de nuevo.';
  }
  codeForm.addEventListener('submit', async event => {
    event.preventDefault();
    if (state.phase === 'password') { await sendCode(); return; }
    if (state.phase !== 'code' || Date.now() < state.retryAt.redeem) return;
    const body = {email:state.email, otp:otp.value};
    state.phase = 'redeeming';
    error.textContent = '';
    codeError.textContent = '';
    otp.removeAttribute('aria-invalid');
    render();
    try {
      await post('/api/auth/sign-in/email-otp', body);
      await continueAfterSignIn();
    } catch (failure) {
      state.phase = 'code';
      showFailure(failure, 'redeem');
      render();
      otp.focus();
    }
  });
  resendCode.addEventListener('click', () => void sendCode());
  back.addEventListener('click', () => {
    if (state.phase !== 'code') return;
    state.phase = 'password';
    clearSecrets();
    error.textContent = '';
    codeError.textContent = '';
    otp.removeAttribute('aria-invalid');
    render();
    password.focus();
  });` : ''}
  render();
}
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
:root{font-family:Optima,Candara,'Segoe UI',sans-serif;color:#132943;background:#eaf0f5}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;grid-template-columns:minmax(220px,1fr) minmax(320px,1.4fr)}aside{padding:clamp(28px,6vw,90px);display:flex;flex-direction:column;justify-content:space-between;background:#dce6ef;border-right:1px solid #c7d5e3}aside strong{font-size:28px;font-weight:600;letter-spacing:-1px}.mark{font-family:Georgia,serif;font-size:clamp(140px,20vw,300px);line-height:1;color:#3154d9}aside p{max-width:25ch;line-height:1.5}main{align-self:center;padding:48px clamp(28px,7vw,110px);max-width:690px}h1{font-size:clamp(30px,4vw,44px);font-weight:500;line-height:1.1;letter-spacing:-1px;margin:0 0 24px}p,li{line-height:1.6}[hidden]{display:none!important}fieldset{border:0;padding:0;margin:0;min-width:0;display:grid;gap:12px}#code-email{overflow-wrap:anywhere}#code-status{font-weight:600;margin:0}#code-hint{margin:0}button:disabled{opacity:.55;cursor:default}.field-error{color:#a32035;margin:0}.field-error:empty{display:none}form{display:grid;gap:12px;margin:28px 0}input{font:inherit;padding:13px;background:white;border:1px solid #9baec2;border-radius:4px;width:100%}button{font:inherit;font-weight:600;background:#3154d9;color:white;border:0;border-radius:4px;padding:14px 20px;cursor:pointer;margin-top:8px}.secondary{background:transparent;border:1px solid #9baec2;color:#132943}a{color:#2546c0}input:focus-visible,button:focus-visible,a:focus-visible{outline:3px solid #6885ff;outline-offset:3px}#error{color:#a32035;min-height:24px}@media(max-width:650px){body{display:block}aside{padding:24px;border-right:0;border-bottom:1px solid #c7d5e3}aside .mark,aside p{display:none}main{padding:40px 24px}}</style></head><body><aside><strong>Artifacts</strong><div class="mark" aria-hidden="true">a.</div><p>Un espacio propio para lo que creas.</p></aside><main><h1>${title}</h1>${content}<p id="error" role="alert"></p></main><script>${script}</script></body></html>`, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'same-origin' } });
}
