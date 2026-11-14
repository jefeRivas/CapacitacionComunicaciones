// POST /api/inventario — Inventario de equipos.
//
// Los datos del inventario se guardan en artifacts/{appId}/public/data/config/inventario (todos pueden leerlos en vivo).
// Nadie escribe ahí directamente desde la app: todo pasa por esta función, que usa la cuenta de servicio.
//
// Acciones públicas (cualquier miembro, con el código del grupo):
//   · reportar        { equipoId, autor, texto, codigo }
// Acciones del administrador (sesión de Firebase con correo en ADMIN_EMAILS):
//   · guardarEquipo   { equipo }                       crea o modifica
//   · eliminarEquipo  { id }
//   · resolverReporte { reporteId, nota, estadoFinal }
//   · eliminarReporte { reporteId }
//   · cambiarCodigo   { codigo }                       código que piden los reportes
//   · estado          { dispositivoId }                ¿hay código? ¿este celular recibe avisos de reportes?
//   · registrarAvisos { dispositivoId }                este celular recibe los avisos de nuevos reportes
//
// Lo privado (código del grupo, intentos fallidos, celulares del administrador) se guarda en
// artifacts/{appId}/privado/inventario, que la app no puede leer.
const crypto = require('crypto');
const g = require('./_lib/google');

const RUTA_INV = `artifacts/${g.APP_ID}/public/data/config/inventario`;
const RUTA_PRIV = `artifacts/${g.APP_ID}/privado/inventario`;
const RUTA_DISP = `artifacts/${g.APP_ID}/public/data/dispositivos`;

const ESTADOS = ['bueno', 'novedad', 'malo'];
const MAX_EQUIPOS = 500, MAX_ABIERTOS_POR_EQUIPO = 20, MAX_RESUELTOS = 300;
const MAX_FALLOS = 5, BLOQUEO_MS = 15 * 60 * 1000;

const error = (status, msg) => Object.assign(new Error(msg), { status });
const texto = (s, max) => String(s == null ? '' : s).replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ').trim().slice(0, max);
const nuevoId = (p) => p + Date.now().toString(36) + crypto.randomBytes(3).toString('hex');
const hashCodigo = (sal, codigo) => crypto.createHash('sha256').update(sal + ':' + String(codigo).trim().toLowerCase()).digest('hex');

function limpiarEquipo(e) {
  const nombre = texto(e.nombre, 80);
  if (!nombre) throw error(400, 'El equipo necesita un nombre.');
  const fecha = texto(e.fechaIngreso, 10);
  if (fecha && (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || isNaN(Date.parse(fecha)))) throw error(400, 'La fecha de ingreso no es válida.');
  const cantidad = Math.round(Number(e.cantidad));
  return {
    codigo: texto(e.codigo, 20).toUpperCase().replace(/[^A-Z0-9-]/g, ''),
    nombre,
    categoria: texto(e.categoria, 40) || 'Otros',
    marca: texto(e.marca, 60),
    referencia: texto(e.referencia, 60),
    serie: texto(e.serie, 60),
    ubicacion: texto(e.ubicacion, 60),
    cantidad: Number.isFinite(cantidad) && cantidad >= 1 ? Math.min(cantidad, 9999) : 1,
    fechaIngreso: fecha,
    estado: ESTADOS.includes(e.estado) ? e.estado : 'bueno',
    enUso: !!e.enUso,
    observaciones: texto(e.observaciones, 500)
  };
}

const inventarioVacio = () => ({ equipos: [], reportes: [] });
const normalizar = (d) => ({ ...inventarioVacio(), ...(d || {}), equipos: Array.isArray(d && d.equipos) ? d.equipos : [], reportes: Array.isArray(d && d.reportes) ? d.reportes : [] });

// Conserva todos los reportes abiertos y los resueltos más recientes.
function podarReportes(reportes) {
  const abiertos = reportes.filter(r => r.estado !== 'resuelto');
  const resueltos = reportes.filter(r => r.estado === 'resuelto').sort((a, b) => (b.resuelto || 0) - (a.resuelto || 0)).slice(0, MAX_RESUELTOS);
  return [...abiertos, ...resueltos].sort((a, b) => (b.fecha || 0) - (a.fecha || 0));
}

async function correoAdmin(req) {
  const auth = String(req.headers.authorization || '');
  const correo = await g.correoDeSesion(auth.startsWith('Bearer ') ? auth.slice(7) : '');
  if (!correo) throw error(401, 'Sesión no válida. Inicia sesión de nuevo.');
  if (!g.esAdministrador(correo)) throw error(403, 'Este correo no está autorizado como administrador (ADMIN_EMAILS).');
  return correo;
}

function ipDe(req) {
  const xf = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return xf || String(req.headers['x-real-ip'] || (req.socket && req.socket.remoteAddress) || 'desconocida');
}

