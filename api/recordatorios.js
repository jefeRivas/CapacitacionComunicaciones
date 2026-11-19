// GET/POST /api/recordatorios — Envía los recordatorios que ya correspondan:
//   · Eventos, "24 horas antes": desde 24 h antes hasta 3 h antes del evento.
//   · Eventos, "1 hora antes":   desde 60 min antes hasta la hora del evento.
//   · Cumpleaños del equipo (activos e inactivos): el mismo día, desde las 11:00 a. m. (hora de Colombia).
// Lo llaman: la tarea diaria de Vercel (11:00 a. m., vercel.json), GitHub Actions (.github/workflows/recordatorios.yml)
// y la app cada vez que alguien la abre.
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

// ---- Cumpleaños ----
const HORA_CUMPLE = 11;   // desde las 11:00 a. m. (Colombia)
const partesColombia = (ms) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: ZONA_IANA, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(ms)).map(x => [x.type, x.value]));
  return { fecha: `${p.year}-${p.month}-${p.day}`, anio: +p.year, md: `${p.month}-${p.day}`, hora: +p.hour };
};
const DIAS_MES = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const cumpleValido = (c) => { const x = /^(\d{2})-(\d{2})$/.exec(c || ''); return !!x && +x[1] >= 1 && +x[1] <= 12 && +x[2] >= 1 && +x[2] <= DIAS_MES[+x[1] - 1]; };
// Miembros (activos e inactivos: todos son parte del grupo) que cumplen años en la fecha dada. El 29 de febrero se celebra el 28 en años no bisiestos.
function cumpleanerosDe(miembros, fecha) {
  const anio = +fecha.slice(0, 4), md = fecha.slice(5);
  const bisiesto = (anio % 4 === 0 && anio % 100 !== 0) || anio % 400 === 0;
  return (Array.isArray(miembros) ? miembros : []).filter(m => m && m.id && String(m.nombre || '').trim() && cumpleValido(m.cumple)
    && (m.cumple === md || (!bisiesto && m.cumple === '02-29' && md === '02-28')));
}
const unirNombres = (n) => n.length <= 1 ? (n[0] || '') : n.slice(0, -1).join(', ') + ' y ' + n[n.length - 1];
function armarAvisoCumple(nombres, fecha) {
  const varios = nombres.length > 1;
  return {
    title: `🎂 ¡Hoy ${varios ? 'están' : 'está'} de cumpleaños ${unirNombres(nombres)}!`.slice(0, 120),
    body: varios
      ? 'Celebremos este día tan especial: escríbeles y deséales un feliz cumpleaños. ¡Que Dios siga derramando bendiciones sobre sus vidas! 🎉'
      : 'Celebremos este día tan especial: escríbele y deséale un feliz cumpleaños. ¡Que Dios siga derramando bendiciones sobre su vida! 🎉',
    url: '/', tag: 'cumple-' + fecha
  };
}
const idMarcaCumple = (m, anio) => `cumple-${String(m.id).replace(/[^A-Za-z0-9_-]/g, '')}-${anio}`;

// Envía la felicitación de hoy si ya son las 11:00 a. m. y aún no se envió (una vez por persona y año).
async function revisarCumpleanos(sa, at, ahora) {
  const c = partesColombia(ahora);
  if (c.hora < HORA_CUMPLE) return null;
  const equipo = await g.leerDocumento(sa.project_id, at, `artifacts/${g.APP_ID}/public/data/config/equipo`);
  const hoy = cumpleanerosDe(equipo && equipo.miembros, c.fecha);
  const nuevos = [];
  for (const m of hoy) {
    if (await g.crearSiNoExiste(sa.project_id, at, `artifacts/${g.APP_ID}/public/data/recordatorios`, idMarcaCumple(m, c.anio), { tipo: 'cumple', miembro: m.id, fecha: c.fecha, enviado: ahora })) nuevos.push(m.nombre.trim());
  }
  if (!nuevos.length) return null;
  const r = await g.enviarATodos(sa, at, armarAvisoCumple(nuevos, c.fecha));
  return { cumpleanos: nuevos, ...r };
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
    // Los cumpleaños no deben impedir los recordatorios de eventos (ni al revés)
    let errorCumple;
    try {
      const cumple = await revisarCumpleanos(sa, at, ahora);
      if (cumple) resultado.push({ tipo: 'cumple', ...cumple });
    } catch (e) { console.error('Error revisando cumpleaños', e); errorCumple = e.message; }
    res.statusCode = 200;
    return res.json({ ok: true, revisados: (semana && Array.isArray(semana.eventos)) ? semana.eventos.length : 0, enviados: resultado, ...(errorCumple ? { errorCumple } : {}) });
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
module.exports.cumpleanerosDe = cumpleanerosDe;
module.exports.armarAvisoCumple = armarAvisoCumple;
module.exports.idMarcaCumple = idMarcaCumple;
module.exports.partesColombia = partesColombia;
