// POST /api/notify — Envía una notificación a todos los dispositivos registrados.
// Solo funciona con la sesión del administrador (correo incluido en ADMIN_EMAILS).
const g = require('./_lib/google');

const limpiar = (s, max) => String(s || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.statusCode = 405; return res.json ? res.json({ error: 'Método no permitido' }) : res.end(); }
  try {
    const auth = String(req.headers.authorization || '');
    const idToken = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    const correo = await g.correoDeSesion(idToken);
    if (!correo) { res.statusCode = 401; return res.json({ error: 'Sesión no válida. Inicia sesión de nuevo.' }); }
    if (!g.esAdministrador(correo)) { res.statusCode = 403; return res.json({ error: 'Este correo no está autorizado para enviar notificaciones (ADMIN_EMAILS).' }); }

    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
    body = body || {};
    const titulo = limpiar(body.titulo, 80);
    const aviso = {
      title: '📅 Programación actualizada',
      body: titulo ? `${titulo}. Toca para ver quién sirve esta semana.` : 'Hay cambios en la programación. Toca para ver quién sirve esta semana.',
      url: '/?programacion=1',
      tag: 'programacion'
    };

    const sa = g.leerCuentaServicio();
    const at = await g.tokenDeAcceso(sa);
    const r = await g.enviarATodos(sa, at, aviso);
    res.statusCode = 200;
    return res.json({ ok: true, ...r });
  } catch (e) {
    console.error(e);
    res.statusCode = e.status || 500;
    return res.json({ error: e.message || 'Error interno' });
  }
};