// Avisa a los celulares del administrador que hay un reporte nuevo.
async function avisarAdministrador(sa, at, aviso) {
  const priv = (await g.leerDocumento(sa.project_id, at, RUTA_PRIV)) || {};
  const ids = Array.isArray(priv.adminDispositivos) ? priv.adminDispositivos : [];
  const vencidos = [];
  let enviados = 0;
  for (const id of ids) {
    const d = await g.leerDocumento(sa.project_id, at, `${RUTA_DISP}/${id}`);
    if (!d || !d.token) { vencidos.push(id); continue; }
    const r = await g.enviarPush(sa.project_id, at, d.token, aviso).catch(() => 'error');
    if (r === 'ok') enviados++;
    else if (r === 'invalido') { vencidos.push(id); await g.borrarDocumento(`projects/${sa.project_id}/databases/(default)/documents/${RUTA_DISP}/${id}`, at); }
  }
  if (vencidos.length) await g.modificarDocumento(sa.project_id, at, RUTA_PRIV, (p) => ({ ...(p || {}), adminDispositivos: ((p && p.adminDispositivos) || []).filter(x => !vencidos.includes(x)) }));
  return enviados;
}

async function reportar(sa, at, body, req) {
  const equipoId = texto(body.equipoId, 60), autor = texto(body.autor, 60), detalle = texto(body.texto, 300), codigo = texto(body.codigo, 40);
  if (autor.length < 2) throw error(400, 'Escribe tu nombre.');
  if (detalle.length < 3) throw error(400, 'Describe la novedad (mínimo 3 caracteres).');

  // Código del grupo, con bloqueo temporal tras varios intentos fallidos desde la misma conexión.
  const ahora = Date.now();
  const priv = (await g.leerDocumento(sa.project_id, at, RUTA_PRIV)) || {};
  if (!priv.codigoHash || !priv.codigoSal) throw error(409, 'El administrador aún no ha definido el código para reportar. Avísale al líder del equipo.');
  const ipId = crypto.createHash('sha256').update(priv.codigoSal + ':' + ipDe(req)).digest('hex').slice(0, 16);
  const f = (priv.fallos || {})[ipId];
  if (f && f.n >= MAX_FALLOS && ahora - f.t < BLOQUEO_MS) throw error(429, 'Demasiados intentos con un código incorrecto. Espera 15 minutos e inténtalo de nuevo.');
  if (hashCodigo(priv.codigoSal, codigo) !== priv.codigoHash) {
    await g.modificarDocumento(sa.project_id, at, RUTA_PRIV, (p) => {
      const fallos = Object.fromEntries(Object.entries((p && p.fallos) || {}).filter(([, v]) => ahora - v.t < BLOQUEO_MS));
      const prev = fallos[ipId] && ahora - fallos[ipId].t < BLOQUEO_MS ? fallos[ipId].n : 0;
      fallos[ipId] = { n: prev + 1, t: ahora };
      return { ...(p || {}), fallos };
    });
    throw error(403, 'El código del grupo no es correcto.');
  }

  let reporte, equipo;
  await g.modificarDocumento(sa.project_id, at, RUTA_INV, (d) => {
    const inv = normalizar(d);
    equipo = inv.equipos.find(e => e.id === equipoId);
    if (!equipo) throw error(404, 'Ese equipo ya no existe en el inventario.');
    if (inv.reportes.filter(r => r.equipoId === equipoId && r.estado !== 'resuelto').length >= MAX_ABIERTOS_POR_EQUIPO) throw error(429, 'Este equipo ya tiene muchas novedades abiertas. Avísale al administrador.');
    reporte = { id: nuevoId('r'), equipoId, autor, texto: detalle, fecha: ahora, estado: 'abierto' };
    const equipos = inv.equipos.map(e => e.id === equipoId && e.estado !== 'malo' ? { ...e, estado: 'novedad', actualizado: ahora } : e);
    return { ...inv, equipos, reportes: podarReportes([reporte, ...inv.reportes]), actualizado: ahora };
  });

  let avisados = 0;
  try {
    avisados = await avisarAdministrador(sa, at, {
      title: `🛠️ Novedad: ${(equipo.codigo ? equipo.codigo + ' · ' : '') + equipo.nombre}`.slice(0, 120),
      body: `${autor}: ${detalle}`.slice(0, 200),
      url: '/?inventario=1', tag: 'inventario-' + equipoId
    });
  } catch (e) { console.error('No se pudo avisar al administrador', e); }
  return { ok: true, reporte, avisados };
}

