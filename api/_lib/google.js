// Utilidades para hablar con Google/Firebase desde las funciones de Vercel, sin dependencias externas.
const crypto = require('crypto');

const APP_ID = 'comunicaciones-app';
const FIREBASE_WEB_API_KEY = 'AIzaSyBP6OvaJJopQCn2PgHvWMXeQAwSoLK-7A0'; // clave pública (la misma de index.html)

// Lee la cuenta de servicio de la variable FIREBASE_SERVICE_ACCOUNT.
// Es tolerante a lo que suele pasar al copiar y pegar el archivo .json en Vercel: saltos de línea reales dentro
// de la clave privada, saltos de línea de Windows, comillas "curvas", comillas o texto alrededor, contenido en
// base64, etc. Si el JSON no se puede leer, extrae directamente los 3 datos que se necesitan.
const errorCuenta = (msg) => Object.assign(new Error(msg), { status: 500 });

function normalizarClave(pk) {
  const txt = String(pk || '').replace(/\\r/g, '').replace(/\\n/g, '\n');
  const m = txt.match(/-----BEGIN ([A-Z ]*)PRIVATE KEY-----([\s\S]*?)-----END \1PRIVATE KEY-----/);
  if (!m) return null;
  const cuerpo = m[2].replace(/\\[nr]/g, '').replace(/[^A-Za-z0-9+/=]/g, '');
  if (cuerpo.length < 100) return null;
  const tipo = m[1];
  return `-----BEGIN ${tipo}PRIVATE KEY-----\n${cuerpo.match(/.{1,64}/g).join('\n')}\n-----END ${tipo}PRIVATE KEY-----\n`;
}

// Escapa los caracteres de control (saltos de línea, tabulaciones) que quedaron DENTRO de los textos del JSON.
function escaparControlesEnTextos(t) {
  let out = '', enTexto = false, esc = false;
  for (const ch of t) {
    if (enTexto) {
      if (esc) { esc = false; out += ch; continue; }
      if (ch === '\\') { esc = true; out += ch; continue; }
      if (ch === '"') { enTexto = false; out += ch; continue; }
      if (ch === '\n') { out += '\\n'; continue; }
      if (ch === '\r') continue;
      if (ch === '\t') { out += '\\t'; continue; }
      out += ch;
    } else {
      if (ch === '"') enTexto = true;
      out += ch;
    }
  }
  return out;
}

function intentarJSON(t) {
  try { let v = JSON.parse(t); if (typeof v === 'string') v = JSON.parse(v); return v && typeof v === 'object' ? v : null; } catch (e) { return null; }
}

function leerCuentaServicio() {
  let raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw || !raw.trim()) throw errorCuenta('Falta la variable FIREBASE_SERVICE_ACCOUNT en Vercel.');
  raw = raw.replace(/^﻿/, '').trim()
    .replace(/^FIREBASE_SERVICE_ACCOUNT\s*=\s*/, '')          // si se pegó como línea "NOMBRE=valor"
    .replace(/[“”„‟″]/g, '"')         // comillas curvas → rectas
    .replace(/[ ​﻿]/g, ' ');                     // espacios invisibles
  if (/^'[\s\S]*'$/.test(raw) || /^`[\s\S]*`$/.test(raw)) raw = raw.slice(1, -1).trim();

  const candidatos = [raw, escaparControlesEnTextos(raw)];
  const i = raw.indexOf('{'), j = raw.lastIndexOf('}');
  if (i >= 0 && j > i) { const centro = raw.slice(i, j + 1); candidatos.push(centro, escaparControlesEnTextos(centro)); }
  if (!raw.includes('{')) { try { candidatos.push(Buffer.from(raw, 'base64').toString('utf8')); } catch (e) {} }

  let sa = null;
  for (const c of candidatos) { sa = intentarJSON(c); if (sa) break; }

  // Último recurso: extraer los datos aunque el JSON esté dañado.
  if (!sa) {
    const campo = (n) => { const m = raw.match(new RegExp('"' + n + '"\\s*:\\s*"([^"]*)"')); return m ? m[1] : ''; };
    const pk = raw.match(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/);
    sa = { project_id: campo('project_id'), client_email: campo('client_email'), private_key: pk ? pk[0] : '' };
  }

  const faltan = [];
  if (!sa.project_id) faltan.push('project_id');
  if (!sa.client_email) faltan.push('client_email');
  const clave = normalizarClave(sa.private_key);
  if (!clave) faltan.push('private_key');
  if (faltan.length) throw errorCuenta('FIREBASE_SERVICE_ACCOUNT no es un JSON válido: no se encontró ' + faltan.join(', ') + '. Vuelve a pegar el archivo .json completo (desde la { inicial hasta la } final).');
  try { crypto.createPrivateKey(clave); } catch (e) {
    throw errorCuenta('FIREBASE_SERVICE_ACCOUNT: la clave privada (private_key) está incompleta o dañada. Vuelve a pegar el archivo .json completo, o genera una clave nueva en Firebase.');
  }
  return { project_id: String(sa.project_id).trim(), client_email: String(sa.client_email).trim(), private_key: clave };
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
