// POST /api/notify — Envía una notificación a todos los dispositivos registrados.
// Solo funciona con la sesión del administrador (correo incluido en ADMIN_EMAILS).
//   · { titulo }                        → "Programación actualizada"
//   · { tipo: 'evento', evento: {...} } → aviso manual de un evento (botón en Configurar → Eventos)
//   · { tipo: 'cumple', miembros: [{ id, nombre }] } → felicitación de cumpleaños manual (Configurar)
const g = require('./_lib/google');
const rec = require('./recordatorios');

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
    let aviso;
    if (body.tipo === 'evento') {
      const ev = body.evento || {};
      const e = { id: limpiar(ev.id, 60).replace(/[^A-Za-z0-9_-]/g, '') || 'manual', titulo: limpiar(ev.titulo, 80), fecha: limpiar(ev.fecha, 10), hora: limpiar(ev.hora, 5), descripcion: limpiar(ev.descripcion, 300) };
      const t = rec.inicioEvento(e), ahora = Date.now();
      if (!e.titulo || !Number.isFinite(t)) { res.statusCode = 400; return res.json({ error: 'El evento necesita nombre, fecha y hora.' }); }
      if (t <= ahora) { res.statusCode = 400; return res.json({ error: 'Este evento ya empezó o ya pasó.' }); }
      aviso = rec.armarAviso(e, t - ahora <= 60 * 60 * 1000 ? '1h' : '24h', t, ahora);
    } else if (body.tipo === 'cumple') {
      // Felicitación manual (botón en Configurar). Deja registrado que ya se felicitó este año, para que el aviso
      // automático de las 11:00 a. m. no se repita.
      const miembros = (Array.isArray(body.miembros) ? body.miembros : []).slice(0, 20)
        .map(m => ({ id: limpiar(m && m.id, 60), nombre: limpiar(m && m.nombre, 60) })).filter(m => m.id && m.nombre);
      if (!miembros.length) { res.statusCode = 400; return res.json({ error: 'No hay a quién felicitar.' }); }
      const sa0 = g.leerCuentaServicio(), at0 = await g.tokenDeAcceso(sa0), c = rec.partesColombia(Date.now());
      for (const m of miembros) {
        await g.crearSiNoExiste(sa0.project_id, at0, `artifacts/${g.APP_ID}/public/data/recordatorios`, rec.idMarcaCumple(m, c.anio), { tipo: 'cumple', miembro: m.id, fecha: c.fecha, enviado: Date.now(), manual: 1 });
      }
      aviso = rec.armarAvisoCumple(miembros.map(m => m.nombre), c.fecha);
    } else {
      const titulo = limpiar(body.titulo, 80);
      aviso = {
        title: '📅 Programación actualizada',
        body: titulo ? `${titulo}. Toca para ver quién sirve esta semana.` : 'Hay cambios en la programación. Toca para ver quién sirve esta semana.',
        url: '/?programacion=1',
        tag: 'programacion'
      };
    }

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