async function accionAdmin(accion, sa, at, body, correo) {
  const ahora = Date.now();
  switch (accion) {
    case 'guardarEquipo': {
      const datos = limpiarEquipo(body.equipo || {});
      const id = texto(body.equipo && body.equipo.id, 60);
      let guardado;
      await g.modificarDocumento(sa.project_id, at, RUTA_INV, (d) => {
        const inv = normalizar(d);
        if (datos.codigo && inv.equipos.some(e => e.id !== id && String(e.codigo || '').toUpperCase() === datos.codigo)) throw error(409, `Ya existe otro equipo con el código ${datos.codigo}.`);
        let equipos;
        if (id && inv.equipos.some(e => e.id === id)) {
          equipos = inv.equipos.map(e => e.id === id ? (guardado = { ...e, ...datos, actualizado: ahora }) : e);
        } else {
          if (inv.equipos.length >= MAX_EQUIPOS) throw error(400, 'Se alcanzó el máximo de equipos del inventario.');
          guardado = { id: nuevoId('q'), ...datos, creado: ahora, actualizado: ahora };
          equipos = [...inv.equipos, guardado];
        }
        return { ...inv, equipos, actualizado: ahora };
      });
      return { ok: true, equipo: guardado };
    }
    case 'eliminarEquipo': {
      const id = texto(body.id, 60);
      await g.modificarDocumento(sa.project_id, at, RUTA_INV, (d) => {
        const inv = normalizar(d);
        if (!inv.equipos.some(e => e.id === id)) throw error(404, 'Ese equipo ya no existe.');
        return { ...inv, equipos: inv.equipos.filter(e => e.id !== id), reportes: inv.reportes.filter(r => r.equipoId !== id), actualizado: ahora };
      });
      return { ok: true };
    }
    case 'resolverReporte': {
      const rid = texto(body.reporteId, 60), nota = texto(body.nota, 300);
      const estadoFinal = ESTADOS.includes(body.estadoFinal) ? body.estadoFinal : null;
      await g.modificarDocumento(sa.project_id, at, RUTA_INV, (d) => {
        const inv = normalizar(d);
        const rep = inv.reportes.find(r => r.id === rid);
        if (!rep) throw error(404, 'Ese reporte ya no existe.');
        const reportes = inv.reportes.map(r => r.id === rid ? { ...r, estado: 'resuelto', resuelto: ahora, nota, resueltoPor: correo } : r);
        const equipos = estadoFinal ? inv.equipos.map(e => e.id === rep.equipoId ? { ...e, estado: estadoFinal, actualizado: ahora } : e) : inv.equipos;
        return { ...inv, equipos, reportes: podarReportes(reportes), actualizado: ahora };
      });
      return { ok: true };
    }
    case 'eliminarReporte': {
      const rid = texto(body.reporteId, 60);
      await g.modificarDocumento(sa.project_id, at, RUTA_INV, (d) => {
        const inv = normalizar(d);
        if (!inv.reportes.some(r => r.id === rid)) throw error(404, 'Ese reporte ya no existe.');
        return { ...inv, reportes: inv.reportes.filter(r => r.id !== rid), actualizado: ahora };
      });
      return { ok: true };
    }
    case 'cambiarCodigo': {
      const codigo = texto(body.codigo, 40);
      if (codigo.length < 4 || codigo.length > 12 || !/^[A-Za-z0-9]+$/.test(codigo)) throw error(400, 'El código debe tener entre 4 y 12 letras o números, sin espacios.');
      const sal = crypto.randomBytes(16).toString('hex');
      await g.modificarDocumento(sa.project_id, at, RUTA_PRIV, (p) => ({ ...(p || {}), codigoSal: sal, codigoHash: hashCodigo(sal, codigo), codigoCambiado: ahora, fallos: {} }));
      return { ok: true };
    }
    case 'estado': {
      const priv = (await g.leerDocumento(sa.project_id, at, RUTA_PRIV)) || {};
      const id = texto(body.dispositivoId, 60);
      return { ok: true, codigoDefinido: !!priv.codigoHash, avisosEnEsteDispositivo: !!id && (priv.adminDispositivos || []).includes(id) };
    }
    case 'registrarAvisos': {
      const id = texto(body.dispositivoId, 60);
      if (!/^[0-9a-f]{40}$/.test(id)) throw error(400, 'Activa primero las notificaciones (campana) en este celular.');
      const disp = await g.leerDocumento(sa.project_id, at, `${RUTA_DISP}/${id}`);
      if (!disp || !disp.token) throw error(404, 'Activa primero las notificaciones (campana) en este celular.');
      await g.modificarDocumento(sa.project_id, at, RUTA_PRIV, (p) => {
        const lista = ((p && p.adminDispositivos) || []).filter(x => x !== id);
        return { ...(p || {}), adminDispositivos: [...lista, id].slice(-5) };
      });
      return { ok: true };
    }
    default:
      throw error(400, 'Acción no válida.');
  }
}

async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.statusCode = 405; return res.json({ error: 'Método no permitido' }); }
  try {
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
    body = body || {};
    const accion = String(body.accion || '');
    let correo = null;
    if (accion !== 'reportar') correo = await correoAdmin(req);
    const sa = g.leerCuentaServicio();
    const at = await g.tokenDeAcceso(sa);
    const r = accion === 'reportar' ? await reportar(sa, at, body, req) : await accionAdmin(accion, sa, at, body, correo);
    res.statusCode = 200;
    return res.json(r);
  } catch (e) {
    if (!e.status || e.status >= 500) console.error(e);
    res.statusCode = e.status || 500;
    return res.json({ error: e.message || 'Error interno' });
  }
}

module.exports = handler;
module.exports.limpiarEquipo = limpiarEquipo;
module.exports.podarReportes = podarReportes;
