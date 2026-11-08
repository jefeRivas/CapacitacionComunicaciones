# Notificaciones de la programación y de los eventos

La app envía avisos a todos los celulares que activaron las notificaciones con la campana 🔔:

- **Programación:** cuando el administrador guarda un cambio en la programación (desde *Configurar*).
- **Eventos:** recordatorio automático **24 horas antes** y **1 hora antes** de cada evento
  (*Configurar* → pestaña **Eventos**). Ver la sección [Eventos](#eventos-y-recordatorios) más abajo.

Mientras no se completen los pasos de abajo, la app funciona igual que siempre: la campana y la casilla
"Avisar al equipo" simplemente no aparecen.

Tiempo estimado: 10 a 15 minutos. Hazlo desde un computador (es más cómodo que desde el celular).

---

## PARTE A: Firebase

Entra a https://console.firebase.google.com con la cuenta de Google dueña del proyecto y haz clic en el
proyecto **comunicaciones-ff4ae**.

### A1. Clave pública de notificaciones

1. Arriba a la izquierda, junto a **"Descripción general del proyecto"**, haz clic en el **engranaje ⚙️**
   y luego en **"Configuración del proyecto"**.
2. Arriba verás varias pestañas (General, Cloud Messaging, Integraciones, Cuentas de servicio…).
   Haz clic en **"Cloud Messaging"**.
3. En el primer recuadro, **"API de Firebase Cloud Messaging (V1)"**, debe decir **Habilitada** con un ✅ verde.
   - Si dice *Inhabilitada*: haz clic en los **tres puntos ⋮** de ese recuadro → **"Administrar API en Google Cloud Console"**
     → en la página que se abre, botón azul **"Habilitar"**. Vuelve a la pestaña de Firebase y recarga la página.
   - El recuadro **"API de Cloud Messaging (heredada)"** puede decir *Inhabilitada*. Es normal, no lo toques.
4. Baja hasta la sección **"Configuración web"** y ubica el apartado **"Certificados push web"**.
5. Haz clic en el botón **"Generar par de claves"**.
6. Aparece una fila con un texto largo en la columna **"Par de claves"** (unos 88 caracteres; casi siempre empieza por **B**).
   Haz clic en el ícono de **copiar** que está al lado y pégalo en un bloc de notas temporal.
   → Esta es la **CLAVE A1** (es pública, no pasa nada si alguien la ve).

### A2. Clave privada de la cuenta de servicio (secreta)

1. En la misma página de **Configuración del proyecto**, haz clic en la pestaña **"Cuentas de servicio"**.
2. Debe estar seleccionado **"SDK de Firebase Admin"** a la izquierda.
3. Abajo, haz clic en el botón **"Generar nueva clave privada"** → en la ventana de aviso, **"Generar clave"**.
4. Se descarga un archivo con un nombre parecido a `comunicaciones-ff4ae-firebase-adminsdk-xxxxx-1234567890.json`.
5. Ábrelo con el **Bloc de notas** (Windows: clic derecho → *Abrir con* → *Bloc de notas*; Mac: *TextEdit*).
   Verás algo que empieza con `{` y termina con `}`, e incluye `"type": "service_account"` y `"private_key": "-----BEGIN PRIVATE KEY-----...`.
   → Este contenido completo es la **CLAVE A2**.

> ⚠️ La CLAVE A2 da acceso total a tu Firebase. **No la subas al repositorio, no la envíes por chat ni por correo.**
> Solo la vas a pegar en Vercel (paso B2). Cuando termines, borra el archivo descargado.

### A3. Regla de Firestore

1. En el menú izquierdo de Firebase, abre **"Compilación"** (o *Build*) → **"Firestore Database"**.
2. Arriba, pestaña **"Reglas"**.
3. Verás tus reglas actuales. Tienen esta forma general (lo tuyo tendrá más contenido):

   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {

       ... tus reglas actuales (config, aportes, etc.) ...

     }
   }
   ```

4. **No borres nada.** Ubica la **penúltima llave de cierre `}`**: la que cierra `match /databases/{database}/documents {`.
   Justo **antes** de esa llave, pega este bloque:

   ```
       // Dispositivos que activaron las notificaciones.
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

   Debe quedar así:

   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {

       ... tus reglas actuales ...

       // Dispositivos que activaron las notificaciones.
       match /artifacts/{appId}/public/data/dispositivos/{id} {
         ...
       }
     }
   }
   ```

5. Haz clic en **"Publicar"**. Si aparece un error en rojo, normalmente es una llave `}` de más o de menos:
   revisa que el bloque quedó dentro de `match /databases/{database}/documents { ... }`.

> Si en tus reglas ya hay una regla general como `match /{document=**} { allow read, write: if ... }`, no pasa nada:
> el bloque nuevo se suma a ella.

### A4. Confirma tu correo de administrador

1. En el menú izquierdo: **"Compilación"** → **"Authentication"** → pestaña **"Usuarios"**.
2. Anota **exactamente** el correo con el que inicias sesión en la app (columna *Identificador*).
   → Este es el **CORREO A4**.

---

## PARTE B: Vercel

Entra a https://vercel.com, inicia sesión y abre el proyecto de la app (el que se conecta al repositorio
**CapacitacionComunicaciones**).

### B1. Abrir las variables de entorno

1. Arriba, pestaña **"Settings"**.
2. En el menú izquierdo, **"Environment Variables"**.

### B2. Crear las 3 variables

Vas a llenar el formulario **3 veces**, una por variable. En cada una:

- En **"Key"** escribe el nombre **exactamente** como aparece abajo (mayúsculas y guion bajo incluidos).
- En **"Value"** pega el valor.
- En **"Environments"** deja marcados **Production**, **Preview** y **Development**.
- Haz clic en **"Save"**.

| Key (nombre exacto) | Value (qué pegar) |
|---|---|
| `FIREBASE_VAPID_KEY` | La **CLAVE A1**: solo el texto, sin espacios ni comillas |
| `FIREBASE_SERVICE_ACCOUNT` | La **CLAVE A2**: **todo** el contenido del archivo `.json`, desde la `{` inicial hasta la `}` final. Puede ocupar varias líneas; está bien |
| `ADMIN_EMAILS` | El **CORREO A4**, por ejemplo `tucorreo@gmail.com`. Si hay varios administradores: `uno@gmail.com,otro@gmail.com` |

> Para `FIREBASE_SERVICE_ACCOUNT` puedes activar la opción **"Sensitive"** si aparece; así nadie podrá volver a verla en Vercel.

Al terminar deben verse las 3 variables en la lista.

### B3. Volver a publicar (obligatorio)

Las variables nuevas solo se aplican en una publicación nueva:

1. Arriba, pestaña **"Deployments"**.
2. En la **primera fila** (la más reciente, con la etiqueta *Production* / *Current*), haz clic en los **tres puntos ⋯** de la derecha.
3. Elige **"Redeploy"** → en la ventana, botón **"Redeploy"**.
4. Espera a que el estado diga **"Ready"** (1 o 2 minutos).

### B4. Verificar que Vercel quedó bien

Abre en el navegador tu dirección de Vercel agregando `/api/push-config` al final, por ejemplo
`https://tu-app.vercel.app/api/push-config`.

