// GET/POST /api/recordatorios — Envía los recordatorios de eventos que ya correspondan:
//   · "24 horas antes": desde 24 h antes hasta 3 h antes del evento.
//   · "1 hora antes":   desde 60 min antes hasta la hora del evento.
// Lo llama GitHub Actions cada 10 minutos (.github/workflows/recordatorios.yml).
// Es seguro llamarlo cuantas veces sea: cada recordatorio se registra en Firestore
// (public/data/recordatorios) antes de enviarse y nunca se envía dos veces.
const g = require('./_lib/google');

// Zona horaria de los eventos (Colombia, UTC-5, sin horario de verano).
const ZONA_OFFSET = '-05:00';
const ZONA_IANA = 'America/Bogota';

const HORA = 3600 * 1000;
const VENTANAS = [
  { tipo: '24h', desde: 24 * HORA, hasta: 3 * HORA },
  { tipo: '1h', desde: 1 * HORA, hasta: 0 }
];

function inicioEvento(e) {
  if (!e || !/^\d{4}-\d{2}-\d{2}$/.test(e.fecha || '') || !/^\d{2}:\d{2}$/.test(e.hora || '')) return NaN;
  return Date.parse(`${e.fecha}T${e.hora}:00${ZONA_OFFSET}`);
}

const fechaLocal = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: ZONA_IANA, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
const horaTexto = (ms) => new Intl.DateTimeFormat('es-CO', { timeZone: ZONA_IANA, hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(ms)).replace(/\s+/g, ' ');
const diaTexto = (ms) => new Intl.DateTimeFormat('es-CO', { timeZone: ZONA_IANA, weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(ms));

function cuandoTexto(t, ahora) {
  const hoy = fechaLocal(ahora), dia = fechaLocal(t), manana = fechaLocal(ahora + 24 * HORA);
  if (dia === hoy) return `Hoy a las ${horaTexto(t)}`;
  if (dia === manana) return `Mañana ${diaTexto(t)} a las ${horaTexto(t)}`;
  return `El ${diaTexto(t)} a las ${horaTexto(t)}`;
}

function armarAviso(e, tipo, t, ahora) {
  const titulo = String(e.titulo || 'Evento').trim().slice(0, 80);
  const desc = String(e.descripcion || '').replace(/\s+/g, ' ').trim().slice(0, 120);
  if (tipo === '1h') {
    const min = Math.max(1, Math.round((t - ahora) / 60000));
    return {
      title: `⏰ ${titulo}`,
      body: `Empieza en ${min >= 55 ? '1 hora' : min + ' minutos'} (${horaTexto(t)}).` + (desc ? ' ' + desc : ''),
      url: '/?programacion=1', tag: 'evento-' + e.id
    };
  }
  return {
    title: `📅 Recordatorio: ${titulo}`,
    body: ((c) => c + (c.endsWith('.') ? '' : '.'))(cuandoTexto(t, ahora)) + (desc ? ' ' + desc : ''),
    url: '/?programacion=1', tag: 'evento-' + e.id
  };
}

// Decide qué recordatorios tocan ahora (función pura, se prueba por separado).
function pendientes(eventos, ahora) {
  const out = [];
  for (const e of Array.isArray(eventos) ? eventos : []) {
    if (!e || !e.id || !String(e.titulo || '').trim()) continue;
    const t = inicioEvento(e);
    if (!Number.isFinite(t)) continue;
    for (const v of VENTANAS) {
      if (ahora >= t - v.desde && ahora < t - v.hasta) {
        out.push({ evento: e, tipo: v.tipo, inicio: t, id: `${String(e.id).replace(/[^A-Za-z0-9_-]/g, '')}-${v.tipo}-${t}` });
      }
    }
  }
  return out;
}

async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET' && req.method !== 'POST') { res.statusCode = 405; return res.json({ error: 'Método no permitido' }); }
  try {
    const ahora = Date.now();
    const sa = g.leerCuentaServicio();
    const at = await g.tokenDeAcceso(sa);
    const semana = await g.leerDocumento(sa.project_id, at, `artifacts/${g.APP_ID}/public/data/config/semana`);
    const lista = pendientes(semana && semana.eventos, ahora);
    const resultado = [];
    for (const p of lista) {
      // Primero se "reserva" el recordatorio; si ya existía, otro llamado ya lo envió.
      const nuevo = await g.crearSiNoExiste(sa.project_id, at, `artifacts/${g.APP_ID}/public/data/recordatorios`, p.id,
        { evento: p.evento.id, tipo: p.tipo, inicio: p.inicio, enviado: ahora });
      if (!nuevo) continue;
      const r = await g.enviarATodos(sa, at, armarAviso(p.evento, p.tipo, p.inicio, ahora));
      resultado.push({ evento: p.evento.titulo, tipo: p.tipo, ...r });
    }
    res.statusCode = 200;
    return res.json({ ok: true, revisados: (semana && Array.isArray(semana.eventos)) ? semana.eventos.length : 0, enviados: resultado });
  } catch (e) {
    console.error(e);
    res.statusCode = e.status || 500;
    return res.json({ error: e.message || 'Error interno' });
  }
}

module.exports = handler;
module.exports.pendientes = pendientes;
module.exports.armarAviso = armarAviso;
module.exports.inicioEvento = inicioEvento;
