# Notificaciones de la programación

Cuando el administrador guarda un cambio en la **programación** (desde *Configurar*), la app envía un aviso
a todos los celulares que activaron las notificaciones con la campana 🔔.

Mientras no se completen los 4 pasos de abajo, la app funciona igual que siempre: la campana y la casilla
"Avisar al equipo" simplemente no aparecen.

## Cómo funciona

1. Cada persona toca la **campana** en el encabezado y acepta el permiso del celular.
2. Su dispositivo queda registrado en Firestore, en `artifacts/comunicaciones-app/public/data/dispositivos`.
3. Al guardar un cambio en la programación (con la casilla **"Avisar al equipo si cambia la programación"** marcada),
   la app llama a `/api/notify` (función de Vercel). La función comprueba que la sesión sea de un administrador
   y envía el aviso con Firebase Cloud Messaging.
4. Los dispositivos que ya no existen (app desinstalada, permiso retirado) se borran solos de la lista.

## Configuración (una sola vez)

### Paso 1: Clave pública de notificaciones (Firebase)

1. Entra a la [consola de Firebase](https://console.firebase.google.com/) → proyecto **comunicaciones-ff4ae**.
2. ⚙️ **Configuración del proyecto** → pestaña **Cloud Messaging**.
3. Verifica que **"API de Firebase Cloud Messaging (V1)"** diga *Habilitada*. Si no, usa el menú ⋮ para habilitarla.
4. Baja a **Configuración web** → **Certificados push web** → **Generar par de claves**.
5. Copia la clave que aparece (empieza normalmente por `B...`, unos 88 caracteres).

### Paso 2: Clave privada de la cuenta de servicio (Firebase)

> ⚠️ Este archivo es **secreto**. No lo subas al repositorio ni lo compartas por chat.

1. En la misma ⚙️ **Configuración del proyecto** → pestaña **Cuentas de servicio**.
2. Botón **Generar nueva clave privada** → se descarga un archivo `.json`.
3. Ábrelo con un editor de texto y copia **todo** su contenido.

### Paso 3: Variables en Vercel

En [Vercel](https://vercel.com/) → tu proyecto → **Settings** → **Environment Variables**, agrega estas
tres variables (marca *Production*, *Preview* y *Development*):

| Nombre | Valor |
|---|---|
| `FIREBASE_VAPID_KEY` | La clave pública del Paso 1 |
| `FIREBASE_SERVICE_ACCOUNT` | Todo el contenido del archivo `.json` del Paso 2 |
| `ADMIN_EMAILS` | Tu correo de administrador (el mismo con el que inicias sesión en la app). Si son varios, sepáralos con comas |

Luego ve a **Deployments** → en el último despliegue usa ⋯ → **Redeploy** para que tome las variables.

### Paso 4: Regla de Firestore

En la consola de Firebase → **Firestore Database** → **Reglas**, agrega este bloque **dentro** de
`match /databases/{database}/documents { ... }`, junto a tus reglas actuales (no borres las que ya tienes),
y pulsa **Publicar**:

```
    // Dispositivos que activaron las notificaciones.
    // Cualquiera puede registrar o quitar SU dispositivo; nadie puede leer la lista desde la app
    // (solo el servidor de Vercel la lee, con la cuenta de servicio).
    match /artifacts/{appId}/public/data/dispositivos/{id} {
      allow read: if false;
      allow delete: if true;
      allow create, update: if request.resource.data.keys().hasOnly(['token', 'plataforma', 'actualizado'])
                            && request.resource.data.token is string
                            && request.resource.data.token.size() < 4096
                            && request.resource.data.plataforma is string
                            && request.resource.data.actualizado is number;
    }
```

## Comprobar que funciona

1. Abre la app en tu celular. Debe aparecer la **campana** 🔔 en el encabezado.
2. Tócala y acepta el permiso. La campana queda blanca (activada).
3. Desde otro dispositivo, entra a **Configurar**, cambia la programación y guarda.
   El mensaje de confirmación dice *"🔔 Se envió un aviso a N dispositivo(s)"*.
4. Al celular le llega **"📅 Programación actualizada"**. Al tocarla se abre la app.

Si el mensaje de confirmación muestra un error, indica qué falta: una variable de Vercel, el correo en
`ADMIN_EMAILS`, etc.

## Limitaciones

- **iPhone / iPad:** requiere iOS 16.4 o superior y la app **instalada** en la pantalla de inicio
  (Safari → Compartir → *Agregar a pantalla de inicio*). Desde Safari normal no llegan.
- **Android:** funciona en Chrome, con la app instalada o no.
- Cada persona debe aceptar el permiso. Si lo rechazó, debe activarlo en los ajustes del teléfono.
- Solo se envía aviso cuando cambia la programación (título, días, personas o notas). Guardar cambios solo del
  equipo o de los problemas no genera aviso.

## Archivos

- `api/notify.js`: envía los avisos (solo administradores).
- `api/push-config.js`: entrega la clave pública a la app.
- `api/_lib/google.js`: conexión con Firebase/Google sin dependencias externas.
- `sw.js`: recibe y muestra las notificaciones; al tocarlas abre la app.
- `icons/badge-96.png`: ícono pequeño de la barra de notificaciones (Android).
