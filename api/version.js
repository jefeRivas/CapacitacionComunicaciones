// GET /api/version — Identificador de la versión publicada de la app.
// La app lo consulta al abrirse y antes de guardar: si cambió, es porque se publicó una versión nueva y la copia
// abierta en el dispositivo está desactualizada (se recarga en lugar de guardar con código viejo).
// Usa las variables que Vercel define en cada publicación; si no existen, devuelve '' y la comprobación no se hace.
module.exports = (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.statusCode = 200;
  res.json({ version: String(process.env.VERCEL_DEPLOYMENT_ID || process.env.VERCEL_GIT_COMMIT_SHA || process.env.VERCEL_URL || '') });
};