- ✅ Si ves `{"vapidKey":"B...."}` con tu clave: Vercel está bien configurado.
- ❌ Si ves `{"vapidKey":""}`: falta `FIREBASE_VAPID_KEY` o no hiciste el *Redeploy*.
- ❌ Si ves un error 404: la publicación no incluye la carpeta `api`. Revisa que Vercel esté publicando la rama `main`.

---

## PARTE C: Prueba final

1. En tu **celular**, abre la app (si ya estaba abierta, ciérrala del todo y ábrela de nuevo).
2. Debe aparecer la **campana 🔔** en el encabezado. Tócala → **Permitir**. La campana queda **blanca** = activada.
   - iPhone: primero instala la app (Safari → Compartir → *Agregar a pantalla de inicio*) y ábrela desde ese ícono.
3. En el **computador**, abre la app → **Configurar** → inicia sesión → cambia algo de la **programación**
   (por ejemplo el título) → deja marcada **"Avisar al equipo si cambia la programación"** → **Guardar Cambios**.
4. El mensaje de confirmación debe decir **"🔔 Se envió un aviso a 1 dispositivo(s)"**.
5. En el celular llega **"📅 Programación actualizada"**.

### Si algo falla

| Mensaje / síntoma | Causa | Solución |
|---|---|---|
| No aparece la campana | Falta `FIREBASE_VAPID_KEY` o el *Redeploy* | Pasos B2–B4, y recarga la app |
| "No se pudieron activar… Falta la regla de Firestore" | Regla no publicada | Paso A3 |
| "Este correo no está autorizado para enviar notificaciones" | `ADMIN_EMAILS` no coincide con tu correo | Paso A4/B2 (revisa mayúsculas y espacios) y *Redeploy* |
| "Falta la variable FIREBASE_SERVICE_ACCOUNT" o "no es un JSON válido" | No se pegó el archivo completo | Vuelve a pegar todo el `.json` en B2 y *Redeploy* |
| "Google rechazó la cuenta de servicio" | Clave borrada o de otro proyecto | Genera una nueva en A2 y reemplázala en Vercel |
| "Aún no hay dispositivos con las notificaciones activadas" | Nadie tocó la campana todavía | Parte C, paso 2 |
| Dice "Se envió" pero no llega | Notificaciones del navegador/app bloqueadas en el teléfono, o modo "No molestar" | Ajustes del teléfono → Notificaciones → Chrome / Comunicaciones |

