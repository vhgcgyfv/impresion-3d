# 🧊 Impresión 3D — web de pedidos para amigos

Web para que tus amigos te pidan impresiones 3D:

- **Cuentas**: cada amigo crea su cuenta (correo + contraseña o Google).
- **Pedidos**: escriben en un cuadro de texto lo que quieren, pueden elegir una **oferta**, la **versión llavero (+0,10 €)** y un **código de apoyo** (`manchis14`).
- **Solo pago en efectivo.**
- **Panel de admin** (solo `o39459309@gmail.com`):
  - Aceptar / rechazar pedidos poniendo **precio, hora y lugar de recogida** (y una nota opcional).
  - Marcar pedidos como *listo* / *entregado*.
  - **Cuentas**: quién te ha pagado y quién te debe (y cuánto), con un botón para marcar pagado.
  - **Códigos**: cuánta gente ha usado `manchis14`.
- Ofertas incluidas: **2 Fennecs + balón GRATIS**.

Funciona con **Firebase** (cuentas y base de datos, gratis) y se publica en **GitHub Pages** (gratis), así que es una web de verdad en internet que cualquiera puede abrir.

---

## Puesta en marcha (unos 15 minutos)

### 1. Crea el proyecto de Firebase
1. Entra en <https://console.firebase.google.com> con tu cuenta de Google → **Agregar proyecto** (Google Analytics no hace falta).
2. **Authentication** → *Comenzar* → pestaña **Método de acceso** → activa:
   - **Correo electrónico/contraseña**
   - **Google**
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

### 4. Activa tu cuenta de admin (¡hazlo antes que nadie!)
- Entra en la web con **“Entrar con Google”** usando `o39459309@gmail.com` → ya verás el **Panel admin**.
- Si prefieres correo + contraseña: crea la cuenta con ese correo, abre el enlace de verificación que te llega al Gmail y vuelve a entrar.

> El admin se reconoce por el correo **verificado**, así que nadie puede hacerse pasar por ti aunque intente registrarse con tu correo.

Pásale el enlace a tus amigos y listo 🎉

---

## Cambiar cosas fáciles
Todo está en [`public/config.js`](public/config.js):

| Qué | Dónde |
|---|---|
| Ofertas | `OFFERS` (añade más bloques `{ id, emoji, title, description }`) |
| Precio del llavero | `KEYCHAIN_EXTRA` |
| Códigos de apoyo | `PROMO_CODES` |
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
