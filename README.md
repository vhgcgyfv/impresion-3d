# 🧊 Impresión 3D — web de pedidos para amigos

Web para que tus amigos te pidan impresiones 3D:

- **Cuentas**: para crear cuenta hace falta **usuario + correo + código de verificación + contraseña**. El código de 6 cifras llega al correo. No se pueden repetir usuarios.
- **Pedidos**: eligen productos con precio fijo (**Fennec 0,50 €**, **Balón 0,25 €**), escriben detalles en un cuadro de texto, pueden elegir una **oferta**, la **versión llavero (+0,10 €)** y un **código de apoyo**. Ven el total aproximado al momento.
- **Código `manchis14`**: al escribirlo sale una sorpresa de 5 segundos 🎵 y luego se aplica un **10 % de descuento**.
- **Solo pago en efectivo.**
- **Co-dueño** (`martincsurcui@gmail.com`): gestiona pedidos (aceptar, precio, hora, lugar, estado, «cómo va») y contesta chats con la etiqueta «🤝 Co-dueño». No puede tocar pagos, precios, borrar pedidos ni usar «sin filamento». Se cambia en `COOWNER_EMAILS` (`public/config.js`) **y** en `firestore.rules`.
- **Panel de admin** (solo `o39459309@gmail.com`):
  - Los pedidos **entran ya aceptados** con el precio calculado. Tú (o el co-dueño) pones **hora y lugar de recogida**, puedes ajustar el precio y **rechazarlos**. El cliente puede cancelar el suyo mientras no esté listo ni pagado.
  - Marcar pedidos como *listo* / *entregado*.
  - **Cuentas**: quién te ha pagado y quién te debe (y cuánto), con un botón para marcar pagado.
  - **Códigos**: cuánta gente ha usado `manchis14`.
  - **Avisos de pedidos nuevos**: te llega un **correo** con cada pedido (con EmailJS) y, con el panel abierto, **suena** y sale una **notificación** (botón «Activar avisos»).
  - **Contar cómo va**: en cada pedido aceptado, publica un texto, el % de progreso y hasta 4 fotos. Solo lo ve el dueño del pedido.
  - **Chats**: cada amigo tiene su chat privado contigo (botón «💬 Chat»). Tú los ves todos en la pestaña Chats y puedes mandar fotos. Avisa con sonido/notificación y contador de no leídos.
  - **Sin filamento**: un botón que cancela de golpe todos los pedidos pendientes y aceptados que aún no has marcado como listos (tus amigos ven el aviso).
  - **Stock**: en Precios, cuántas unidades tienes hechas de cada producto (vacío = sin límite, 0 = agotado). Baja solo con cada pedido y vuelve si se cancela o rechaza.
  - **Precios**: cambia el precio de cada producto y del llavero, añade o quita productos. Tus amigos ven los precios nuevos al momento.
- Ofertas incluidas: **2 Fennecs + balón GRATIS**.

Funciona con **Firebase** (cuentas y base de datos, gratis) y se publica en **GitHub Pages** (gratis), así que es una web de verdad en internet que cualquiera puede abrir.

---

## Puesta en marcha (unos 15 minutos)

### 1. Crea el proyecto de Firebase
1. Entra en <https://console.firebase.google.com> con tu cuenta de Google → **Agregar proyecto** (Google Analytics no hace falta).
2. **Authentication** → *Comenzar* → pestaña **Método de acceso** → activa:
   - **Correo electrónico/contraseña**
3. **Firestore Database** → *Crear base de datos* → elige una ubicación en Europa (p. ej. `eur3`) → modo **producción**.
4. En Firestore → pestaña **Reglas** → borra lo que haya, pega **todo** el contenido del archivo [`firestore.rules`](firestore.rules) y pulsa **Publicar**. *(Esto es lo que impide que alguien que no seas tú cambie precios o pagos.)*

### 2. Conecta la web con Firebase
1. En Firebase → ⚙️ **Configuración del proyecto** → *Tus apps* → icono **`</>`** (Web) → ponle un nombre → *Registrar app*.
2. Te enseña un bloque `const firebaseConfig = { ... }`. Copia esos valores en [`public/config.js`](public/config.js) sustituyendo los de ejemplo.

