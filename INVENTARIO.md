# Inventario de equipos

Sección **Inventario** de la app (menú principal; en el celular, en **Más**).

## Para todos

- Cualquier persona ve los equipos, su estado (🟢 Bueno, 🟡 Con novedad, 🔴 Malo), si están **en uso**,
  sus novedades abiertas y el historial. Todo se actualiza en vivo.
- Arriba hay un resumen (total, por estado y en uso). Tocar un recuadro filtra la lista.
  También se puede buscar por nombre, código, marca, referencia o ubicación.
- **Reportar novedad:** en el equipo, toca *Reportar novedad*, elige tu nombre, describe qué pasa
  (por ejemplo "El cargador no sirve") y escribe el **código del grupo**. La app recuerda tu nombre y el código
  para la próxima vez. El equipo pasa solo a **Con novedad** (si estaba en **Malo**, sigue en Malo).

## Para el administrador

Toca **Administrar** en la sección Inventario e inicia sesión (la misma cuenta de Configurar).

- **Agregar equipo / Editar / Eliminar:** nombre, código (se sugiere solo según la categoría, por ejemplo
  CAM-01, MIC-02), categoría, marca, referencia, n.º de serie (opcional), ubicación, cantidad, fecha de ingreso,
  estado, en uso y observaciones. No se permiten dos equipos con el mismo código.
- **En uso:** interruptor directamente en la tarjeta del equipo.
- **Novedades:** botón **Resuelta** (con nota opcional y el estado en que queda el equipo) o **Borrar**
  (para reportes por error). Las resueltas quedan en el historial del equipo.
- **Exportar:** **Excel** (una hoja "Equipos" con todos los campos) y **PDF / Imprimir** (en el diálogo de
  impresión elige "Guardar como PDF").
- **Código del grupo:** en **Configurar → Equipo → Código para reportar novedades del inventario**.
  Es de 4 a 12 letras o números; no distingue mayúsculas. Al cambiarlo, el anterior deja de funcionar.
  Por seguridad no se muestra el código actual.
- **Avisos de novedades:** en la barra de administración del Inventario, toca **Recibir avisos aquí** en tu
  celular (con la campana activada). Te llega una notificación cada vez que alguien reporta una novedad;
  al tocarla se abre el Inventario.

## Seguridad

- Nadie escribe directamente en la base de datos: todo pasa por la función `api/inventario.js` en Vercel.
  Los cambios del administrador requieren su sesión (correo en `ADMIN_EMAILS`); los reportes requieren el código del grupo.
- Tras 5 intentos con un código incorrecto desde la misma conexión, se bloquean los reportes de esa conexión por 15 minutos.
- El código se guarda cifrado en `artifacts/comunicaciones-app/privado/inventario`, que la app no puede leer.
- No requirió cambios en las reglas de Firestore ni en Vercel.

## Datos

- `artifacts/comunicaciones-app/public/data/config/inventario`: equipos y novedades (lectura pública).
- Se conservan todas las novedades abiertas y las 300 resueltas más recientes.
