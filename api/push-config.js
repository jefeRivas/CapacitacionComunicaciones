// GET /api/push-config — Entrega la clave pública (VAPID) para activar notificaciones.
// Si aún no está configurada en Vercel, la app simplemente no muestra el botón de notificaciones.
module.exports = (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.statusCode = 200;
  res.json({ vapidKey: String(process.env.FIREBASE_VAPID_KEY || '').trim() });
};