### 3. Publica la web
1. Sube los cambios a la rama `main` de este repositorio.
2. En GitHub → **Settings** → **Pages** → en *Source* elige **GitHub Actions**.
3. Ve a la pestaña **Actions**: en un minuto la web estará en `https://<tu-usuario>.github.io/impresion-3d/`.
4. Vuelve a Firebase → **Authentication** → **Settings** → **Dominios autorizados** → *Agregar dominio* → `<tu-usuario>.github.io`.

### 4. Activa los códigos de verificación (EmailJS, gratis)
Firebase solo sabe mandar enlaces, así que los códigos de 6 cifras se envían con **EmailJS** (gratis hasta 200 correos al mes, sin tarjeta).
**Mientras no hagas este paso, la web funciona igual pero manda un enlace de verificación en vez de un código.**

1. Crea una cuenta en <https://www.emailjs.com>.
2. **Email Services** → *Add New Service* → **Gmail** → conecta tu Gmail → apunta el **Service ID**.
3. **Email Templates** → *Create New Template*:
   - **To Email**: `{{to_email}}`
   - **Subject**: `Tu código: {{code}}`
   - **Content**: `Hola {{username}}, tu código para crear la cuenta en {{site_name}} es: {{code}}. Caduca en 10 minutos.`
   - Guarda y apunta el **Template ID**.
4. **Account** → **General** → apunta la **Public Key**.
5. **Correo de aviso de pedido nuevo (te llega a ti)**: crea otra plantilla:
   - **To Email**: `{{to_email}}`
   - **Subject**: `🛒 Pedido nuevo de {{username}}`
   - **Content**:
     ```
     {{username}} ({{user_email}}) ha hecho un pedido:
     Productos: {{items}}
     Detalles: {{description}}
     Oferta: {{offer}} · Llavero: {{keychain}} · Código: {{promo_code}}
     Total aproximado: {{estimate}}
     Aceptarlo: {{admin_url}}
     ```
   - Apunta su **Template ID**.
6. Pon los valores en `EMAILJS` dentro de [`public/config.js`](public/config.js) (`serviceId`, `templateId`, `orderTemplateId`, `publicKey`).

### 5. Activa tu cuenta de admin (¡hazlo antes que nadie!)
1. En la web → **Crear cuenta** con `o39459309@gmail.com` (usuario, código y contraseña como todos).
2. Además te llega un **enlace de verificación de Firebase** a ese Gmail: ábrelo (mira en spam).
3. Sal y vuelve a entrar → ya verás el **Panel admin**.

> El admin se reconoce por el correo **verificado**, así que nadie puede hacerse pasar por ti aunque intente registrarse con tu correo.

Pásale el enlace a tus amigos y listo 🎉

---

## Usar tu propio dominio (opcional)
La web se publica en `https://<tu-usuario>.github.io/impresion-3d/`. Si quieres una dirección propia (p. ej. `mis3d.es`):
1. Cómprala en cualquier registrador (unos 10 €/año).
2. En GitHub → **Settings** → **Pages** → **Custom domain**, escríbela y sigue las instrucciones de DNS.
3. Añade ese dominio también en Firebase → Authentication → Settings → **Dominios autorizados**.

## Cambiar cosas fáciles
Todo está en [`public/config.js`](public/config.js):

| Qué | Dónde |
|---|---|
| Nombre de la web | `SITE_NAME` |
| Productos y precios | Desde el **panel admin → Precios** (en `PRODUCTS` están los de partida) |
| Ofertas | `OFFERS` (qué incluye y qué sale gratis) |
| Precio del llavero | Desde el **panel admin → Precios** (en `KEYCHAIN_EXTRA` está el de partida) |
| Códigos de apoyo (descuento y sorpresa) | `PROMO_CODES` |
| Sitios de recogida sugeridos | `PICKUP_PLACES` |

Si cambias el correo del admin, cámbialo en `config.js` **y** en `firestore.rules` (y vuelve a publicar las reglas).

## Probar en tu ordenador (opcional)
```bash
npx firebase-tools emulators:start --only auth,firestore --project demo-test
# en otra terminal:
cd public && python3 -m http.server 5173
# abre http://localhost:5173/?emu  (con projectId "demo-test" en config.js)
```

## Archivos
- `public/` — la web (HTML, CSS, JS). Es lo que se publica.
- `firestore.rules` — reglas de seguridad de la base de datos.
- `.github/workflows/pages.yml` — publica `public/` en GitHub Pages al subir a `main`.
- `firebase.json` — por si prefieres publicar con Firebase Hosting (`npx firebase-tools deploy`).
