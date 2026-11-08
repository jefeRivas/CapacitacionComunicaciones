// Utilidades para hablar con Google/Firebase desde las funciones de Vercel, sin dependencias externas.
const crypto = require('crypto');

const APP_ID = 'comunicaciones-app';
const FIREBASE_WEB_API_KEY = 'AIzaSyBP6OvaJJopQCn2PgHvWMXeQAwSoLK-7A0'; // clave pública (la misma de index.html)

function leerCuentaServicio() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) throw Object.assign(new Error('Falta la variable FIREBASE_SERVICE_ACCOUNT en Vercel.'), { status: 500 });
  let sa;
  try { sa = JSON.parse(raw); } catch (e) {
    try { sa = JSON.parse(Buffer.from(raw, 'base64').toString('utf8')); } catch (e2) {
      throw Object.assign(new Error('FIREBASE_SERVICE_ACCOUNT no es un JSON válido.'), { status: 500 });
    }
  }
  if (!sa.client_email || !sa.private_key || !sa.project_id) throw Object.assign(new Error('FIREBASE_SERVICE_ACCOUNT incompleta.'), { status: 500 });
  sa.private_key = sa.private_key.replace(/\\n/g, '\n');
  return sa;
}

const b64url = (b) => Buffer.from(b).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

function firmarJWT(sa, scope, now = Math.floor(Date.now() / 1000)) {
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64url(JSON.stringify({ iss: sa.client_email, scope, aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }));
  const firma = crypto.createSign('RSA-SHA256').update(header + '.' + claim).sign(sa.private_key);
  return header + '.' + claim + '.' + b64url(firma);
}

async function tokenDeAcceso(sa) {
  const jwt = firmarJWT(sa, 'https://www.googleapis.com/auth/firebase.messaging https://www.googleapis.com/auth/datastore');
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=' + encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer') + '&assertion=' + jwt
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw Object.assign(new Error('Google rechazó la cuenta de servicio: ' + (j.error_description || j.error || r.status)), { status: 500 });
  return j.access_token;
}

// Valida el token de sesión de Firebase Auth del administrador y devuelve su correo.
async function correoDeSesion(idToken) {
  if (!idToken) return null;
  const r = await fetch('https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' + FIREBASE_WEB_API_KEY, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken })
  });
  if (!r.ok) return null;
  const j = await r.json().catch(() => ({}));
  const u = j.users && j.users[0];
  return u && u.email ? String(u.email).toLowerCase() : null;
}

function esAdministrador(correo) {
  const lista = String(process.env.ADMIN_EMAILS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  return !!correo && lista.includes(correo);
}

const rutaDispositivos = (projectId) =>
  `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/artifacts/${APP_ID}/public/data/dispositivos`;

async function listarDispositivos(projectId, accessToken) {
  const out = [];
  let pageToken = '';
  do {
    const url = rutaDispositivos(projectId) + '?pageSize=300' + (pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : '');
    const r = await fetch(url, { headers: { Authorization: 'Bearer ' + accessToken } });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error('No se pudo leer la lista de dispositivos: ' + ((j.error && j.error.message) || r.status)), { status: 500 });
    for (const d of j.documents || []) {
      const t = d.fields && d.fields.token && d.fields.token.stringValue;
      if (t) out.push({ nombre: d.name, token: t });
    }
    pageToken = j.nextPageToken || '';
  } while (pageToken);
  return out;
}

async function borrarDocumento(nombre, accessToken) {
  await fetch('https://firestore.googleapis.com/v1/' + nombre, { method: 'DELETE', headers: { Authorization: 'Bearer ' + accessToken } }).catch(() => null);
}

// Envía una notificación a un dispositivo. Devuelve 'ok', 'invalido' (token vencido: se debe borrar) o 'error'.
async function enviarPush(projectId, accessToken, token, aviso) {
  const r = await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: {
        token,
        data: { title: aviso.title, body: aviso.body, url: aviso.url, tag: aviso.tag },
        webpush: {
          headers: { Urgency: 'high', TTL: '86400' },
          notification: { title: aviso.title, body: aviso.body, icon: '/icons/icon-192.png', badge: '/icons/badge-96.png', tag: aviso.tag },
          fcm_options: { link: aviso.url }
        }
      }
    })
  });
  if (r.ok) return 'ok';
  const j = await r.json().catch(() => ({}));
  const st = (j.error && j.error.status) || '';
  const det = JSON.stringify((j.error && j.error.details) || []);
  if (r.status === 404 || st === 'NOT_FOUND' || /UNREGISTERED/.test(det) || (st === 'INVALID_ARGUMENT' && /token/i.test((j.error && j.error.message) || ''))) return 'invalido';
  return 'error';
}

module.exports = { APP_ID, leerCuentaServicio, firmarJWT, tokenDeAcceso, correoDeSesion, esAdministrador, listarDispositivos, borrarDocumento, enviarPush };
