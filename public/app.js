import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, connectAuthEmulator, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  signOut, sendEmailVerification, sendPasswordResetEmail,
  updateProfile,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, connectFirestoreEmulator, collection, addDoc, doc, setDoc, getDoc, updateDoc, deleteDoc, writeBatch,
  query, where, orderBy, onSnapshot, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  firebaseConfig, SITE_NAME, EMAILJS, ADMIN_EMAIL, KEYCHAIN_EXTRA, PRODUCTS, PROMO_CODES, OFFERS, PICKUP_PLACES,
} from "./config.js";

// ---------------------------------------------------------------- utilidades
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => (
  { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money = (n) => (Number(n) || 0).toLocaleString("es-ES", { style: "currency", currency: "EUR" });
const round2 = (n) => Math.round(n * 100) / 100;
const show = (el, yes = true) => el.classList.toggle("hidden", !yes);
const ms = (o) => o.createdAt?.toMillis?.() ?? Date.now();
const fmtDate = (ts) => ts?.toDate ? ts.toDate().toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" }) : "ahora";
const fmtPickup = (v) => {
  if (!v) return "";
  const d = new Date(v);
  if (isNaN(d)) return v;
  return d.toLocaleString("es-ES", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
};
const shortId = (id) => id.slice(0, 6).toUpperCase();
const offerTitle = (id) => OFFERS.find((o) => o.id === id)?.title || id;
const CODE_LIST = Object.keys(PROMO_CODES);
const codeInfo = (c) => (c && PROMO_CODES[c]) || null;
// Precios actuales: empiezan con los de config.js y el admin los cambia desde el panel
let catalog = PRODUCTS.map((p) => ({ ...p }));
let keychainExtra = KEYCHAIN_EXTRA;
const productOf = (id) => catalog.find((p) => p.id === id);
const itemsText = (items) => Object.entries(items || {}).filter(([, q]) => q > 0)
  .map(([id, q]) => `${q}× ${productOf(id)?.name || id}`).join(", ");

// Calcula el precio de un pedido. Si se pasa basePrice (el que pone el admin), se usa ese.
function calcPrice({ items = {}, offer = "", keychain = false, promoCode = "" }, basePrice) {
  let subtotal = 0;
  for (const [id, q] of Object.entries(items)) subtotal += (productOf(id)?.price || 0) * q;
  let offerDiscount = 0;
  const of = OFFERS.find((o) => o.id === offer);
  if (of?.free && Object.entries(of.items || {}).every(([id, q]) => (items[id] || 0) >= q)) {
    for (const [id, q] of Object.entries(of.free)) offerDiscount += (productOf(id)?.price || 0) * q;
  }
  const base = round2(basePrice ?? subtotal - offerDiscount);
  const extra = keychain ? keychainExtra : 0;
  const pct = codeInfo(promoCode)?.discount || 0;
  const codeDiscount = round2((base + extra) * pct / 100);
  return {
    subtotal: round2(subtotal), offerDiscount: round2(offerDiscount),
    base, extra, pct, codeDiscount, total: round2(base + extra - codeDiscount),
  };
}

// Desglose del precio en HTML
function breakdownHtml(c, { showSubtotal = true } = {}) {
  const rows = [];
  if (showSubtotal && c.offerDiscount) {
    rows.push(["Productos", money(c.subtotal)], ["🔥 Oferta", "−" + money(c.offerDiscount)]);
  }
  if (c.extra || c.pct) rows.push(["Base", money(c.base)]);
  if (c.extra) rows.push(["🔑 Llavero", "+" + money(c.extra)]);
  if (c.pct) rows.push([`🏷️ Código (−${c.pct}%)`, "−" + money(c.codeDiscount)]);
  return rows.map(([a, b]) => `<div class="row"><span>${a}</span><span>${b}</span></div>`).join("");
}

// ---------------------------------------------------------------- rickroll
function rickroll(onDone) {
  const ov = $("#rick");
  const frame = $("#rick-frame");
  const count = $("#rick-count");
  frame.innerHTML = `<iframe src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1&controls=0&modestbranding=1&rel=0"
    allow="autoplay; encrypted-media" title="Sorpresa" frameborder="0"></iframe>`;
  show(ov);
  let left = 5;
  count.textContent = left;
  const t = setInterval(() => {
    left--;
    count.textContent = left;
    if (left <= 0) {
      clearInterval(t);
      frame.innerHTML = "";
      show(ov, false);
      onDone?.();
    }
  }, 1000);
}

const STATUS = {
  pendiente: "⏳ Pendiente",
  aceptado: "✅ Aceptado",
  listo: "📦 Listo para recoger",
  entregado: "🤝 Entregado",
  rechazado: "❌ Rechazado",
  cancelado: "🚫 Cancelado",
};
const BILLABLE = ["aceptado", "listo", "entregado"];
const CODES_ON = Boolean(EMAILJS?.serviceId && EMAILJS?.templateId && EMAILJS?.publicKey);
const USERNAME_RE = /^[A-Za-z0-9_.]{3,20}$/;

let toastTimer;
function toast(msg, isError = false) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.toggle("error", isError);
  show(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => show(t, false), 3500);
}

function authError(e) {
  const map = {
    "auth/invalid-credential": "Correo o contraseña incorrectos.",
    "auth/wrong-password": "Contraseña incorrecta.",
    "auth/user-not-found": "No existe ninguna cuenta con ese correo.",
    "auth/email-already-in-use": "Ya hay una cuenta con ese correo. Prueba a entrar.",
    "auth/weak-password": "La contraseña debe tener al menos 6 caracteres.",
    "auth/invalid-email": "El correo no es válido.",
    "auth/too-many-requests": "Demasiados intentos. Espera un poco.",
    "auth/unauthorized-domain": "Este dominio no está autorizado en Firebase (mira el README).",
    "auth/requires-recent-login": "Vuelve a entrar e inténtalo otra vez.",
    "permission-denied": "No tienes permiso para hacer eso.",
  };
  console.error(e);
  return map[e.code] || e.message || "Ha ocurrido un error.";
}

async function withBusy(btn, fn) {
  if (btn) btn.disabled = true;
  try { await fn(); } catch (e) { toast(authError(e), true); } finally { if (btn) btn.disabled = false; }
}

// ---------------------------------------------------------------- arranque
document.title = SITE_NAME;
$(".brand span").textContent = SITE_NAME;
const configured = firebaseConfig.apiKey && !firebaseConfig.apiKey.startsWith("PEGA");
if (!configured) {
  show($("#loading"), false);
  show($("#setup-warning"));
} else {
  start();
}

function start() {
  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app);
  const db = getFirestore(app);

  // Solo para pruebas en tu ordenador: http://localhost:xxxx/?emu
  if (location.hostname === "localhost" && new URLSearchParams(location.search).has("emu")) {
    connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
    connectFirestoreEmulator(db, "127.0.0.1", 8080);
  }

  let currentUser = null;
  let profileName = "";
  let isAdmin = false;
  let unsubs = [];
  let myOrders = [];
  let allOrders = [];

  // ---------- Ofertas y formulario ----------
  const offerSelect = $("#offer-select");
  OFFERS.forEach((o) => offerSelect.insertAdjacentHTML("beforeend",
    `<option value="${esc(o.id)}">${esc(o.title)}</option>`));
  $("#offers").innerHTML = OFFERS.length ? OFFERS.map((o) => `
    <div class="offer">
      <div class="emoji">${esc(o.emoji)}</div>
      <h3>${esc(o.title)}</h3>
      <p>${esc(o.description)}</p>
      <button class="btn small" data-offer="${esc(o.id)}">La quiero</button>
    </div>`).join("") : `<p class="muted">Ahora mismo no hay ofertas.</p>`;
  function renderProducts() {
    const prev = getItems();
    $("#keychain-price").textContent = `(+${money(keychainExtra)})`;
    $("#products").innerHTML = catalog.length ? catalog.map((p) => `
    <div class="product">
      <div class="p-emoji">${esc(p.emoji)}</div>
      <div class="p-info"><strong>${esc(p.name)}</strong><span class="muted small">${money(p.price)}</span></div>
      <div class="stepper">
        <button type="button" class="btn small" data-step="-1" data-pid="${esc(p.id)}" aria-label="Quitar">−</button>
        <input type="number" min="0" max="50" value="0" data-qty="${esc(p.id)}" aria-label="Cantidad de ${esc(p.name)}" />
        <button type="button" class="btn small" data-step="1" data-pid="${esc(p.id)}" aria-label="Añadir">+</button>
      </div>
    </div>`).join("") : `<p class="muted small">Ahora mismo no hay productos fijos: escribe abajo lo que quieres.</p>`;
    setItems(prev);
    updateSummary();
  }

  const getItems = () => {
    const items = {};
    $$("[data-qty]").forEach((i) => {
      const q = Math.max(0, Math.min(50, parseInt(i.value, 10) || 0));
      if (q) items[i.dataset.qty] = q;
    });
    return items;
  };
  const setItems = (items) => $$("[data-qty]").forEach((i) => { i.value = items[i.dataset.qty] || 0; });

  let codeApplied = "";
  function updateSummary() {
    const f = $("#order-form");
    const code = f.promoCode.value.trim().toLowerCase();
    const c = calcPrice({
      items: getItems(), offer: f.offer.value, keychain: f.keychain.checked,
      promoCode: code === codeApplied ? code : "",
    });
    const box = $("#order-summary");
    const any = Object.keys(getItems()).length;
    box.innerHTML = any ? `${breakdownHtml(c)}
      <div class="row total"><span>Total aproximado</span><span>${money(c.total)}</span></div>
      <div class="muted small">El precio final te lo confirmo al aceptar el pedido.</div>` : "";
    show(box, any);
  }

  $("#products").addEventListener("click", (e) => {
    const b = e.target.closest("[data-step]");
    if (!b) return;
    const inp = $(`[data-qty="${b.dataset.pid}"]`);
    inp.value = Math.max(0, Math.min(50, (parseInt(inp.value, 10) || 0) + Number(b.dataset.step)));
    updateSummary();
  });
  $("#order-form").addEventListener("input", updateSummary);
  $("#order-form").addEventListener("change", updateSummary);

  offerSelect.addEventListener("change", () => {
    const o = OFFERS.find((x) => x.id === offerSelect.value);
    if (o?.items) setItems({ ...getItems(), ...Object.fromEntries(
      Object.entries(o.items).map(([id, q]) => [id, Math.max(q, getItems()[id] || 0)])) });
    updateSummary();
  });

  $("#offers").addEventListener("click", (e) => {
    const id = e.target.closest("[data-offer]")?.dataset.offer;
    if (!id) return;
    offerSelect.value = id;
    offerSelect.dispatchEvent(new Event("change"));
    $("#order-form").scrollIntoView({ behavior: "smooth", block: "start" });
  });

  // Código de apoyo: al escribirlo bien sale la sorpresa y luego el descuento
  const codeInput = $("#order-form [name=promoCode]");
  const codeMsg = $("#code-msg");
  codeInput.addEventListener("input", () => {
    const code = codeInput.value.trim().toLowerCase();
    const info = codeInfo(code);
    if (!info) {
      codeApplied = "";
      codeMsg.textContent = "";
      updateSummary();
      return;
    }
    if (codeApplied === code) return;
    const apply = () => {
      codeApplied = code;
      codeMsg.textContent = `✅ Código aplicado: ${info.discount}% de descuento`;
      updateSummary();
      if (info.discount) toast(`🎉 ¡${info.discount}% de descuento aplicado!`);
    };
    codeInput.blur();
    if (info.rickroll) rickroll(apply); else apply();
  });

  renderProducts();

  // Precios en directo desde la base de datos
  onSnapshot(doc(db, "settings", "shop"), (snap) => {
    if (!snap.exists()) return;
    const d = snap.data();
    if (Array.isArray(d.products)) catalog = d.products;
    if (typeof d.keychainExtra === "number") keychainExtra = d.keychainExtra;
    renderProducts();
    if (isAdmin) renderAdmin();
  }, (e) => console.error(e));

  // ---------- Login / registro ----------
  $$("[data-auth-tab]").forEach((b) => b.addEventListener("click", () => {
    $$("[data-auth-tab]").forEach((x) => x.classList.toggle("active", x === b));
    show($("#login-form"), b.dataset.authTab === "login");
    show($("#register-form"), b.dataset.authTab === "register");
    show($("#code-form"), false);
    pending = null;
  }));

  $("#login-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const f = e.target;
    withBusy(f.querySelector("button[type=submit]"), () =>
      signInWithEmailAndPassword(auth, f.email.value.trim(), f.password.value));
  });

  // ---------- Crear cuenta: usuario + correo + contraseña + código ----------
  let pending = null;   // datos del registro mientras se espera el código
  let registering = false;
  let lastSent = 0;
  if (!CODES_ON) $("#register-submit").textContent = "Crear cuenta";

  function showRegisterStep(step) {
    show($("#register-form"), step === "data");
    show($("#code-form"), step === "code");
  }

  async function sendCode(p) {
    const wait = Math.ceil((lastSent + 30e3 - Date.now()) / 1000);
    if (wait > 0) throw new Error(`Espera ${wait} s para pedir otro código.`);
    p.code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1e6).padStart(6, "0");
    p.expires = Date.now() + 10 * 60e3;
    p.tries = 0;
    const r = await fetch("https://api.emailjs.com/api/v1.0/email/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        service_id: EMAILJS.serviceId,
        template_id: EMAILJS.templateId,
        user_id: EMAILJS.publicKey,
        template_params: { to_email: p.email, code: p.code, username: p.username, site_name: SITE_NAME },
      }),
    });
    if (!r.ok) throw new Error("No se ha podido enviar el código. Revisa el correo o inténtalo más tarde.");
    lastSent = Date.now();
  }

  async function createAccount(p) {
    const key = p.username.toLowerCase();
    registering = true;
    profileName = p.username;
    try {
      const cred = await createUserWithEmailAndPassword(auth, p.email, p.password);
      try {
        const b = writeBatch(db);
        b.set(doc(db, "usernames", key), { uid: cred.user.uid });
        b.set(doc(db, "users", cred.user.uid), {
          name: p.username, username: key, email: cred.user.email, createdAt: serverTimestamp(),
        });
        await b.commit();
      } catch (e) {
        // Alguien cogió el usuario justo a la vez: deshacer la cuenta
        await cred.user.delete().catch(() => {});
        throw Object.assign(new Error("Ese usuario ya está cogido. Elige otro."), { code: "" });
      }
      await updateProfile(cred.user, { displayName: p.username });
      // Firebase solo marca el correo como verificado con su enlace: hace falta
      // para el admin siempre, y para todos si no hay códigos configurados.
      if (!CODES_ON || cred.user.email.toLowerCase() === ADMIN_EMAIL.toLowerCase()) {
        await sendEmailVerification(cred.user);
      }
      renderHeader();
      toast(`¡Bienvenido, ${p.username}!`);
    } finally {
      registering = false;
    }
  }

  $("#register-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const f = e.target;
    withBusy(f.querySelector("button[type=submit]"), async () => {
      const username = f.username.value.trim();
      const email = f.email.value.trim();
      if (!USERNAME_RE.test(username)) throw new Error("El usuario solo puede tener letras, números, punto o _ (3-20).");
      if (f.password.value.length < 6) throw new Error("La contraseña debe tener al menos 6 caracteres.");
      if (f.password.value !== f.password2.value) throw new Error("Las contraseñas no coinciden.");
      const taken = await getDoc(doc(db, "usernames", username.toLowerCase()));
      if (taken.exists()) throw new Error("Ese usuario ya está cogido. Elige otro.");
      const p = { username, email, password: f.password.value };
      if (!CODES_ON) return createAccount(p);
      await sendCode(p);
      pending = p;
      $("#code-email").textContent = email;
      $("#code-form").reset();
      showRegisterStep("code");
      $("#code-form [name=code]").focus();
      toast("📧 Código enviado.");
    });
  });

  $("#code-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const f = e.target;
    withBusy(f.querySelector("button[type=submit]"), async () => {
      if (!pending) return showRegisterStep("data");
      if (Date.now() > pending.expires) throw new Error("El código ha caducado. Pulsa «Reenviar código».");
      if (pending.tries >= 5) throw new Error("Demasiados intentos. Pulsa «Reenviar código».");
      if (f.code.value.trim() !== pending.code) {
        pending.tries++;
        throw new Error(`Código incorrecto. Te quedan ${5 - pending.tries} intentos.`);
      }
      const p = pending;
      await createAccount(p);
      pending = null;
      $("#register-form").reset();
      showRegisterStep("data");
    });
  });

  $("#resend-code").addEventListener("click", (e) => withBusy(e.currentTarget, async () => {
    if (!pending) return showRegisterStep("data");
    await sendCode(pending);
    toast("📧 Código reenviado.");
  }));
  $("#back-register").addEventListener("click", () => { pending = null; showRegisterStep("data"); });

  $("#forgot").addEventListener("click", () => {
    const email = $("#login-form").email.value.trim() || prompt("Escribe tu correo:");
    if (!email) return;
    withBusy(null, async () => {
      await sendPasswordResetEmail(auth, email);
      toast("Te hemos enviado un correo para cambiar la contraseña.");
    });
  });

  $("#logout").addEventListener("click", () => signOut(auth));
  $("#resend-verify").addEventListener("click", (e) => withBusy(e.currentTarget, async () => {
    await sendEmailVerification(auth.currentUser);
    toast("Correo de verificación enviado.");
  }));

  async function ensureProfile(user, name) {
    const ref = doc(db, "users", user.uid);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, { name: name.slice(0, 60) || "Amigo", email: user.email, createdAt: serverTimestamp() });
    }
  }

  // ---------- Navegación ----------
  function setView(view) {
    show($("#client-view"), view === "client");
    show($("#admin-view"), view === "admin");
    $("#nav-client").classList.toggle("active", view === "client");
    $("#nav-admin").classList.toggle("active", view === "admin");
  }
  $("#nav-client").addEventListener("click", () => setView("client"));
  $("#nav-admin").addEventListener("click", () => setView("admin"));

  function renderHeader() {
    $("#nav-user").textContent = profileName || currentUser?.email || "";
  }

  // ---------- Estado de sesión ----------
  onAuthStateChanged(auth, async (user) => {
    unsubs.forEach((u) => u());
    unsubs = [];
    currentUser = user;
    show($("#loading"), false);

    if (!user) {
      $("#login-form").reset();
      $("#register-form").reset();
      $('[data-auth-tab="login"]').click();
      show($("#auth-view"));
      show($("#nav"), false);
      show($("#client-view"), false);
      show($("#admin-view"), false);
      return;
    }

    show($("#auth-view"), false);
    show($("#nav"));

    const emailIsAdmin = user.email?.toLowerCase() === ADMIN_EMAIL.toLowerCase();
    isAdmin = emailIsAdmin && user.emailVerified;
    show($("#verify-banner"), (emailIsAdmin || !CODES_ON) && !user.emailVerified);
    $("#verify-why").textContent = emailIsAdmin ? "para activar el panel de administrador" : "para poder hacer pedidos";
    show($("#nav-admin"), isAdmin);

    if (registering) {
      // createAccount se encarga del perfil
    } else try {
      const snap = await getDoc(doc(db, "users", user.uid));
      profileName = snap.exists() ? snap.data().name : (user.displayName || profileName);
      if (!snap.exists()) await ensureProfile(user, profileName || user.email.split("@")[0]);
    } catch (e) {
      console.error(e);
      profileName = user.displayName || profileName || user.email;
    }
    renderHeader();

    // Pedidos del propio usuario
    unsubs.push(onSnapshot(
      query(collection(db, "orders"), where("uid", "==", user.uid)),
      (snap) => {
        myOrders = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => ms(b) - ms(a));
        renderMyOrders();
      },
      (e) => toast(authError(e), true),
    ));

    if (isAdmin) {
      unsubs.push(onSnapshot(
        query(collection(db, "orders"), orderBy("createdAt", "desc")),
        (snap) => {
          allOrders = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
          renderAdmin();
        },
        (e) => toast(authError(e), true),
      ));
      setView("admin");
    } else {
      setView("client");
    }
  });

  // ---------- Crear pedido ----------
  $("#order-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const f = e.target;
    const description = f.description.value.trim();
    const promoCode = f.promoCode.value.trim().toLowerCase();
    const items = getItems();
    if (!CODES_ON && !currentUser.emailVerified) {
      return toast("Primero verifica tu correo con el enlace que te hemos enviado.", true);
    }
    if (!description && !Object.keys(items).length) {
      return toast("Elige algún producto o escribe qué quieres pedir.", true);
    }
    if (promoCode && !codeInfo(promoCode)) {
      return toast("Ese código no existe. Revísalo o déjalo vacío.", true);
    }
    withBusy(f.querySelector("button[type=submit]"), async () => {
      await addDoc(collection(db, "orders"), {
        uid: currentUser.uid,
        userName: (profileName || currentUser.email).slice(0, 60),
        userEmail: currentUser.email,
        description: description.slice(0, 1000),
        items,
        offer: f.offer.value,
        keychain: f.keychain.checked,
        promoCode,
        status: "pendiente",
        paid: false,
        createdAt: serverTimestamp(),
      });
      f.reset();
      codeApplied = "";
      codeMsg.textContent = "";
      updateSummary();
      toast("¡Pedido enviado! Te avisaré aquí cuando lo acepte.");
    });
  });

  // ---------- Mis pedidos ----------
  function orderTags(o) {
    const t = [];
    if (itemsText(o.items)) t.push(`<span class="tag">🧊 ${esc(itemsText(o.items))}</span>`);
    if (o.offer) t.push(`<span class="tag">🔥 ${esc(offerTitle(o.offer))}</span>`);
    if (o.keychain) t.push(`<span class="tag">🔑 Llavero</span>`);
    if (o.promoCode) t.push(`<span class="tag">🏷️ ${esc(o.promoCode)}${codeInfo(o.promoCode)?.discount ? ` (−${codeInfo(o.promoCode).discount}%)` : ""}</span>`);
    return t.length ? `<div class="tags">${t.join("")}</div>` : "";
  }

  function payBadge(o) {
    if (!BILLABLE.includes(o.status)) return "";
    return o.paid
      ? `<span class="badge paid">💶 Pagado</span>`
      : `<span class="badge owes">💶 Pendiente de pago: ${money(o.total)}</span>`;
  }

  function pickupBox(o) {
    if (!BILLABLE.includes(o.status)) return "";
    return `<div class="pickup">
      ${breakdownHtml(calcPrice(o, o.price ?? 0), { showSubtotal: false })}
      <div>Precio: <strong>${money(o.total)}</strong> <span class="small">(en efectivo)</span></div>
      <div>🕒 Recogida: <strong>${esc(fmtPickup(o.pickupTime))}</strong></div>
      <div>📍 Lugar: <strong>${esc(o.pickupPlace)}</strong></div>
    </div>`;
  }

  function renderMyOrders() {
    const box = $("#my-orders");
    if (!myOrders.length) {
      box.innerHTML = `<div class="empty">Aún no has hecho ningún pedido.</div>`;
      return;
    }
    box.innerHTML = myOrders.map((o) => `
      <div class="order">
        <div class="order-head">
          <div><span class="muted small">#${shortId(o.id)} · ${fmtDate(o.createdAt)}</span></div>
          <div class="tags">
            <span class="badge st-${esc(o.status)}">${STATUS[o.status] || esc(o.status)}</span>
            ${payBadge(o)}
          </div>
        </div>
        ${o.description ? `<div class="order-desc">${esc(o.description)}</div>` : ""}
        ${orderTags(o)}
        ${pickupBox(o)}
        ${o.adminNote ? `<div class="note">💬 ${esc(o.adminNote)}</div>` : ""}
        ${o.status === "pendiente" ? `<div class="actions"><button class="btn bad small" data-cancel="${o.id}">Cancelar pedido</button></div>` : ""}
      </div>`).join("");
  }

  $("#my-orders").addEventListener("click", (e) => {
    const id = e.target.closest("[data-cancel]")?.dataset.cancel;
    if (!id || !confirm("¿Seguro que quieres cancelar este pedido?")) return;
    withBusy(e.target, async () => {
      await updateDoc(doc(db, "orders", id), { status: "cancelado" });
      toast("Pedido cancelado.");
    });
  });

  // =================================================================== ADMIN
  $$("[data-admin-tab]").forEach((b) => b.addEventListener("click", () => {
    $$("[data-admin-tab]").forEach((x) => x.classList.toggle("active", x === b));
    $$("[data-admin-panel]").forEach((p) => show(p, p.dataset.adminPanel === b.dataset.adminTab));
  }));
  $("#status-filter").addEventListener("change", renderAdminOrders);
  $("#search").addEventListener("input", renderAdminOrders);

  function renderAdmin() {
    renderPricesEditor();
    renderStats();
    renderPlaces();
    renderAdminOrders();
    renderAccounts();
    renderCodes();
  }

  function renderStats() {
    const billable = allOrders.filter((o) => BILLABLE.includes(o.status));
    const cobrado = billable.filter((o) => o.paid).reduce((s, o) => s + (o.total || 0), 0);
    const debe = billable.filter((o) => !o.paid).reduce((s, o) => s + (o.total || 0), 0);
    const pend = allOrders.filter((o) => o.status === "pendiente").length;
    const codeUses = allOrders.filter((o) => o.promoCode === CODE_LIST[0] && !["cancelado"].includes(o.status));
    const codePeople = new Set(codeUses.map((o) => o.uid)).size;
    $("#stats").innerHTML = `
      <div class="stat"><div class="n">${pend}</div><div class="l">Pedidos pendientes</div></div>
      <div class="stat"><div class="n">${allOrders.filter((o) => ["aceptado", "listo"].includes(o.status)).length}</div><div class="l">Aceptados / listos</div></div>
      <div class="stat"><div class="n">${money(cobrado)}</div><div class="l">Cobrado</div></div>
      <div class="stat"><div class="n">${money(debe)}</div><div class="l">Te deben</div></div>
      ${CODE_LIST.length ? `<div class="stat hl"><div class="n">${codePeople}</div><div class="l">Personas con «${esc(CODE_LIST[0])}» (${codeUses.length} pedidos)</div></div>` : ""}`;
  }

  function renderPlaces() {
    const places = new Set(PICKUP_PLACES);
    allOrders.forEach((o) => o.pickupPlace && places.add(o.pickupPlace));
    $("#places-list").innerHTML = [...places].map((p) => `<option value="${esc(p)}"></option>`).join("");
  }

  function matchesFilter(o, f) {
    switch (f) {
      case "activos": return ["pendiente", "aceptado", "listo"].includes(o.status);
      case "debe": return BILLABLE.includes(o.status) && !o.paid;
      case "cerrados": return ["rechazado", "cancelado"].includes(o.status);
      case "todos": return true;
      default: return o.status === f;
    }
  }

  function priceForm(o, isEdit) {
    // Fecha por defecto: mañana a las 17:00
    let defTime = o.pickupTime || "";
    if (!defTime) {
      const d = new Date(Date.now() + 864e5);
      d.setHours(17, 0, 0, 0);
      defTime = new Date(d - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 16);
    }
    const suggested = calcPrice(o);
    const startPrice = o.price ?? (Object.keys(o.items || {}).length ? suggested.base : "");
    return `
      <div class="accept-form" data-form="${o.id}">
        <label>Precio base (€)${o.keychain || codeInfo(o.promoCode) ? " — sin llavero ni descuento" : ""}
          <input type="number" name="price" min="0" step="0.01" inputmode="decimal" value="${startPrice}" placeholder="0,00" />
        </label>
        <div class="total-preview" data-total>${startPrice === "" ? "" : totalPreview(o, Number(startPrice))}</div>
        <label>🕒 Hora de recogida
          <input type="datetime-local" name="pickupTime" value="${esc(defTime)}" />
        </label>
        <label>📍 Lugar de recogida
          <input name="pickupPlace" list="places-list" maxlength="120" value="${esc(o.pickupPlace || "")}" placeholder="Ej: Puerta del instituto" />
        </label>
        <label class="full">💬 Nota para tu amigo (opcional)
          <input name="adminNote" maxlength="300" value="${esc(o.adminNote || "")}" />
        </label>
        <div class="actions full">
          ${isEdit
            ? `<button class="btn primary small" data-act="save" data-id="${o.id}">Guardar cambios</button>`
            : `<button class="btn ok" data-act="accept" data-id="${o.id}">✅ Aceptar pedido</button>
               <button class="btn bad" data-act="reject" data-id="${o.id}">Rechazar</button>`}
        </div>
      </div>`;
  }

  function adminOrderCard(o) {
    const isPending = o.status === "pendiente";
    const billable = BILLABLE.includes(o.status);
    return `
      <div class="order">
        <div class="order-head">
          <div>
            <div class="order-who">${esc(o.userName)}</div>
            <div class="muted small">${esc(o.userEmail)} · #${shortId(o.id)} · ${fmtDate(o.createdAt)}</div>
          </div>
          <div class="tags">
            <span class="badge st-${esc(o.status)}">${STATUS[o.status] || esc(o.status)}</span>
            ${payBadge(o)}
          </div>
        </div>
        ${o.description ? `<div class="order-desc">${esc(o.description)}</div>` : ""}
        ${orderTags(o)}
        ${pickupBox(o)}
        ${o.adminNote && !isPending ? `<div class="note">💬 ${esc(o.adminNote)}</div>` : ""}
        ${isPending ? priceForm(o, false) : ""}
        ${billable ? `
          <div class="actions">
            <button class="btn small ${o.paid ? "" : "ok"}" data-act="paid" data-id="${o.id}">
              ${o.paid ? "↩️ Marcar como NO pagado" : "💶 Marcar como pagado"}</button>
            ${o.status === "aceptado" ? `<button class="btn small" data-act="ready" data-id="${o.id}">📦 Marcar listo</button>` : ""}
            ${o.status !== "entregado" ? `<button class="btn small" data-act="delivered" data-id="${o.id}">🤝 Marcar entregado</button>` : ""}
          </div>
          <details><summary>Editar precio / hora / lugar</summary>${priceForm(o, true)}</details>` : ""}
        <div class="actions">
          ${["rechazado", "cancelado"].includes(o.status) ? `<button class="btn small" data-act="reopen" data-id="${o.id}">Volver a pendiente</button>` : ""}
          <button class="btn bad small" data-act="delete" data-id="${o.id}">🗑️ Borrar</button>
        </div>
      </div>`;
  }

  function renderAdminOrders() {
    const f = $("#status-filter").value;
    const q = $("#search").value.trim().toLowerCase();
    const list = allOrders.filter((o) => matchesFilter(o, f)).filter((o) => !q ||
      [o.userName, o.userEmail, o.description, o.pickupPlace, o.promoCode].join(" ").toLowerCase().includes(q));
    const box = $("#admin-order-list");
    // No repintar si el admin está escribiendo en un formulario de esta lista
    if (box.contains(document.activeElement) && document.activeElement.matches("input")) return;
    box.innerHTML = list.length ? list.map(adminOrderCard).join("") : `<div class="empty">No hay pedidos aquí.</div>`;
  }

  // Vista previa del total al escribir el precio
  $("#admin-order-list").addEventListener("input", (e) => {
    if (e.target.name !== "price") return;
    const form = e.target.closest("[data-form]");
    const o = allOrders.find((x) => x.id === form.dataset.form);
    const p = parseFloat(e.target.value.replace(",", "."));
    form.querySelector("[data-total]").innerHTML = isNaN(p) ? "" : totalPreview(o, p);
  });

  function totalPreview(o, base) {
    const c = calcPrice(o, base);
    return `${breakdownHtml(c, { showSubtotal: false })}<div class="row total"><span>Total</span><span>${money(c.total)}</span></div>`;
  }

  function readPriceForm(id) {
    const form = $(`#admin-order-list [data-form="${id}"]`);
    const price = parseFloat(form.querySelector("[name=price]").value.replace(",", "."));
    const pickupTime = form.querySelector("[name=pickupTime]").value;
    const pickupPlace = form.querySelector("[name=pickupPlace]").value.trim();
    const adminNote = form.querySelector("[name=adminNote]").value.trim();
    if (isNaN(price) || price < 0) throw new Error("Pon un precio válido.");
    if (!pickupTime) throw new Error("Pon la hora de recogida.");
    if (!pickupPlace) throw new Error("Pon el lugar de recogida.");
    const o = allOrders.find((x) => x.id === id);
    const c = calcPrice(o, price);
    return {
      price: c.base,
      discountPct: c.pct,
      total: c.total,
      pickupTime, pickupPlace, adminNote,
    };
  }

  $("#admin-order-list").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-act]");
    if (!btn) return;
    const { act, id } = btn.dataset;
    const ref = doc(db, "orders", id);
    const o = allOrders.find((x) => x.id === id);
    withBusy(btn, async () => {
      switch (act) {
        case "accept":
          await updateDoc(ref, { ...readPriceForm(id), status: "aceptado", acceptedAt: serverTimestamp() });
          toast(`Pedido de ${o.userName} aceptado.`);
          break;
        case "save":
          await updateDoc(ref, readPriceForm(id));
          toast("Cambios guardados.");
          break;
        case "reject": {
          const note = prompt("Motivo del rechazo (opcional, lo verá tu amigo):", "");
          if (note === null) return;
          await updateDoc(ref, { status: "rechazado", adminNote: note.trim().slice(0, 300) });
          toast("Pedido rechazado.");
          break;
        }
        case "paid":
          await updateDoc(ref, { paid: !o.paid, paidAt: o.paid ? null : serverTimestamp() });
          toast(o.paid ? "Marcado como NO pagado." : `💶 ${o.userName} ha pagado ${money(o.total)}.`);
          break;
        case "ready":
          await updateDoc(ref, { status: "listo" });
          break;
        case "delivered":
          await updateDoc(ref, { status: "entregado", deliveredAt: serverTimestamp() });
          break;
        case "reopen":
          await updateDoc(ref, { status: "pendiente" });
          break;
        case "delete":
          if (!confirm("¿Borrar este pedido para siempre?")) return;
          await deleteDoc(ref);
          toast("Pedido borrado.");
          break;
      }
    });
  });

  // ---------- Cuentas: quién ha pagado y quién debe ----------
  function renderAccounts() {
    const people = new Map();
    allOrders.filter((o) => BILLABLE.includes(o.status)).forEach((o) => {
      const p = people.get(o.uid) || { name: o.userName, email: o.userEmail, total: 0, paid: 0, n: 0, owed: [] };
      p.n++;
      p.total += o.total || 0;
      if (o.paid) p.paid += o.total || 0; else p.owed.push(o);
      people.set(o.uid, p);
    });
    const rows = [...people.values()].sort((a, b) => (b.total - b.paid) - (a.total - a.paid));
    const debtors = rows.filter((p) => p.owed.length);
    const totalOwed = rows.reduce((s, p) => s + p.total - p.paid, 0);

    $("#admin-accounts").innerHTML = `
      <div class="card">
        <h3>🔴 Quién te debe (${money(totalOwed)})</h3>
        ${debtors.length ? debtors.map((p) => `
          <div class="order" style="margin-bottom:10px">
            <div class="order-head">
              <div><div class="order-who">${esc(p.name)}</div><div class="muted small">${esc(p.email)}</div></div>
              <span class="badge owes">Debe ${money(p.total - p.paid)}</span>
            </div>
            ${p.owed.map((o) => `
              <div class="actions" style="align-items:center;justify-content:space-between">
                <span class="small">#${shortId(o.id)} · ${esc((o.description || itemsText(o.items)).slice(0, 50))}${(o.description || itemsText(o.items)).length > 50 ? "…" : ""} · <strong>${money(o.total)}</strong></span>
                <button class="btn ok small" data-pay="${o.id}">💶 Pagado</button>
              </div>`).join("")}
          </div>`).join("") : `<div class="empty">Nadie te debe nada 🎉</div>`}
      </div>
      <div class="card">
        <h3>📒 Resumen por persona</h3>
        ${rows.length ? `<div class="table-wrap"><table>
          <thead><tr><th>Persona</th><th class="num">Pedidos</th><th class="num">Total</th><th class="num">Pagado</th><th class="num">Debe</th></tr></thead>
          <tbody>${rows.map((p) => `<tr>
            <td><strong>${esc(p.name)}</strong><br><span class="muted small">${esc(p.email)}</span></td>
            <td class="num">${p.n}</td>
            <td class="num">${money(p.total)}</td>
            <td class="num" style="color:var(--ok)">${money(p.paid)}</td>
            <td class="num" style="color:${p.total - p.paid > 0 ? "var(--bad)" : "var(--muted)"}">${money(p.total - p.paid)}</td>
          </tr>`).join("")}</tbody></table></div>` : `<div class="empty">Todavía no hay pedidos aceptados.</div>`}
      </div>`;
  }

  $("#admin-accounts").addEventListener("click", (e) => {
    const id = e.target.closest("[data-pay]")?.dataset.pay;
    if (!id) return;
    const o = allOrders.find((x) => x.id === id);
    withBusy(e.target, async () => {
      await updateDoc(doc(db, "orders", id), { paid: true, paidAt: serverTimestamp() });
      toast(`💶 ${o.userName} ha pagado ${money(o.total)}.`);
    });
  });

  // ---------- Sin filamento: cancelar todo lo que no está hecho ----------
  $("#no-filament").addEventListener("click", (e) => {
    const targets = allOrders.filter((o) => ["pendiente", "aceptado"].includes(o.status));
    if (!targets.length) return toast("No hay pedidos sin hacer que cancelar.");
    const paid = targets.filter((o) => o.paid);
    const msg = `¿Cancelar ${targets.length} pedido${targets.length === 1 ? "" : "s"} sin hacer (pendientes y aceptados)?` +
      (paid.length ? `\n\n⚠️ ${paid.length} ya estaba${paid.length === 1 ? "" : "n"} pagado${paid.length === 1 ? "" : "s"}: tendrás que devolver el dinero.` : "") +
      "\n\nLos pedidos marcados como listos o entregados no se tocan.";
    if (!confirm(msg)) return;
    withBusy(e.currentTarget, async () => {
      for (let i = 0; i < targets.length; i += 400) {
        const b = writeBatch(db);
        targets.slice(i, i + 400).forEach((o) => b.update(doc(db, "orders", o.id), {
          status: "cancelado",
          adminNote: "Me he quedado sin filamento 😢 Vuelve a pedirlo más adelante.",
          cancelledAt: serverTimestamp(),
        }));
        await b.commit();
      }
      toast(`🧵 ${targets.length} pedido${targets.length === 1 ? "" : "s"} cancelado${targets.length === 1 ? "" : "s"}.`);
    });
  });

  // ---------- Precios (editables por el admin) ----------
  let pricesDirty = false;
  function priceRow(p) {
    return `<div class="price-row" data-row>
      <input name="emoji" value="${esc(p.emoji || "")}" maxlength="8" aria-label="Emoji" class="emoji-in" />
      <input name="name" value="${esc(p.name || "")}" maxlength="40" placeholder="Nombre" aria-label="Nombre" />
      <label class="euro"><input name="price" type="number" min="0" step="0.01" inputmode="decimal" value="${p.price ?? ""}" aria-label="Precio" /> €</label>
      <input name="id" type="hidden" value="${esc(p.id || "")}" />
      <button type="button" class="btn bad small" data-del-row aria-label="Quitar producto">✕</button>
    </div>`;
  }
  function renderPricesEditor() {
    if (pricesDirty) return; // no pisar lo que el admin está editando
    $("#admin-prices").innerHTML = `
      <div class="card">
        <h3>💶 Precios</h3>
        <p class="muted small">Los cambios se ven al momento en la web de tus amigos. Los pedidos ya aceptados mantienen su precio.</p>
        <div id="price-rows" class="price-rows">${catalog.map(priceRow).join("")}</div>
        <button type="button" class="btn small" id="add-product">➕ Añadir producto</button>
        <label class="keychain-row">🔑 Suplemento versión llavero
          <span class="euro"><input id="keychain-extra" type="number" min="0" step="0.01" inputmode="decimal" value="${keychainExtra}" /> €</span>
        </label>
        <div class="actions">
          <button type="button" class="btn primary" id="save-prices">Guardar precios</button>
          <button type="button" class="btn ghost" id="reset-prices">Deshacer cambios</button>
        </div>
      </div>`;
  }
  const slug = (t) => t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30) || "producto";

  $("#admin-prices").addEventListener("input", () => { pricesDirty = true; });
  $("#admin-prices").addEventListener("click", (e) => {
    if (e.target.closest("#add-product")) {
      pricesDirty = true;
      $("#price-rows").insertAdjacentHTML("beforeend", priceRow({ emoji: "🧊", name: "", price: "" }));
      $("#price-rows [data-row]:last-child [name=name]").focus();
    } else if (e.target.closest("[data-del-row]")) {
      pricesDirty = true;
      e.target.closest("[data-row]").remove();
    } else if (e.target.closest("#reset-prices")) {
      pricesDirty = false;
      renderPricesEditor();
    } else if (e.target.closest("#save-prices")) {
      withBusy(e.target, async () => {
        const used = new Set();
        const products = $$("#price-rows [data-row]").map((r) => {
          const name = r.querySelector("[name=name]").value.trim();
          const price = parseFloat(r.querySelector("[name=price]").value.replace(",", "."));
          if (!name) throw new Error("Hay un producto sin nombre.");
          if (isNaN(price) || price < 0) throw new Error(`Pon un precio válido a «${name}».`);
          let id = r.querySelector("[name=id]").value || slug(name);
          while (used.has(id)) id += "-2";
          used.add(id);
          return { id, name, emoji: r.querySelector("[name=emoji]").value.trim(), price: round2(price) };
        });
        const k = parseFloat($("#keychain-extra").value.replace(",", "."));
        if (isNaN(k) || k < 0) throw new Error("Pon un precio válido al llavero.");
        pricesDirty = false;
        await setDoc(doc(db, "settings", "shop"), { products, keychainExtra: round2(k), updatedAt: serverTimestamp() });
        toast("✅ Precios guardados.");
      });
    }
  });

  // ---------- Códigos de apoyo ----------
  function renderCodes() {
    $("#admin-codes").innerHTML = CODE_LIST.map((code) => {
      const uses = allOrders.filter((o) => o.promoCode === code);
      const valid = uses.filter((o) => o.status !== "cancelado");
      const people = new Map();
      valid.forEach((o) => {
        const p = people.get(o.uid) || { name: o.userName, email: o.userEmail, n: 0, accepted: 0 };
        p.n++;
        if (BILLABLE.includes(o.status)) p.accepted++;
        people.set(o.uid, p);
      });
      return `
        <div class="card">
          <h3>🏷️ Código «${esc(code)}»</h3>
          <div class="stats">
            <div class="stat hl"><div class="n">${people.size}</div><div class="l">Personas distintas</div></div>
            <div class="stat"><div class="n">${valid.length}</div><div class="l">Pedidos con el código</div></div>
            <div class="stat"><div class="n">${valid.filter((o) => BILLABLE.includes(o.status)).length}</div><div class="l">De ellos aceptados</div></div>
          </div>
          ${people.size ? `<div class="table-wrap"><table>
            <thead><tr><th>Persona</th><th class="num">Pedidos</th><th class="num">Aceptados</th></tr></thead>
            <tbody>${[...people.values()].map((p) => `<tr>
              <td><strong>${esc(p.name)}</strong><br><span class="muted small">${esc(p.email)}</span></td>
              <td class="num">${p.n}</td><td class="num">${p.accepted}</td></tr>`).join("")}</tbody>
          </table></div>` : `<div class="empty">Nadie ha usado este código todavía.</div>`}
        </div>`;
    }).join("") || `<div class="empty">No hay códigos configurados.</div>`;
  }
}
