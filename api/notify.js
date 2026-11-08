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
    const dispositivos = await g.listarDispositivos(sa.project_id, at);

    let enviados = 0, eliminados = 0, fallidos = 0;
    for (let i = 0; i < dispositivos.length; i += 25) {
      const grupo = dispositivos.slice(i, i + 25);
      const resultados = await Promise.all(grupo.map((d) => g.enviarPush(sa.project_id, at, d.token, aviso).catch(() => 'error')));
      await Promise.all(resultados.map((r, k) => {
        if (r === 'ok') enviados++;
        else if (r === 'invalido') { eliminados++; return g.borrarDocumento(grupo[k].nombre, at); }
        else fallidos++;
        return null;
      }));
    }
    res.statusCode = 200;
    return res.json({ ok: true, total: dispositivos.length, enviados, eliminados, fallidos });
  } catch (e) {
    console.error(e);
    res.statusCode = e.status || 500;
    return res.json({ error: e.message || 'Error interno' });
  }
};