---

## Eventos y recordatorios

1. En **Configurar** → pestaña **Eventos** → **Agregar evento**: nombre, fecha, hora (hora de Colombia) y detalles opcionales.
   Guarda con **Guardar Cambios**.
2. Los hermanos ven los próximos eventos en la ventana de programación, **entre "Programación" y "Tener en cuenta"**
   (y también en la imagen descargable). Un evento se oculta 3 horas después de empezar; los que pasaron hace más
   de 30 días se borran solos al guardar.
3. Los recordatorios los envía la función `/api/recordatorios`, que GitHub Actions llama **cada 10 minutos**
   (`.github/workflows/recordatorios.yml`). No requiere configuración adicional en Firebase ni en Vercel.
   - **24 horas antes:** "📅 Recordatorio: … Mañana sábado, 14 de noviembre a las 7:00 p. m." Si el evento se crea con
     menos de 24 horas de anticipación, el aviso sale en la siguiente revisión ("Hoy a las …"), siempre que falten más de 3 horas.
   - **1 hora antes:** "⏰ … Empieza en 1 hora (7:00 p. m.)".
   - GitHub puede retrasar unos minutos sus tareas programadas: el de 1 hora normalmente llega entre 45 y 60 minutos antes.
   - Cada recordatorio se registra en Firestore (`public/data/recordatorios`) y nunca se envía dos veces.
     Si cambias la fecha u hora de un evento, se programan los recordatorios de la nueva hora.
   - Guardar solo cambios de eventos **no** envía el aviso de "Programación actualizada".

### Enviar la notificación de un evento manualmente

En **Configurar** → **Eventos**, cada evento próximo tiene el botón **"Enviar notificación ahora"**.
Pide confirmación y envía el aviso a todo el equipo en ese momento (el texto se adapta: "El sábado…", "Hoy a las…"
o "Empieza en 30 minutos"). No afecta los recordatorios automáticos. Si el evento todavía no está guardado,
la app te recuerda tocar **Guardar Cambios** para que el equipo también lo vea.

### Respaldo: revisión al abrir la app

GitHub no garantiza que sus tareas programadas se ejecuten a tiempo (a veces se retrasan mucho o no se ejecutan).
Por eso, además, cada vez que alguien abre la app (como mucho una vez cada 5 minutos por dispositivo) se piden
los recordatorios pendientes. Nunca se envían dos veces.

Para que los recordatorios sean puntuales aunque nadie abra la app, se recomienda un reloj externo gratuito
como [cron-job.org](https://cron-job.org): una tarea cada 5 minutos, método **POST**, a la dirección
`https://capacitacioncomunicaciones.vercel.app/api/recordatorios`.

### Ver o probar los recordatorios en GitHub

- En el repositorio → pestaña **Actions** → **Recordatorios de eventos** se ve cada ejecución (✅ o ❌).
  Para ejecutarlo a mano: **Run workflow**.
- Si una ejecución sale con ❌, abre el detalle: muestra el mensaje de error de la app (por ejemplo, una variable de Vercel).
- **Importante:** si el repositorio pasa **60 días sin cambios**, GitHub pausa la tarea y envía un correo.
  Para reactivarla: pestaña **Actions** → **Recordatorios de eventos** → **Enable workflow**.
- Si algún día la app cambia de dirección, crea en GitHub la variable `APP_URL` (Settings → Secrets and variables →
  Actions → pestaña *Variables*) con la nueva dirección, por ejemplo `https://otra.vercel.app`.

---

## Limitaciones

- **iPhone / iPad:** requiere iOS 16.4 o superior y la app **instalada** en la pantalla de inicio.
- **Android:** funciona en Chrome, con la app instalada o no.
- Cada persona debe aceptar el permiso. Si lo rechazó, debe activarlo en los ajustes del teléfono.
- Solo se envía aviso cuando cambia la programación (título, días, personas o notas). Guardar cambios solo del
  equipo o de los problemas no genera aviso.

## Archivos

- `api/notify.js`: envía los avisos (solo administradores).
- `api/push-config.js`: entrega la clave pública a la app.
- `api/recordatorios.js`: envía los recordatorios de eventos (24 h y 1 h antes).
- `.github/workflows/recordatorios.yml`: llama a `/api/recordatorios` cada 10 minutos.
- `api/_lib/google.js`: conexión con Firebase/Google sin dependencias externas.
- `sw.js`: recibe y muestra las notificaciones; al tocarlas abre la app.
- `icons/badge-96.png`: ícono pequeño de la barra de notificaciones (Android).
