import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, connectAuthEmulator, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  signOut, sendEmailVerification, sendPasswordResetEmail,
  updateProfile,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, connectFirestoreEmulator, collection, addDoc, doc, setDoc, getDoc, updateDoc, deleteDoc, writeBatch,
  query, where, orderBy, onSnapshot, serverTimestamp, increment, limit, runTransaction,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  firebaseConfig, SITE_NAME, PRICE_NOTICE, EMAILJS, ADMIN_EMAIL, COOWNER_EMAILS, ROLE_SEEDS, KEYCHAIN_EXTRA, PRODUCTS, PROMO_CODES, OFFERS, PICKUP_PLACES,
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

// ---------------------------------------------------------------- fotos y novedades
const PHOTO_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;
const MAX_PHOTOS = 4;
const PHOTO_BUDGET = 210000; // ~210 KB por foto: 4 caben en un documento

// Reduce y comprime una foto en el navegador (las fotos del móvil pesan mucho)
async function compressImage(file, { side: maxSide = 1280, budget = PHOTO_BUDGET } = {}) {
  let src;
  try {
    src = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    src = await new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = () => rej(new Error("No se ha podido leer esa foto."));
      img.src = URL.createObjectURL(file);
    });
  }
  const canvas = document.createElement("canvas");
  let side = maxSide;
  for (let attempt = 0; attempt < 6; attempt++) {
    const w0 = src.width, h0 = src.height;
    const k = Math.min(1, side / Math.max(w0, h0));
    canvas.width = Math.round(w0 * k);
    canvas.height = Math.round(h0 * k);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(src, 0, 0, canvas.width, canvas.height);
    for (const q of [0.8, 0.7, 0.6, 0.5]) {
      const url = canvas.toDataURL("image/jpeg", q);
      if (url.length <= budget) return url;
    }
    side = Math.round(side * 0.75);
  }
  throw new Error("Esa foto es demasiado grande.");
}

function progressHtml(o) {
  if (o.progress == null || !BILLABLE.includes(o.status) || o.status === "entregado") return "";
  const p = Math.max(0, Math.min(100, Number(o.progress) || 0));
  return `<div class="progress-wrap">
    <div class="small"><strong>🖨️ Progreso: ${p}%</strong></div>
    <div class="progress" role="progressbar" aria-valuenow="${p}" aria-valuemin="0" aria-valuemax="100"><div style="width:${p}%"></div></div>
  </div>`;
}

function updatesHtml(list, { admin = false, orderId = "" } = {}) {
  if (!list?.length) return admin ? `<div class="muted small">Todavía no has publicado nada.</div>` : "";
  return list.map((u) => `
    <div class="update">
      <div class="when"><span>${fmtDate(u.createdAt)}${u.progress != null ? ` · ${Number(u.progress) || 0}%` : ""}</span>
        ${admin ? `<button type="button" class="btn bad small" data-del-upd="${esc(u.id)}" data-order="${esc(orderId)}">Borrar</button>` : ""}</div>
      ${u.text ? `<div class="txt">${esc(u.text)}</div>` : ""}
      ${(u.photos || []).filter((p) => PHOTO_RE.test(p)).length ? `<div class="photos">${u.photos.filter((p) => PHOTO_RE.test(p))
        .map((p) => `<img src="${p}" alt="Foto del pedido" loading="lazy" data-zoom />`).join("")}</div>` : ""}
    </div>`).join("");
}

// ---------------------------------------------------------------- rickroll
// Carga la API oficial de YouTube una sola vez
let ytApi = null;
function loadYouTubeApi() {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  ytApi ||= new Promise((resolve, reject) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { prev?.(); resolve(window.YT); };
    const s = document.createElement("script");
    s.src = "https://www.youtube.com/iframe_api";
    s.onerror = () => { ytApi = null; reject(new Error("YouTube no carga")); };
    document.head.appendChild(s);
  });
  return ytApi;
}

const RICK_ID = "dQw4w9WgXcQ";
const RICK_START = 43;    // segundo donde empieza el estribillo
const RICK_SECONDS = 5;   // cuánto suena
const RICK_MAX_WAIT = 30; // si no llega a sonar (anuncio largo, sin red…), se aplica igual

function rickroll(onDone) {
  const ov = $("#rick");
  const frame = $("#rick-frame");
  const count = $("#rick-count");
  const msg = $("#rick-msg");
  const hint = $("#rick-hint");
  const cover = $("#rick-cover");
  frame.innerHTML = `<div id="rick-player"></div>`;
  msg.textContent = "Abriendo tu regalo…";
  cover.classList.remove("open");
  show(hint, false);
  show(ov);

  let player = null;
  let finished = false;
  let countdown = null;
  const finish = () => {
    if (finished) return;
    finished = true;
    clearInterval(countdown);
    clearTimeout(hintTimer);
    clearTimeout(maxTimer);
    try { player?.destroy(); } catch { /* ignorar */ }
    frame.innerHTML = "";
    show(ov, false);
    onDone?.();
  };
  // La cuenta atrás empieza cuando de verdad suena la canción (no durante un anuncio)
  const startCountdown = () => {
    if (countdown || finished) return;
    show(hint, false);
    cover.classList.add("open"); // ¡sorpresa!
    let left = RICK_SECONDS;
    msg.innerHTML = `😂 ¡Te la he colado! Tu descuento llega en <span id="rick-count">${left}</span>…`;
    countdown = setInterval(() => {
      left--;
      const c = $("#rick-count");
      if (c) c.textContent = left;
      if (left <= 0) finish();
    }, 1000);
  };
  // En iPhone Safari no deja sonar sin tocar: avisar
  const hintTimer = setTimeout(() => { if (!countdown) show(hint); }, 3500);
  const maxTimer = setTimeout(finish, RICK_MAX_WAIT * 1000);

  loadYouTubeApi().then((YT) => {
    if (finished) return;
    player = new YT.Player("rick-player", {
      host: "https://www.youtube-nocookie.com",
      videoId: RICK_ID,
      playerVars: {
        autoplay: 1, start: RICK_START, controls: 0, disablekb: 1, fs: 0,
        modestbranding: 1, playsinline: 1, rel: 0, iv_load_policy: 3,
      },
      events: {
        onReady: (e) => { e.target.unMute(); e.target.setVolume(100); e.target.playVideo(); },
        onStateChange: (e) => {
          // Solo cuenta si ya está en el estribillo (un anuncio empieza en 0)
          if (e.data === YT.PlayerState.PLAYING && e.target.getCurrentTime() >= RICK_START - 1) startCountdown();
          else if (e.data === YT.PlayerState.PLAYING) {
            const check = setInterval(() => {
              if (finished) return clearInterval(check);
              try {
                if (e.target.getCurrentTime() >= RICK_START - 1) { clearInterval(check); startCountdown(); }
              } catch { clearInterval(check); }
            }, 300);
          }
        },
        onError: () => setTimeout(finish, 1500),
      },
    });
  }).catch(() => setTimeout(finish, 2000));
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
// "owner" = dueño, "coowner" = co-dueño, null = amigo
const roleOfEmail = (email) => {
  const e = (email || "").toLowerCase();
  if (e === ADMIN_EMAIL.toLowerCase()) return "owner";
  if ((COOWNER_EMAILS || []).some((x) => x.toLowerCase() === e)) return "coowner";
  return null;
};
const ROLE_LABEL = { owner: "👑 Dueño", coowner: "🤝 Co-dueño" };

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
// Avisos de arriba del todo. Se editan en el panel (settings/notices);
// mientras no haya ninguno guardado se usa PRICE_NOTICE de config.js
const NOTICE_COLORS = { rojo: "🔴 Rojo", amarillo: "🟡 Amarillo", verde: "🟢 Verde", azul: "🔵 Azul" };
let notices = (PRICE_NOTICE?.title || PRICE_NOTICE?.text)
  ? [{ title: PRICE_NOTICE.title || "", text: PRICE_NOTICE.text || "", color: "rojo", active: true }] : [];
function noticeHtml(n) {
  const c = NOTICE_COLORS[n.color] ? n.color : "rojo";
  return `<div class="notice notice-${c}" role="${c === "rojo" ? "alert" : "status"}">
    ${n.title ? `<div class="pn-title">${esc(n.title)}</div>` : ""}
    ${n.text ? `<div class="pn-text">${esc(n.text)}</div>` : ""}
  </div>`;
}
function renderNotices() {
  const html = notices.filter((n) => n.active && (n.title || n.text)).map(noticeHtml).join("");
  $$(".notices").forEach((el) => { el.innerHTML = html; });
}
renderNotices();
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
  let isAdmin = false; // dueño o co-dueño (verificado)
  let myRole = null;  // "owner" | "coowner" | null
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
  // Recuadro grande que explica el precio (portada y página de pedidos)
  function renderValueBox() {
    const prices = catalog.map((p) => Number(p.price)).filter((x) => x > 0);
    const from = prices.length ? money(Math.min(...prices)) : "";
    const html = `
      <div class="vb-head">💡 ¿Por qué cuesta lo que cuesta?</div>
      <p class="vb-sub">Cada figura se imprime <strong>una a una, solo para ti</strong>. El precio solo cubre lo que cuesta hacerla:</p>
      <div class="vb-grid">
        <div class="vb-item"><span class="vb-ico">🧵</span><strong>Filamento</strong><small>El plástico con el que se imprime</small></div>
        <div class="vb-item"><span class="vb-ico">⚡</span><strong>Electricidad</strong><small>La impresora pasa horas encendida</small></div>
        <div class="vb-item"><span class="vb-ico">⏱️</span><strong>Tiempo</strong><small>Cada pieza tarda horas en imprimirse</small></div>
        <div class="vb-item"><span class="vb-ico">🛠️</span><strong>Esfuerzo</strong><small>Prepararla, quitar soportes y dejarla bien acabada</small></div>
      </div>
      <ul class="vb-why">
        ${from ? `<li>💸 <span><strong>Desde ${from}</strong>: precio de amigo, no de tienda</span></li>` : ""}
        <li>🎨 <span><strong>Hecho a tu gusto</strong>: me dices color, tamaño o detalles</span></li>
        <li>📦 <span><strong>Sin gastos de envío</strong>: lo recoges en mano</span></li>
        <li>💶 <span><strong>Nada por adelantado</strong>: pagas en efectivo al recogerlo</span></li>
        <li>🎁 <span><strong>${CODE_LIST.length ? "Ofertas y códigos de descuento" : "Ofertas"}</strong> para ahorrar aún más</span></li>
      </ul>`;
    $$(".value-box").forEach((el) => { el.innerHTML = html; });
  }

  function renderProducts() {
    renderValueBox();
    const prev = getItems();
    $("#keychain-price").textContent = `(+${money(keychainExtra)})`;
    $("#products").innerHTML = catalog.length ? catalog.map((p) => `
    <div class="product">
      ${p.photo && PHOTO_RE.test(p.photo)
        ? `<img class="p-photo" src="${p.photo}" alt="${esc(p.name)}" data-zoom />`
        : `<div class="p-emoji">${esc(p.emoji)}</div>`}
      <div class="p-info"><strong>${esc(p.name)}</strong><span class="muted small">${money(p.price)}</span>
        ${stockOf(p.id) == null ? "" : stockOf(p.id) > 0
          ? `<span class="stock-ok">✅ Quedan ${stockOf(p.id)}</span>`
          : `<span class="stock-out">❌ Agotado</span>`}</div>
      <div class="stepper">
        <button type="button" class="btn small" data-step="-1" data-pid="${esc(p.id)}" aria-label="Quitar">−</button>
        <input type="number" min="0" max="${maxQty(p.id)}" value="0" data-qty="${esc(p.id)}" aria-label="Cantidad de ${esc(p.name)}" ${maxQty(p.id) ? "" : "disabled"} />
        <button type="button" class="btn small" data-step="1" data-pid="${esc(p.id)}" aria-label="Añadir" ${maxQty(p.id) ? "" : "disabled"}>+</button>
      </div>
    </div>`).join("") : `<p class="muted small">Ahora mismo no hay productos fijos: escribe abajo lo que quieres.</p>`;
    setItems(prev);
    updateSummary();
  }

  const getItems = () => {
    const items = {};
    $$("[data-qty]").forEach((i) => {
      const q = Math.max(0, Math.min(maxQty(i.dataset.qty), parseInt(i.value, 10) || 0));
      if (q) items[i.dataset.qty] = q;
    });
    return items;
  };
  const setItems = (items) => $$("[data-qty]").forEach((i) => {
    i.value = Math.min(items[i.dataset.qty] || 0, maxQty(i.dataset.qty));
  });

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
    const max = maxQty(b.dataset.pid);
    const next = (parseInt(inp.value, 10) || 0) + Number(b.dataset.step);
    if (next > max && stockOf(b.dataset.pid) != null) toast(`Solo quedan ${max}.`, true);
    inp.value = Math.max(0, Math.min(max, next));
    updateSummary();
  });
  $("#order-form").addEventListener("input", updateSummary);
  $("#order-form").addEventListener("change", updateSummary);

  offerSelect.addEventListener("change", () => {
    const o = OFFERS.find((x) => x.id === offerSelect.value);
    if (o?.items) {
      setItems({ ...getItems(), ...Object.fromEntries(
        Object.entries(o.items).map(([id, q]) => [id, Math.max(q, getItems()[id] || 0)])) });
      const short = Object.entries(o.items).filter(([id, q]) => maxQty(id) < q);
      if (short.length) toast(`No hay stock suficiente de ${short.map(([id]) => productOf(id)?.name || id).join(", ")} para la oferta.`, true);
    }
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

  // Avisos en directo
  onSnapshot(doc(db, "settings", "notices"), (snap) => {
    if (!snap.exists()) return;
    notices = Array.isArray(snap.data().items) ? snap.data().items : [];
    renderNotices();
    if (isAdmin) renderNoticeEditor();
  }, (e) => console.error(e));

  // Stock en directo (stock/{producto} = { qty }). Sin documento = sin límite.
  let stock = {};
  function stockOf(id) { return stock[id] == null ? null : stock[id]; }
  function maxQty(id) { return stockOf(id) == null ? 50 : Math.max(0, Math.min(50, stockOf(id))); }
  onSnapshot(collection(db, "stock"), (snap) => {
    stock = Object.fromEntries(snap.docs.map((d) => [d.id, Number(d.data().qty) || 0]));
    renderProducts();
    if (isAdmin) renderPricesEditor();
  }, (e) => console.error(e));

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

  if (!CODE_LIST.length) {
    show($("#promo-field"), false);
    show($("#codes-tab"), false);
  }

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
      if (!CODES_ON || roleOfEmail(cred.user.email)) {
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
  let currentView = "";
  function setView(view) {
    currentView = view;
    show($("#blocked-view"), view === "blocked");
    show($("#client-view"), view === "client");
    show($("#admin-view"), view === "admin");
    show($("#chat-view"), view === "chat");
    $("#nav-client").classList.toggle("active", view === "client");
    $("#nav-admin").classList.toggle("active", view === "admin");
    $("#nav-chat").classList.toggle("active", view === "chat");
    if (view === "chat") openUserChat();
    else if (userChatPanel) { userChatPanel.close(); userChatPanel = null; }
  }
  $("#nav-client").addEventListener("click", () => setView("client"));
  $("#nav-admin").addEventListener("click", () => setView("admin"));
  $("#nav-chat").addEventListener("click", () => setView("chat"));

  function renderHeader() {
    $("#nav-user").textContent = profileName || currentUser?.email || "";
  }

  // ---------- Estado de sesión ----------
  onAuthStateChanged(auth, async (user) => {
    unsubs.forEach((u) => u());
    unsubs = [];
    firstOrdersLoad = true;
    Object.values(updUnsubs).forEach((u) => u());
    updUnsubs = {};
    updatesCache = {};
    userChatPanel?.close();
    userChatPanel = null;
    adminChatPanel?.close();
    adminChatPanel = null;
    myChat = null;
    allChats = [];
    firstChatsLoad = true;
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

    // ¿Está baneado? (se gestiona en el panel → Ban)
    let banned = false;
    try { banned = (await getDoc(doc(db, "bans", user.email.toLowerCase()))).exists(); } catch (e) { console.error(e); }
    // si le banean o le desbanean con la web abierta, se recarga
    unsubs.push(onSnapshot(doc(db, "bans", user.email.toLowerCase()), (s) => {
      if (s.exists() !== banned) location.reload();
    }, () => {}));
    if (banned) {
      // cuenta bloqueada: solo puede salir
      isAdmin = false;
      myRole = null;
      show($("#verify-banner"), false);
      show($("#nav-admin"), false);
      show($("#nav-chat"), false);
      show($("#nav-client"), false);
      $("#nav-user").textContent = user.email;
      setView("blocked");
      return;
    }
    show($("#nav-client"));
    // Rango: dueño por su correo; el resto, el que le dé el dueño en el panel (roles/{uid})
    let emailRole = roleOfEmail(user.email);
    if (!emailRole) {
      try {
        const r = await getDoc(doc(db, "roles", user.uid));
        if (r.exists() && r.data().role === "coowner") emailRole = "coowner";
      } catch (e) { console.error(e); }
      // si le dan o le quitan el rango con la web abierta, se recarga
      unsubs.push(onSnapshot(doc(db, "roles", user.uid), (s) => {
        const nr = s.exists() && s.data().role === "coowner" ? "coowner" : null;
        if (nr !== emailRole) location.reload();
      }, () => {}));
    }
    const emailIsAdmin = Boolean(emailRole);
    if (emailIsAdmin && !user.emailVerified) {
      // ¿ya ha abierto el enlace? actualizar sin tener que salir y entrar
      try {
        await user.reload();
        if (auth.currentUser?.emailVerified) await auth.currentUser.getIdToken(true);
      } catch (e) { console.error(e); }
    }
    const verifiedNow = Boolean(auth.currentUser?.emailVerified);
    if (emailRole === "coowner" && !verifiedNow) {
      // mandarle solo el enlace para activar el rango (como mucho una vez al día)
      const key = "rankLink:" + user.uid;
      let last = 0;
      try { last = Number(localStorage.getItem(key)) || 0; } catch { /* sin almacenamiento */ }
      if (Date.now() - last > 864e5) {
        sendEmailVerification(user).then(() => {
          try { localStorage.setItem(key, String(Date.now())); } catch { /* ignorar */ }
          toast("📧 Te he enviado un enlace a tu correo para activar tu rango de co-dueño.");
        }).catch((e) => console.error(e));
      }
    }
    isAdmin = emailIsAdmin && verifiedNow;
    myRole = isAdmin ? emailRole : null;
    document.body.classList.toggle("coowner", myRole === "coowner");
    $("#admin-title").textContent = myRole === "coowner" ? "🤝 Panel de co-dueño" : "🛠️ Panel de administrador";
    show($("#verify-banner"), (emailIsAdmin || !CODES_ON) && !verifiedNow);
    $("#verify-why").textContent = emailRole === "coowner" ? "para activar tu rango de 🤝 co-dueño"
      : emailIsAdmin ? "para activar el panel de administrador" : "para poder hacer pedidos";
    show($("#nav-admin"), isAdmin);
    show($("#nav-chat"), !emailIsAdmin);

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
        syncUpdateListeners();
        renderMyOrders();
      },
      (e) => toast(authError(e), true),
    ));

    if (isAdmin) {
      unsubs.push(onSnapshot(
        query(collection(db, "orders"), orderBy("createdAt", "desc")),
        (snap) => {
          allOrders = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
          checkNewOrders(snap);
          returnStock();
          renderAdmin();
        },
        (e) => toast(authError(e), true),
      ));
      if (myRole === "owner") {
        unsubs.push(onSnapshot(collection(db, "bans"), (snap) => {
          allBans = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
          renderBans();
        }, (e) => console.error(e)));
        unsubs.push(onSnapshot(collection(db, "users"), (snap) => {
          allUsers = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
          renderBans();
          renderRoles();
          renderAnalytics();
          runSeeds();
        }, (e) => console.error(e)));
        unsubs.push(onSnapshot(collection(db, "roles"), (snap) => {
          allRoles = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
          renderRoles();
        }, (e) => console.error(e)));
        unsubs.push(onSnapshot(doc(db, "settings", "migrations"), (snap) => {
          migrationsDone = snap.exists() ? (snap.data().applied || []) : [];
          runSeeds();
        }, (e) => console.error(e)));
      }
      unsubs.push(onSnapshot(
        query(collection(db, "chats"), orderBy("lastAt", "desc")),
        (snap) => {
          allChats = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
          checkNewChatMessages(snap);
          renderChatList();
        },
        (e) => console.error(e),
      ));
      setView("admin");
    } else {
      let prevUnread = null;
      unsubs.push(onSnapshot(doc(db, "chats", user.uid), (snap) => {
        myChat = snap.exists() ? snap.data() : null;
        const unread = myChat?.unreadUser || 0;
        $("#chat-badge").textContent = unread;
        show($("#chat-badge"), unread > 0 && currentView !== "chat");
        if (prevUnread !== null && unread > prevUnread && currentView !== "chat") {
          toast("💬 Tienes un mensaje nuevo del vendedor");
        }
        prevUnread = unread;
        if (currentView === "chat") markRead();
      }, (e) => console.error(e)));
      setView("client");
    }
  });

  // Precio del pedido: el que puso el equipo o, si no, el calculado al pedir
  const orderTotal = (o) => o.total ?? o.estimate ?? 0;
  const hasPrice = (o) => o.total != null || o.estimate != null;

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
      const orderRef = doc(collection(db, "orders"));
      await runTransaction(db, async (tx) => {
        // 1) leer el stock de lo que se pide
        const ids = Object.keys(items).filter((id) => stockOf(id) != null);
        const snaps = await Promise.all(ids.map((id) => tx.get(doc(db, "stock", id))));
        const fromStock = {};
        snaps.forEach((s, i) => {
          if (!s.exists()) return;
          const id = ids[i];
          const qty = Number(s.data().qty) || 0;
          if (qty < items[id]) {
            throw new Error(qty ? `Solo quedan ${qty} de ${productOf(id)?.name || id}.` : `${productOf(id)?.name || id} está agotado.`);
          }
          fromStock[id] = items[id];
        });
        // 2) restar el stock y crear el pedido a la vez
        Object.entries(fromStock).forEach(([id, q]) => {
          tx.update(doc(db, "stock", id), { qty: increment(-q), lastOrder: orderRef.id });
          // reserva: prueba de lo que este pedido ha sacado del stock
          tx.set(doc(db, "stock", id, "holds", orderRef.id), { uid: currentUser.uid, qty: q });
        });
        tx.set(orderRef, {
        uid: currentUser.uid,
        userName: (profileName || currentUser.email).slice(0, 60),
        userEmail: currentUser.email,
        description: description.slice(0, 1000),
        items,
        offer: f.offer.value,
        keychain: f.keychain.checked,
        promoCode,
        status: "aceptado",
        ...(Object.keys(items).length && {
          estimate: calcPrice({ items, offer: f.offer.value, keychain: f.keychain.checked, promoCode }).total,
        }),
        paid: false,
        ...(Object.keys(fromStock).length && { fromStock }),
        createdAt: serverTimestamp(),
      });
      });
      notifyAdminByEmail({ description, items, offer: f.offer.value, keychain: f.keychain.checked, promoCode });
      f.reset();
      codeApplied = "";
      codeMsg.textContent = "";
      updateSummary();
      toast("✅ ¡Pedido hecho! Te diré aquí la hora y el sitio para recogerlo.");
    });
  });

  // Te manda un correo a ti (admin) con cada pedido nuevo (si EmailJS está configurado)
  function notifyAdminByEmail(o) {
    if (!EMAILJS?.serviceId || !EMAILJS?.publicKey || !EMAILJS?.orderTemplateId) return;
    const c = calcPrice(o);
    fetch("https://api.emailjs.com/api/v1.0/email/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        service_id: EMAILJS.serviceId,
        template_id: EMAILJS.orderTemplateId,
        user_id: EMAILJS.publicKey,
        template_params: {
          to_email: ADMIN_EMAIL,
          site_name: SITE_NAME,
          username: profileName || currentUser.email,
          user_email: currentUser.email,
          items: itemsText(o.items) || "—",
          description: o.description || "—",
          offer: o.offer ? offerTitle(o.offer) : "—",
          keychain: o.keychain ? "Sí" : "No",
          promo_code: o.promoCode || "—",
          estimate: Object.keys(o.items).length ? money(c.total) : "a decidir",
          admin_url: location.origin + location.pathname,
        },
      }),
    }).catch(() => {});
  }

  // ---------- Novedades de mis pedidos (fotos y "cómo va") ----------
  let updUnsubs = {};
  let updatesCache = {};
  function syncUpdateListeners() {
    myOrders.filter((o) => o.updatesCount > 0 && !updUnsubs[o.id]).forEach((o) => {
      let first = true;
      updUnsubs[o.id] = onSnapshot(
        query(collection(db, "orders", o.id, "updates"), where("uid", "==", currentUser.uid)),
        (snap) => {
          updatesCache[o.id] = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => ms(b) - ms(a));
          if (!first && snap.docChanges().some((c) => c.type === "added" && !c.doc.metadata.hasPendingWrites)) {
            toast("📸 ¡Novedad en tu pedido!");
          }
          first = false;
          renderMyOrders();
        },
        (e) => console.error(e),
      );
    });
  }

  // Ver foto en grande (en cualquier sitio de la web)
  document.addEventListener("click", (e) => {
    const img = e.target.closest("img[data-zoom]");
    if (!img) return;
    $("#lightbox img").src = img.src;
    show($("#lightbox"));
  });
  $("#lightbox").addEventListener("click", () => show($("#lightbox"), false));

  // ---------- Mis pedidos ----------
  function orderTags(o) {
    const t = [];
    if (itemsText(o.items)) t.push(`<span class="tag">🧊 ${esc(itemsText(o.items))}</span>`);
    if (o.fromStock && Object.keys(o.fromStock).length) t.push(`<span class="tag">📦 Del stock: ${esc(itemsText(o.fromStock))}</span>`);
    if (o.offer) t.push(`<span class="tag">🔥 ${esc(offerTitle(o.offer))}</span>`);
    if (o.keychain) t.push(`<span class="tag">🔑 Llavero</span>`);
    if (o.promoCode) t.push(`<span class="tag">🏷️ ${esc(o.promoCode)}${codeInfo(o.promoCode)?.discount ? ` (−${codeInfo(o.promoCode).discount}%)` : ""}</span>`);
    return t.length ? `<div class="tags">${t.join("")}</div>` : "";
  }

  function payBadge(o) {
    if (!BILLABLE.includes(o.status)) return "";
    return o.paid
      ? `<span class="badge paid">💶 Pagado</span>`
      : `<span class="badge owes">💶 Pendiente de pago: ${hasPrice(o) ? money(orderTotal(o)) : "precio por decidir"}</span>`;
  }

  function pickupBox(o) {
    if (!BILLABLE.includes(o.status)) return "";
    const c = o.price != null ? calcPrice(o, o.price) : hasPrice(o) ? calcPrice(o) : null;
    return `<div class="pickup">
      ${c ? breakdownHtml(c, { showSubtotal: o.price == null }) : ""}
      <div>Precio: <strong>${hasPrice(o) ? money(orderTotal(o)) : "por decidir"}</strong> <span class="small">(en efectivo)</span></div>
      ${o.pickupPlace || o.pickupTime ? `
        <div>🕒 Recogida: <strong>${o.pickupTime ? esc(fmtPickup(o.pickupTime)) : "te lo digo pronto"}</strong></div>
        <div>📍 Lugar: <strong>${o.pickupPlace ? esc(o.pickupPlace) : "te lo digo pronto"}</strong></div>`
        : `<div>🕒📍 <strong>La hora y el sitio de recogida te los digo pronto.</strong></div>`}
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
        ${progressHtml(o)}
        ${o.adminNote ? `<div class="note">💬 ${esc(o.adminNote)}</div>` : ""}
        ${updatesCache[o.id]?.length ? `<div class="updates-title">📸 Cómo va</div><div class="updates">${updatesHtml(updatesCache[o.id])}</div>` : ""}
        ${["pendiente", "aceptado"].includes(o.status) && !o.paid ? `<div class="actions"><button class="btn bad small" data-cancel="${o.id}">Cancelar pedido</button></div>` : ""}
      </div>`).join("");
  }

  $("#my-orders").addEventListener("click", (e) => {
    const id = e.target.closest("[data-cancel]")?.dataset.cancel;
    if (!id || !confirm("¿Seguro que quieres cancelar este pedido?")) return;
    withBusy(e.target, async () => {
      const o = myOrders.find((x) => x.id === id);
      await runTransaction(db, async (tx) => {
        const ids = Object.keys(o?.fromStock || {});
        const holds = await Promise.all(ids.map((pid) => tx.get(doc(db, "stock", pid, "holds", id))));
        holds.forEach((h, i) => {
          if (!h.exists()) return;
          tx.update(doc(db, "stock", ids[i]), { qty: increment(Number(h.data().qty) || 0), lastOrder: id });
          tx.delete(h.ref);
        });
        tx.update(doc(db, "orders", id), { status: "cancelado", ...(ids.length && { stockReturned: true }) });
      });
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
    renderNoticeEditor();
    renderAnalytics();
    renderStats();
    renderPlaces();
    renderAdminOrders();
    renderAccounts();
    renderCodes();
  }

  function renderStats() {
    const billable = allOrders.filter((o) => BILLABLE.includes(o.status));
    const cobrado = billable.filter((o) => o.paid).reduce((s, o) => s + orderTotal(o), 0);
    const debe = billable.filter((o) => !o.paid).reduce((s, o) => s + orderTotal(o), 0);
    const pend = allOrders.filter((o) => o.status === "pendiente"
      || (o.status === "aceptado" && !o.pickupPlace)).length;
    const codeUses = allOrders.filter((o) => o.promoCode === CODE_LIST[0] && !["cancelado"].includes(o.status));
    const codePeople = new Set(codeUses.map((o) => o.uid)).size;
    $("#stats").innerHTML = `
      <div class="stat"><div class="n">${pend}</div><div class="l">Nuevos (sin hora ni sitio)</div></div>
      <div class="stat"><div class="n">${allOrders.filter((o) => ["aceptado", "listo"].includes(o.status)).length}</div><div class="l">En marcha / listos</div></div>
      <div class="stat owner-only"><div class="n">${money(cobrado)}</div><div class="l">Cobrado</div></div>
      <div class="stat owner-only"><div class="n">${money(debe)}</div><div class="l">Te deben</div></div>
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
            <button class="btn small owner-only ${o.paid ? "" : "ok"}" data-act="paid" data-id="${o.id}">
              ${o.paid ? "↩️ Marcar como NO pagado" : "💶 Marcar como pagado"}</button>
            ${o.status === "aceptado" ? `<button class="btn small" data-act="ready" data-id="${o.id}">📦 Marcar listo</button>` : ""}
            ${["aceptado", "listo"].includes(o.status) && !o.paid ? `<button class="btn bad small" data-act="reject" data-id="${o.id}">✖ Rechazar</button>` : ""}
            ${o.status !== "entregado" ? `<button class="btn small" data-act="delivered" data-id="${o.id}">🤝 Marcar entregado</button>` : ""}
            <button class="btn small primary" data-act="updates" data-id="${o.id}">📸 Contar cómo va${o.updatesCount ? ` (${o.updatesCount})` : ""}</button>
          </div>
          ${progressHtml(o)}
          <details ${o.pickupPlace ? "" : "open"}><summary>${o.pickupPlace ? "Editar precio / hora / lugar" : "📍 Poner hora y sitio de recogida"}</summary>${priceForm(o, true)}</details>` : ""}
        <div class="actions">
          ${["rechazado", "cancelado"].includes(o.status) ? `<button class="btn small" data-act="reopen" data-id="${o.id}">↩️ Volver a activar</button>` : ""}
          <button class="btn small" data-act="chat" data-id="${o.id}">💬 Chat con ${esc(o.userName)}</button>
          <button class="btn bad small owner-only" data-act="delete" data-id="${o.id}">🗑️ Borrar</button>
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
          toast(o.paid ? "Marcado como NO pagado." : `💶 ${o.userName} ha pagado ${money(orderTotal(o))}.`);
          break;
        case "ready":
          await updateDoc(ref, { status: "listo" });
          break;
        case "delivered":
          await updateDoc(ref, { status: "entregado", deliveredAt: serverTimestamp() });
          break;
        case "reopen":
          if (o.fromStock && o.stockReturned) {
            // vuelve a coger el stock que se devolvió
            await runTransaction(db, async (tx) => {
              const snaps = await Promise.all(Object.keys(o.fromStock).map((id) => tx.get(doc(db, "stock", id))));
              snaps.forEach((s, i) => {
                const id = Object.keys(o.fromStock)[i];
                if (s.exists() && (Number(s.data().qty) || 0) < o.fromStock[id]) throw new Error(`No queda stock de ${productOf(id)?.name || id}.`);
              });
              Object.entries(o.fromStock).forEach(([id, q]) => {
                if (!snaps[Object.keys(o.fromStock).indexOf(id)].exists()) return;
                tx.set(doc(db, "stock", id), { qty: increment(-q) }, { merge: true });
                tx.set(doc(db, "stock", id, "holds", o.id), { uid: o.uid, qty: q });
              });
              tx.update(ref, { status: "aceptado", stockReturned: false });
            });
          } else {
            await updateDoc(ref, { status: "aceptado" });
          }
          break;
        case "updates":
          openUpdates(o);
          break;
        case "chat":
          openAdminChat({ uid: o.uid, userName: o.userName, userEmail: o.userEmail });
          break;
        case "delete":
          if (!confirm("¿Borrar este pedido para siempre?")) return;
          if (o.fromStock && !o.stockReturned && !["entregado", "listo"].includes(o.status)) await returnStockOf(o);
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
      p.total += orderTotal(o);
      if (o.paid) p.paid += orderTotal(o); else p.owed.push(o);
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
                <span class="small">#${shortId(o.id)} · ${esc((o.description || itemsText(o.items)).slice(0, 50))}${(o.description || itemsText(o.items)).length > 50 ? "…" : ""} · <strong>${money(orderTotal(o))}</strong></span>
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
      toast(`💶 ${o.userName} ha pagado ${money(orderTotal(o))}.`);
    });
  });

  // ---------- Avisos de pedidos nuevos (sonido + notificación + título) ----------
  let firstOrdersLoad = true;
  let unseen = 0;
  let audioCtx = null;
  const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* sin almacenamiento */ } };
  let notifyOn = lsGet("notify") === "1";

  function updateNotifyUi() {
    const perm = "Notification" in window ? Notification.permission : "unsupported";
    $("#notify-btn").textContent = notifyOn ? "🔕 Desactivar" : "🔔 Activar avisos";
    $("#notify-status").textContent = !notifyOn
      ? "Con esta página abierta, te suena y te sale una notificación cada vez que alguien pide algo."
      : perm === "granted" ? "✅ Activados: sonido + notificación con la página abierta (aunque esté en otra pestaña)."
      : "✅ Sonido activado. El navegador no permite notificaciones: solo sonará y cambiará el título.";
  }
  updateNotifyUi();

  function beep() {
    try {
      audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
      [0, 0.18, 0.36].forEach((t, i) => {
        const o = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        o.type = "sine";
        o.frequency.value = [880, 1175, 1568][i];
        g.gain.setValueAtTime(0.0001, audioCtx.currentTime + t);
        g.gain.exponentialRampToValueAtTime(0.3, audioCtx.currentTime + t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + t + 0.16);
        o.connect(g).connect(audioCtx.destination);
        o.start(audioCtx.currentTime + t);
        o.stop(audioCtx.currentTime + t + 0.17);
      });
    } catch { /* sin audio */ }
  }

  $("#notify-btn").addEventListener("click", async () => {
    notifyOn = !notifyOn;
    lsSet("notify", notifyOn ? "1" : "0");
    if (notifyOn) {
      beep(); // desbloquea el audio y sirve de prueba
      if ("Notification" in window && Notification.permission === "default") {
        try { await Notification.requestPermission(); } catch { /* ignorar */ }
      }
    }
    updateNotifyUi();
  });

  function setTitleBadge() {
    document.title = unseen ? `(${unseen}) 🔔 ${SITE_NAME}` : SITE_NAME;
  }
  window.addEventListener("focus", () => { unseen = 0; setTitleBadge(); });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) { unseen = 0; setTitleBadge(); }
  });

  function checkNewOrders(snap) {
    if (firstOrdersLoad) { firstOrdersLoad = false; return; }
    const added = snap.docChanges()
      .filter((c) => c.type === "added" && !c.doc.metadata.hasPendingWrites)
      .map((c) => ({ id: c.doc.id, ...c.doc.data() }))
      .filter((o) => ["pendiente", "aceptado"].includes(o.status));
    if (!added.length) return;
    added.forEach((o) => {
      const what = itemsText(o.items) || (o.description || "").slice(0, 60);
      toast(`🛒 Pedido nuevo de ${o.userName}: ${what}`);
      if (notifyOn && "Notification" in window && Notification.permission === "granted") {
        try {
          const n = new Notification(`🛒 Pedido nuevo de ${o.userName}`, { body: what, tag: o.id });
          n.onclick = () => { window.focus(); setView("admin"); n.close(); };
        } catch { /* algunos móviles no dejan crear notificaciones así */ }
      }
    });
    if (notifyOn) beep();
    if (document.hidden || !document.hasFocus()) { unseen += added.length; setTitleBadge(); }
  }

  // =================================================================== CHAT
  // chats/{uid}: un chat por amigo con el vendedor. Mensajes en chats/{uid}/messages
  let userChatPanel = null;
  let adminChatPanel = null;
  let myChat = null;
  let allChats = [];
  let firstChatsLoad = true;
  let adminChatUid = null;

  const timeShort = (ts) => {
    if (!ts?.toDate) return "ahora";
    const d = ts.toDate();
    const today = new Date().toDateString() === d.toDateString();
    return d.toLocaleString("es-ES", today ? { hour: "2-digit", minute: "2-digit" } : { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  };

  // Crea un panel de chat dentro de `root`. side = "user" | "admin"
  function createChatPanel(root, { meta, side, title }) {
    const canPhoto = side === "admin";
    root.innerHTML = `
      <div class="chat-head"><div><div class="who">${esc(title)}</div>
        ${side === "admin" ? `<div class="muted small">${esc(meta.userEmail || "")}</div>` : ""}</div>
        ${side === "admin" ? `<button type="button" class="btn ghost small" data-chat-close aria-label="Cerrar chat">✕</button>` : ""}</div>
      <div class="chat-msgs" aria-live="polite"><div class="chat-empty">Cargando…</div></div>
      <div class="photos chat-previews"></div>
      <form class="chat-form">
        ${canPhoto ? `<label class="btn small" title="Mandar fotos" aria-label="Mandar fotos">📷<input type="file" accept="image/*" multiple class="visually-hidden" data-chat-files /></label>` : ""}
        <textarea rows="1" maxlength="1000" placeholder="Escribe un mensaje…" aria-label="Mensaje"></textarea>
        <button class="btn primary" type="submit">Enviar</button>
      </form>`;
    const msgsEl = root.querySelector(".chat-msgs");
    const form = root.querySelector(".chat-form");
    const ta = form.querySelector("textarea");
    const prevEl = root.querySelector(".chat-previews");
    let photos = [];

    const renderPrev = () => {
      prevEl.innerHTML = photos.map((p, i) => `<div class="thumb"><img src="${p}" alt="Foto ${i + 1}" /><button type="button" data-rm="${i}" aria-label="Quitar foto">✕</button></div>`).join("");
    };
    prevEl.addEventListener("click", (e) => {
      const i = e.target.closest("[data-rm]")?.dataset.rm;
      if (i != null) { photos.splice(Number(i), 1); renderPrev(); }
    });
    root.querySelector("[data-chat-files]")?.addEventListener("change", async (e) => {
      const files = [...e.target.files];
      e.target.value = "";
      for (const f of files.slice(0, Math.max(0, MAX_PHOTOS - photos.length))) {
        try { photos.push(await compressImage(f)); } catch (err) { toast(err.message, true); }
        renderPrev();
      }
      if (files.length + photos.length > MAX_PHOTOS) toast(`Máximo ${MAX_PHOTOS} fotos por mensaje.`, true);
    });
    ta.addEventListener("input", () => { ta.style.height = "auto"; ta.style.height = Math.min(ta.scrollHeight, 120) + "px"; });
    ta.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey && window.matchMedia("(pointer: fine)").matches) {
        e.preventDefault();
        form.requestSubmit();
      }
    });

    const unsub = onSnapshot(
      query(collection(db, "chats", meta.uid, "messages"), orderBy("createdAt", "desc"), limit(150)),
      (snap) => {
        const nearBottom = msgsEl.scrollHeight - msgsEl.scrollTop - msgsEl.clientHeight < 120;
        const list = snap.docs.map((d) => ({ id: d.id, ...d.data() })).reverse();
        msgsEl.innerHTML = list.length ? list.map((m) => {
          const by = m.from === "admin" ? (m.by || "owner") : null;
          const mine = side === "admin" ? by === myRole : m.from === "user";
          const label = by ? `<span class="role ${by}">${ROLE_LABEL[by]}</span>` : "";
          const pics = (m.photos || []).filter((p) => PHOTO_RE.test(p));
          return `<div class="msg ${mine ? "me" : "them"}">
            ${label}
            ${m.text ? `<div>${esc(m.text)}</div>` : ""}
            ${pics.length ? `<div class="photos">${pics.map((p) => `<img src="${p}" alt="Foto" loading="lazy" data-zoom />`).join("")}</div>` : ""}
            <span class="t">${timeShort(m.createdAt)}</span>
          </div>`;
        }).join("") : `<div class="chat-empty">${side === "user" ? "Escríbeme lo que quieras 👋" : "Todavía no hay mensajes. ¡Escríbele!"}</div>`;
        if (nearBottom || snap.docChanges().some((c) => c.doc.metadata.hasPendingWrites)) msgsEl.scrollTop = msgsEl.scrollHeight;
      },
      (e) => { msgsEl.innerHTML = `<div class="chat-empty">${esc(authError(e))}</div>`; },
    );
    requestAnimationFrame(() => { msgsEl.scrollTop = msgsEl.scrollHeight; });

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const text = ta.value.trim().slice(0, 1000);
      if (!text && !photos.length) return;
      const sendPhotos = photos;
      withBusy(form.querySelector("button[type=submit]"), async () => {
        const b = writeBatch(db);
        b.set(doc(collection(db, "chats", meta.uid, "messages")), side === "admin"
          ? { from: "admin", by: myRole, text, photos: sendPhotos, createdAt: serverTimestamp() }
          : { from: "user", text, createdAt: serverTimestamp() });
        const preview = text || (sendPhotos.length ? "📷 Foto" : "");
        b.set(doc(db, "chats", meta.uid), {
          uid: meta.uid,
          userName: meta.userName,
          userEmail: meta.userEmail,
          lastText: preview.slice(0, 120),
          lastAt: serverTimestamp(),
          lastFrom: side,
          ...(side === "admin" && { lastBy: myRole }),
          ...(side === "admin" ? { unreadUser: increment(1) } : { unreadAdmin: increment(1) }),
        }, { merge: true });
        ta.value = "";
        ta.style.height = "";
        photos = [];
        renderPrev();
        await b.commit();
      });
    });

    return { close: () => unsub(), focus: () => ta.focus() };
  }

  // ---- lado del amigo ----
  function markRead() {
    if (myChat?.unreadUser > 0) updateDoc(doc(db, "chats", currentUser.uid), { unreadUser: 0 }).catch(() => {});
    show($("#chat-badge"), false);
  }
  function openUserChat() {
    if (userChatPanel) return;
    userChatPanel = createChatPanel($("#user-chat"), {
      side: "user",
      title: "🧊 Vendedores",
      meta: { uid: currentUser.uid, userName: (profileName || currentUser.email).slice(0, 60), userEmail: currentUser.email },
    });
    markRead();
  }

  // ---- lado del admin ----
  function renderChatList() {
    const unreadTotal = allChats.reduce((s, c) => s + (c.unreadAdmin || 0), 0);
    $("#chats-badge").textContent = unreadTotal;
    show($("#chats-badge"), unreadTotal > 0);
    $("#chat-list").innerHTML = allChats.length ? allChats.map((c) => `
      <button type="button" class="chat-item ${c.uid === adminChatUid ? "active" : ""}" data-chat-uid="${esc(c.uid)}">
        <span class="avatar" aria-hidden="true">${esc((c.userName || "?").slice(0, 1).toUpperCase())}</span>
        <span class="ci-main">
          <strong>${esc(c.userName)}</strong>
          <div class="ci-last">${c.lastFrom === "admin" ? ((c.lastBy || "owner") === myRole ? "Tú: " : `${ROLE_LABEL[c.lastBy || "owner"]}: `) : ""}${esc(c.lastText || "")}</div>
        </span>
        <span class="ci-time">${timeShort(c.lastAt)}</span>
        ${c.unreadAdmin ? `<span class="nbadge">${c.unreadAdmin}</span>` : ""}
      </button>`).join("") : `<div class="empty">Todavía no te ha escrito nadie. También puedes abrir un chat desde un pedido con «💬 Chat».</div>`;
    if (adminChatUid) {
      const c = allChats.find((x) => x.uid === adminChatUid);
      if (c?.unreadAdmin) updateDoc(doc(db, "chats", c.uid), { unreadAdmin: 0 }).catch(() => {});
    }
  }

  function openAdminChat(meta) {
    $('[data-admin-tab="chats"]').click();
    adminChatPanel?.close();
    adminChatUid = meta.uid;
    show($("#admin-chat"));
    adminChatPanel = createChatPanel($("#admin-chat"), { side: "admin", title: `💬 ${meta.userName}`, meta });
    renderChatList();
    $("#admin-chat").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  $("#chat-list").addEventListener("click", (e) => {
    const uid = e.target.closest("[data-chat-uid]")?.dataset.chatUid;
    const c = allChats.find((x) => x.uid === uid);
    if (c) openAdminChat({ uid: c.uid, userName: c.userName, userEmail: c.userEmail });
  });
  $("#admin-chat").addEventListener("click", (e) => {
    if (!e.target.closest("[data-chat-close]")) return;
    adminChatPanel?.close();
    adminChatPanel = null;
    adminChatUid = null;
    show($("#admin-chat"), false);
    renderChatList();
  });

  function checkNewChatMessages(snap) {
    if (firstChatsLoad) { firstChatsLoad = false; return; }
    snap.docChanges().forEach((c) => {
      const d = c.doc.data();
      if (c.doc.metadata.hasPendingWrites || d.lastFrom !== "user" || !d.unreadAdmin) return;
      if (c.type === "removed") return;
      const isOpen = adminChatUid === d.uid && currentView === "admin" && !document.hidden;
      if (isOpen) return;
      toast(`💬 ${d.userName}: ${d.lastText}`);
      if (notifyOn) {
        beep();
        if ("Notification" in window && Notification.permission === "granted") {
          try {
            const n = new Notification(`💬 Mensaje de ${d.userName}`, { body: d.lastText, tag: "chat-" + d.uid });
            n.onclick = () => { window.focus(); setView("admin"); openAdminChat({ uid: d.uid, userName: d.userName, userEmail: d.userEmail }); n.close(); };
          } catch { /* ignorar */ }
        }
      }
      if (document.hidden || !document.hasFocus()) { unseen += 1; setTitleBadge(); }
    });
  }

  // ---------- Contar cómo va un pedido (texto, progreso y fotos) ----------
  let updOrder = null;
  let updUnsub = null;
  let updPhotos = [];
  const updForm = $("#upd-form");

  function renderUpdPreviews() {
    $("#upd-previews").innerHTML = updPhotos.map((p, i) => `
      <div class="thumb"><img src="${p}" alt="Foto ${i + 1}" /><button type="button" data-rm-photo="${i}" aria-label="Quitar foto">✕</button></div>`).join("");
  }

  function openUpdates(o) {
    updOrder = o;
    updPhotos = [];
    updForm.reset();
    updForm.progress.value = o.progress ?? 0;
    $("#upd-pct").textContent = `${updForm.progress.value}%`;
    $("#upd-order").textContent = `${o.userName} · #${shortId(o.id)} · ${itemsText(o.items) || (o.description || "").slice(0, 60)}`;
    renderUpdPreviews();
    $("#upd-list").innerHTML = `<div class="muted small">Cargando…</div>`;
    show($("#upd-modal"));
    updUnsub?.();
    updUnsub = onSnapshot(collection(db, "orders", o.id, "updates"), (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => ms(b) - ms(a));
      $("#upd-list").innerHTML = updatesHtml(list, { admin: true, orderId: o.id });
    }, (e) => toast(authError(e), true));
  }
  function closeUpdates() {
    updUnsub?.();
    updUnsub = null;
    updOrder = null;
    show($("#upd-modal"), false);
  }
  $("#upd-close").addEventListener("click", closeUpdates);
  $("#upd-modal").addEventListener("click", (e) => { if (e.target.id === "upd-modal") closeUpdates(); });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!$("#lightbox").classList.contains("hidden")) show($("#lightbox"), false);
    else if (updOrder) closeUpdates();
  });
  updForm.progress.addEventListener("input", () => { $("#upd-pct").textContent = `${updForm.progress.value}%`; });

  $("#upd-files").addEventListener("change", async (e) => {
    const files = [...e.target.files];
    e.target.value = "";
    const room = MAX_PHOTOS - updPhotos.length;
    if (files.length > room) toast(`Solo caben ${MAX_PHOTOS} fotos por publicación.`, true);
    for (const f of files.slice(0, Math.max(0, room))) {
      try { updPhotos.push(await compressImage(f)); } catch (err) { toast(err.message, true); }
      renderUpdPreviews();
    }
  });
  $("#upd-previews").addEventListener("click", (e) => {
    const i = e.target.closest("[data-rm-photo]")?.dataset.rmPhoto;
    if (i == null) return;
    updPhotos.splice(Number(i), 1);
    renderUpdPreviews();
  });

  updForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const o = updOrder;
    if (!o) return;
    const text = updForm.text.value.trim().slice(0, 500);
    const progress = Number(updForm.progress.value);
    const progressChanged = progress !== (o.progress ?? 0);
    if (!text && !updPhotos.length && !progressChanged) {
      return toast("Escribe algo, añade una foto o cambia el progreso.", true);
    }
    withBusy(updForm.querySelector("button[type=submit]"), async () => {
      const b = writeBatch(db);
      b.set(doc(collection(db, "orders", o.id, "updates")), {
        uid: o.uid, text, photos: updPhotos, progress, createdAt: serverTimestamp(),
      });
      b.update(doc(db, "orders", o.id), {
        progress, updatesCount: increment(1), lastUpdateAt: serverTimestamp(),
      });
      await b.commit();
      o.progress = progress;
      updPhotos = [];
      updForm.text.value = "";
      renderUpdPreviews();
      toast(`📸 Publicado. ${o.userName} lo verá en su pedido.`);
    });
  });

  $("#upd-list").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-del-upd]");
    if (!btn || !confirm("¿Borrar esta publicación?")) return;
    withBusy(btn, async () => {
      const b = writeBatch(db);
      b.delete(doc(db, "orders", btn.dataset.order, "updates", btn.dataset.delUpd));
      b.update(doc(db, "orders", btn.dataset.order), { updatesCount: increment(-1) });
      await b.commit();
    });
  });

  // ---------- Devolver stock de pedidos cancelados o rechazados ----------
  const returning = new Set();
  async function returnStockOf(o) {
    if (returning.has(o.id)) return;
    returning.add(o.id);
    try {
      await runTransaction(db, async (tx) => {
        const ref = doc(db, "orders", o.id);
        const cur = await tx.get(ref);
        if (!cur.exists() || cur.data().stockReturned || !cur.data().fromStock) return;
        const ids = Object.keys(cur.data().fromStock);
        const holds = await Promise.all(ids.map((pid) => tx.get(doc(db, "stock", pid, "holds", o.id))));
        holds.forEach((h, i) => {
          if (!h.exists()) return;
          tx.set(doc(db, "stock", ids[i]), { qty: increment(Number(h.data().qty) || 0) }, { merge: true });
          tx.delete(h.ref);
        });
        tx.update(ref, { stockReturned: true });
      });
    } catch (e) { console.error(e); } finally { returning.delete(o.id); }
  }
  function returnStock() {
    allOrders
      .filter((o) => ["cancelado", "rechazado"].includes(o.status) && o.fromStock && !o.stockReturned)
      .forEach(returnStockOf);
  }

  // ---------- Avisos: editar desde el panel ----------
  let noticesDirty = false;
  function noticeRow(n, i) {
    return `<div class="notice-row" data-nrow>
      <div class="nr-head">
        <strong>Aviso ${i + 1}</strong>
        <label class="switch"><input type="checkbox" name="active" ${n.active ? "checked" : ""} /> Encendido</label>
        <select name="color" aria-label="Color">${Object.entries(NOTICE_COLORS).map(([k, v]) => `<option value="${k}" ${n.color === k ? "selected" : ""}>${v}</option>`).join("")}</select>
        <button type="button" class="btn bad small" data-del-notice aria-label="Quitar aviso">✕</button>
      </div>
      <input name="title" maxlength="80" placeholder="Título (ej: ¡LOS PRECIOS HAN CAMBIADO!)" value="${esc(n.title || "")}" />
      <textarea name="text" rows="2" maxlength="400" placeholder="Texto del aviso">${esc(n.text || "")}</textarea>
      <div class="nr-preview">${noticeHtml(n)}</div>
    </div>`;
  }
  function readNoticeRows() {
    return $$("#notice-rows [data-nrow]").map((r) => ({
      title: r.querySelector("[name=title]").value.trim().slice(0, 80),
      text: r.querySelector("[name=text]").value.trim().slice(0, 400),
      color: r.querySelector("[name=color]").value,
      active: r.querySelector("[name=active]").checked,
    }));
  }
  function renderNoticeEditor() {
    if (noticesDirty) return;
    $("#notice-rows").innerHTML = notices.length ? notices.map(noticeRow).join("")
      : `<div class="empty">No hay avisos. Pulsa «Añadir aviso».</div>`;
  }
  const onNoticeEdit = (e) => {
    noticesDirty = true;
    const row = e.target.closest("[data-nrow]");
    if (row) {
      const i = $$("#notice-rows [data-nrow]").indexOf(row);
      row.querySelector(".nr-preview").innerHTML = noticeHtml(readNoticeRows()[i]);
    }
  };
  $("#admin-notices").addEventListener("input", onNoticeEdit);
  $("#admin-notices").addEventListener("change", onNoticeEdit);
  $("#admin-notices").addEventListener("click", (e) => {
    if (e.target.closest("#add-notice")) {
      const list = readNoticeRows();
      list.push({ title: "", text: "", color: "amarillo", active: true });
      noticesDirty = true;
      $("#notice-rows").innerHTML = list.map(noticeRow).join("");
      $$("#notice-rows [name=title]").at(-1).focus();
    } else if (e.target.closest("[data-del-notice]")) {
      e.target.closest("[data-nrow]").remove();
      noticesDirty = true;
    } else if (e.target.closest("#reset-notices")) {
      noticesDirty = false;
      renderNoticeEditor();
    } else if (e.target.closest("#save-notices")) {
      withBusy(e.target, async () => {
        const items = readNoticeRows().filter((n) => n.title || n.text);
        noticesDirty = false;
        await setDoc(doc(db, "settings", "notices"), { items, updatedAt: serverTimestamp() });
        toast("📢 Avisos guardados. Ya se ven en la web.");
      });
    }
  });

  // ---------- Analíticas ----------
  let anRange = 30;
  const DAY = 864e5;
  const dayKey = (d) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  $$(".an-filters [data-range]").forEach((b) => b.addEventListener("click", () => {
    anRange = Number(b.dataset.range);
    $$(".an-filters [data-range]").forEach((x) => x.classList.toggle("active", x === b));
    renderAnalytics();
  }));

  // barras horizontales (una sola serie: sin leyenda, el título la nombra)
  function hbars(rows, fmt) {
    if (!rows.length) return `<div class="empty">Sin datos en este periodo.</div>`;
    const max = Math.max(...rows.map((r) => r.v)) || 1;
    return `<div class="hbars">${rows.map((r) => `
      <div class="hbar" tabindex="0" data-tip="${esc(r.label)}: ${esc(fmt(r.v))}">
        <span class="hb-label">${esc(r.label)}</span>
        <span class="hb-track"><span class="hb-fill" style="width:${Math.max(2, (r.v / max) * 100)}%"></span></span>
        <span class="hb-val">${esc(fmt(r.v))}</span>
      </div>`).join("")}</div>`;
  }

  function renderAnalytics() {
    const box = $("#an-body");
    if (!box || myRole !== "owner") return;
    const now = Date.now();
    const from = anRange ? now - anRange * DAY : 0;
    const inRange = allOrders.filter((o) => ms(o) >= from);
    const live = inRange.filter((o) => !["cancelado", "rechazado"].includes(o.status));
    const billable = inRange.filter((o) => BILLABLE.includes(o.status));
    const cobrado = billable.filter((o) => o.paid).reduce((s, o) => s + orderTotal(o), 0);
    const pendiente = billable.filter((o) => !o.paid).reduce((s, o) => s + orderTotal(o), 0);
    const priced = billable.filter((o) => hasPrice(o));
    const ticket = priced.length ? priced.reduce((s, o) => s + orderTotal(o), 0) / priced.length : 0;
    const clientes = new Set(live.map((o) => o.uid)).size;
    const cancel = inRange.length ? Math.round((inRange.filter((o) => ["cancelado", "rechazado"].includes(o.status)).length / inRange.length) * 100) : 0;
    const nuevas = allUsers.filter((u) => (u.createdAt?.toMillis?.() ?? 0) >= from).length;

    // pedidos por día (o por semana si el periodo es largo)
    const firstMs = anRange ? from : Math.min(now, ...allOrders.map(ms));
    const spanDays = Math.max(1, Math.ceil((now - firstMs) / DAY));
    const weekly = spanDays > 45;
    const buckets = [];
    const start = new Date(firstMs); start.setHours(0, 0, 0, 0);
    if (weekly) start.setDate(start.getDate() - ((start.getDay() + 6) % 7)); // lunes
    for (let t = start.getTime(); t <= now; t += (weekly ? 7 : 1) * DAY) {
      buckets.push({ t, n: 0 });
    }
    inRange.forEach((o) => {
      const i = Math.floor((ms(o) - start.getTime()) / ((weekly ? 7 : 1) * DAY));
      if (buckets[i]) buckets[i].n++;
    });
    const maxN = Math.max(1, ...buckets.map((b) => b.n));
    const fmtB = (t) => {
      const d = new Date(t);
      const s = d.toLocaleDateString("es-ES", { day: "numeric", month: "short" });
      return weekly ? `Semana del ${s}` : d.toLocaleDateString("es-ES", { weekday: "short", day: "numeric", month: "short" });
    };
    const ticks = buckets.length <= 8 ? buckets.map((_, i) => i) : [0, Math.floor(buckets.length / 2), buckets.length - 1];

    // productos más pedidos (unidades, sin cancelados)
    const units = {};
    live.forEach((o) => Object.entries(o.items || {}).forEach(([id, q]) => { units[id] = (units[id] || 0) + (Number(q) || 0); }));
    const topProducts = Object.entries(units).map(([id, v]) => ({ label: productOf(id)?.name || id, v }))
      .sort((a, b) => b.v - a.v).slice(0, 8);

    // mejores clientes (dinero de pedidos en marcha o entregados)
    const spent = {};
    billable.forEach((o) => { spent[o.userName] = (spent[o.userName] || 0) + orderTotal(o); });
    const topClients = Object.entries(spent).map(([label, v]) => ({ label, v }))
      .filter((r) => r.v > 0).sort((a, b) => b.v - a.v).slice(0, 5);

    // estados
    const byStatus = Object.keys(STATUS).map((k) => ({ k, n: inRange.filter((o) => o.status === k).length })).filter((x) => x.n);

    box.innerHTML = `
      <div class="stats an-tiles">
        <div class="stat hl"><div class="n">${inRange.length}</div><div class="l">Pedidos</div></div>
        <div class="stat"><div class="n">${money(cobrado)}</div><div class="l">Cobrado</div></div>
        <div class="stat"><div class="n">${money(pendiente)}</div><div class="l">Pendiente de cobro</div></div>
        <div class="stat"><div class="n">${money(ticket)}</div><div class="l">Ticket medio</div></div>
        <div class="stat"><div class="n">${clientes}</div><div class="l">Clientes que han pedido</div></div>
        <div class="stat"><div class="n">${cancel}%</div><div class="l">Cancelados o rechazados</div></div>
        <div class="stat"><div class="n">${nuevas}</div><div class="l">Cuentas nuevas</div></div>
      </div>

      <div class="card an-card">
        <h3>Pedidos por ${weekly ? "semana" : "día"}</h3>
        ${inRange.length ? `
        <div class="vchart" role="img" aria-label="Pedidos por ${weekly ? "semana" : "día"}">
          <div class="vc-grid"><span>${maxN}</span><span>${Math.round(maxN / 2)}</span><span>0</span></div>
          <div class="vc-bars">${buckets.map((b) => `
            <div class="vc-col" tabindex="0" data-tip="${esc(fmtB(b.t))}: ${b.n} pedido${b.n === 1 ? "" : "s"}">
              <div class="vc-bar" style="height:${b.n ? Math.max(3, (b.n / maxN) * 100) : 0}%"></div>
            </div>`).join("")}</div>
        </div>
        <div class="vc-ticks">${ticks.map((i) => `<span style="left:${((i + 0.5) / buckets.length) * 100}%">${esc(new Date(buckets[i].t).toLocaleDateString("es-ES", { day: "numeric", month: "short" }))}</span>`).join("")}</div>
        <details class="an-table"><summary>Ver en tabla</summary>
          <table><thead><tr><th>${weekly ? "Semana" : "Día"}</th><th class="num">Pedidos</th></tr></thead>
          <tbody>${buckets.filter((b) => b.n).map((b) => `<tr><td>${esc(fmtB(b.t))}</td><td class="num">${b.n}</td></tr>`).join("")}</tbody></table>
        </details>` : `<div class="empty">Sin pedidos en este periodo.</div>`}
      </div>

      <div class="an-two">
        <div class="card an-card"><h3>Productos más pedidos</h3>${hbars(topProducts, (v) => `${v} ud.`)}</div>
        <div class="card an-card"><h3>Mejores clientes</h3>${hbars(topClients, money)}</div>
      </div>

      <div class="card an-card"><h3>Estado de los pedidos</h3>
        ${byStatus.length ? `<div class="an-status">${byStatus.map((x) => `<span class="badge st-${x.k}">${STATUS[x.k]}: ${x.n}</span>`).join("")}</div>` : `<div class="empty">Sin pedidos en este periodo.</div>`}
      </div>`;
  }

  // tooltip de las gráficas (ratón, dedo y teclado)
  const tip = Object.assign(document.createElement("div"), { className: "an-tip", hidden: true });
  document.body.appendChild(tip);
  const showTip = (el) => {
    tip.textContent = el.dataset.tip;
    tip.hidden = false;
    const r = el.getBoundingClientRect();
    const x = Math.min(window.innerWidth - tip.offsetWidth - 8, Math.max(8, r.left + r.width / 2 - tip.offsetWidth / 2));
    tip.style.left = `${x}px`;
    tip.style.top = `${Math.max(8, r.top - tip.offsetHeight - 8)}px`;
  };
  $("#an-body").addEventListener("pointerover", (e) => { const el = e.target.closest("[data-tip]"); if (el) showTip(el); });
  $("#an-body").addEventListener("pointerout", (e) => { if (e.target.closest("[data-tip]")) tip.hidden = true; });
  $("#an-body").addEventListener("focusin", (e) => { const el = e.target.closest("[data-tip]"); if (el) showTip(el); });
  $("#an-body").addEventListener("focusout", () => { tip.hidden = true; });
  window.addEventListener("scroll", () => { tip.hidden = true; }, { passive: true });

  // ---------- Ban: banear y desbanear cuentas ----------
  let allBans = [];
  let allUsers = [];
  const isMe = (email) => (email || "").toLowerCase() === ADMIN_EMAIL.toLowerCase();

  // ---------- Roles: dar y quitar rangos ----------
  let allRoles = [];
  let migrationsDone = null;
  let seeding = false;
  const ROLE_NAMES = { "": "👤 Cliente", coowner: "🤝 Co-dueño" };

  // cambios de config.js (ROLE_SEEDS) que se aplican una sola vez
  async function runSeeds() {
    if (seeding || migrationsDone === null || !allUsers.length) return;
    const pending = (ROLE_SEEDS || []).filter((s) => !migrationsDone.includes(s.id));
    if (!pending.length) return;
    seeding = true;
    try {
      const done = [];
      for (const s of pending) {
        const u = allUsers.find((x) => (x.email || "").toLowerCase() === s.email.toLowerCase());
        if (!u) continue; // todavía no tiene cuenta: se aplicará cuando la tenga
        const b = writeBatch(db);
        if (s.role) b.set(doc(db, "roles", u.id), { role: s.role, email: u.email, name: u.name || "", at: serverTimestamp() });
        if (s.unban) b.delete(doc(db, "bans", s.email.toLowerCase()));
        await b.commit();
        done.push(s.id);
        toast(`${ROLE_NAMES[s.role] || ""} ${u.name || u.email}: rango devuelto.`);
      }
      if (done.length) await setDoc(doc(db, "settings", "migrations"), { applied: [...migrationsDone, ...done] }, { merge: true });
    } catch (e) { console.error(e); } finally { seeding = false; }
  }

  function renderRoles() {
    const box = $("#role-list");
    if (!box) return;
    const q = ($("#role-search").value || "").trim().toLowerCase();
    const list = allUsers
      .filter((u) => !q || `${u.name} ${u.email}`.toLowerCase().includes(q))
      .sort((a, b) => {
        const ra = allRoles.some((r) => r.id === a.id) ? 0 : 1;
        const rb = allRoles.some((r) => r.id === b.id) ? 0 : 1;
        return ra - rb || (a.name || "").localeCompare(b.name || "");
      });
    box.innerHTML = list.length ? list.map((u) => {
      const role = allRoles.find((r) => r.id === u.id)?.role || "";
      const banned = allBans.some((b) => b.id === (u.email || "").toLowerCase());
      return `<div class="ban-row">
        <div class="ban-main"><strong>${esc(u.name)}</strong>
          ${role ? `<span class="role ${role}">${ROLE_NAMES[role]}</span>` : ""}
          ${banned ? `<span class="badge owes">Baneado</span>` : ""}
          <div class="muted small">${esc(u.email)}</div></div>
        ${isMe(u.email) ? `<span class="role owner">👑 Dueño</span>`
          : `<select data-role-uid="${esc(u.id)}" aria-label="Rango de ${esc(u.name)}">
              ${Object.entries(ROLE_NAMES).map(([k, v]) => `<option value="${k}" ${k === role ? "selected" : ""}>${v}</option>`).join("")}
            </select>`}
      </div>`;
    }).join("") : `<div class="empty">No hay cuentas.</div>`;
  }
  $("#role-search").addEventListener("input", renderRoles);
  $("#role-list").addEventListener("change", (e) => {
    const sel = e.target.closest("[data-role-uid]");
    if (!sel) return;
    const u = allUsers.find((x) => x.id === sel.dataset.roleUid);
    const role = sel.value;
    const prev = allRoles.find((r) => r.id === u.id)?.role || "";
    const msg = role
      ? `¿Dar el rango ${ROLE_NAMES[role]} a ${u.name}? Le llegará un enlace a su correo al entrar para activarlo.`
      : `¿Quitarle el rango a ${u.name}?`;
    if (!confirm(msg)) { sel.value = prev; return; }
    withBusy(sel, async () => {
      if (role) {
        const b = writeBatch(db);
        b.set(doc(db, "roles", u.id), { role, email: u.email, name: u.name || "", at: serverTimestamp() });
        b.delete(doc(db, "bans", (u.email || "").toLowerCase())); // con rango no puede estar baneado
        await b.commit();
        toast(`${ROLE_NAMES[role]} dado a ${u.name}. 📧 Le llegará el enlace al entrar.`);
      } else {
        await deleteDoc(doc(db, "roles", u.id));
        toast(`Rango quitado a ${u.name}.`);
      }
    });
  });

  async function banEmail(email, reason = "") {
    const e = email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) throw new Error("Ese correo no es válido.");
    if (isMe(e)) throw new Error("No te puedes banear a ti mismo 😅");
    const u = allUsers.find((x) => (x.email || "").toLowerCase() === e);
    await setDoc(doc(db, "bans", e), { email: e, reason: reason.slice(0, 200), name: u?.name || "", at: serverTimestamp() });
    toast(`🚫 ${u?.name || e} baneado.`);
  }

  function renderBans() {
    const box = $("#ban-list");
    if (!box) return;
    box.innerHTML = allBans.length ? allBans.map((b) => `
      <div class="ban-row">
        <div class="ban-main"><strong>${esc(b.name || b.email || b.id)}</strong>
          <div class="muted small">${esc(b.email || b.id)}${b.at ? ` · ${fmtDate(b.at)}` : ""}${b.reason ? ` · ${esc(b.reason)}` : ""}</div></div>
        <button type="button" class="btn ok small" data-unban="${esc(b.id)}">✅ Desbanear</button>
      </div>`).join("") : `<div class="empty">No hay nadie baneado.</div>`;

    $("#users-emails").innerHTML = allUsers.map((u) => `<option value="${esc(u.email)}">${esc(u.name)}</option>`).join("");
    const q = ($("#user-search").value || "").trim().toLowerCase();
    const list = allUsers
      .filter((u) => !q || `${u.name} ${u.email}`.toLowerCase().includes(q))
      .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    $("#user-list").innerHTML = list.length ? list.map((u) => {
      const e = (u.email || "").toLowerCase();
      const isBan = allBans.some((b) => b.id === e);
      return `<div class="ban-row">
        <div class="ban-main"><strong>${esc(u.name)}</strong> ${isBan ? `<span class="badge owes">Baneado</span>` : ""}
          <div class="muted small">${esc(u.email)}</div></div>
        ${isMe(e) ? `<span class="muted small">👑 Tú</span>`
          : isBan ? `<button type="button" class="btn ok small" data-unban="${esc(e)}">✅ Desbanear</button>`
          : `<button type="button" class="btn bad small" data-ban="${esc(e)}">🚫 Banear</button>`}
      </div>`;
    }).join("") : `<div class="empty">No hay cuentas.</div>`;
  }

  $("#ban-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const f = e.target;
    withBusy(f.querySelector("button[type=submit]"), async () => {
      if (!confirm(`¿Banear a ${f.email.value.trim()}? No podrá pedir ni usar el chat.`)) return;
      await banEmail(f.email.value, f.reason.value.trim());
      f.reset();
    });
  });
  $("#user-search").addEventListener("input", renderBans);
  $("#admin-bans").addEventListener("click", (e) => {
    const ban = e.target.closest("[data-ban]");
    const unban = e.target.closest("[data-unban]");
    if (ban) {
      if (!confirm(`¿Banear a ${ban.dataset.ban}? No podrá pedir ni usar el chat.`)) return;
      withBusy(ban, () => banEmail(ban.dataset.ban));
    } else if (unban) {
      if (!confirm(`¿Desbanear a ${unban.dataset.unban}?`)) return;
      withBusy(unban, async () => {
        await deleteDoc(doc(db, "bans", unban.dataset.unban));
        toast("✅ Desbaneado.");
      });
    }
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
  function photoCell(photo, emoji) {
    return photo
      ? `<img src="${photo}" alt="Foto del producto" /><span class="p-rm" data-rm-pphoto title="Quitar foto">✕</span>`
      : `<span class="p-add">📷</span>`;
  }
  function priceRow(p) {
    const photo = p.photo && PHOTO_RE.test(p.photo) ? p.photo : "";
    return `<div class="price-row" data-row data-photo="${photo}">
      <button type="button" class="p-pick" data-pick-pphoto aria-label="Poner foto del producto">${photoCell(photo)}</button>
      <input name="emoji" value="${esc(p.emoji || "")}" maxlength="8" aria-label="Emoji (si no hay foto)" class="emoji-in" ${photo ? "hidden" : ""} />
      <input name="name" value="${esc(p.name || "")}" maxlength="40" placeholder="Nombre" aria-label="Nombre" />
      <label class="euro"><input name="price" type="number" min="0" step="0.01" inputmode="decimal" value="${p.price ?? ""}" aria-label="Precio" /> €</label>
      <label class="stock-in">📦 Stock <input name="stock" type="number" min="0" step="1" inputmode="numeric" value="${p.id && stockOf(p.id) != null ? stockOf(p.id) : ""}" placeholder="∞" aria-label="Stock" /></label>
      <input name="id" type="hidden" value="${esc(p.id || "")}" />
      <button type="button" class="btn bad small" data-del-row aria-label="Quitar producto">✕</button>
    </div>`;
  }
  function renderPricesEditor() {
    if (pricesDirty) return; // no pisar lo que el admin está editando
    $("#admin-prices").innerHTML = `
      <div class="card">
        <h3>💶 Precios</h3>
        <p class="muted small">Los cambios se ven al momento en la web de tus amigos. Los pedidos ya hechos mantienen su precio.</p>
        <p class="muted small">📦 <strong>Stock</strong>: cuántos tienes ya hechos. Baja solo con cada pedido y vuelve si se cancela o rechaza. Déjalo vacío (∞) si lo imprimes por encargo sin límite; pon 0 para «Agotado».</p>
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

  // Fotos de productos: una entrada de archivo compartida para todas las filas
  const pPhotoInput = Object.assign(document.createElement("input"), { type: "file", accept: "image/*", hidden: true });
  document.body.appendChild(pPhotoInput);
  let pPhotoRow = null;
  function setRowPhoto(row, photo) {
    row.dataset.photo = photo;
    row.querySelector("[data-pick-pphoto]").innerHTML = photoCell(photo);
    row.querySelector("[name=emoji]").hidden = Boolean(photo);
    pricesDirty = true;
  }
  pPhotoInput.addEventListener("change", async () => {
    const file = pPhotoInput.files[0];
    pPhotoInput.value = "";
    if (!file || !pPhotoRow) return;
    try {
      setRowPhoto(pPhotoRow, await compressImage(file, { side: 480, budget: 60000 }));
      toast("📷 Foto puesta. Pulsa «Guardar precios» para que la vean.");
    } catch (err) { toast(err.message, true); }
  });

  $("#admin-prices").addEventListener("input", () => { pricesDirty = true; });
  $("#admin-prices").addEventListener("click", (e) => {
    if (e.target.closest("[data-rm-pphoto]")) {
      setRowPhoto(e.target.closest("[data-row]"), "");
    } else if (e.target.closest("[data-pick-pphoto]")) {
      pPhotoRow = e.target.closest("[data-row]");
      pPhotoInput.click();
    } else if (e.target.closest("#add-product")) {
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
        const stockPlan = {};
        const products = $$("#price-rows [data-row]").map((r) => {
          const name = r.querySelector("[name=name]").value.trim();
          const price = parseFloat(r.querySelector("[name=price]").value.replace(",", "."));
          if (!name) throw new Error("Hay un producto sin nombre.");
          if (isNaN(price) || price < 0) throw new Error(`Pon un precio válido a «${name}».`);
          let id = r.querySelector("[name=id]").value || slug(name);
          while (used.has(id)) id += "-2";
          used.add(id);
          const photo = PHOTO_RE.test(r.dataset.photo || "") ? r.dataset.photo : "";
          const st = r.querySelector("[name=stock]").value.trim();
          if (st !== "" && !(Number.isInteger(Number(st)) && Number(st) >= 0)) throw new Error(`El stock de «${name}» tiene que ser un número entero.`);
          stockPlan[id] = st === "" ? null : Number(st);
          return { id, name, emoji: r.querySelector("[name=emoji]").value.trim(), price: round2(price), ...(photo && { photo }) };
        });
        if (JSON.stringify(products).length > 900000) {
          throw new Error("Hay demasiadas fotos de productos. Quita alguna.");
        }
        const k = parseFloat($("#keychain-extra").value.replace(",", "."));
        if (isNaN(k) || k < 0) throw new Error("Pon un precio válido al llavero.");
        pricesDirty = false;
        const b = writeBatch(db);
        b.set(doc(db, "settings", "shop"), { products, keychainExtra: round2(k), updatedAt: serverTimestamp() });
        // stock: poner, cambiar o quitar el límite; y borrar el de productos eliminados
        Object.entries(stockPlan).forEach(([id, v]) => {
          if (v == null) { if (stockOf(id) != null) b.delete(doc(db, "stock", id)); }
          else if (v !== stockOf(id)) b.set(doc(db, "stock", id), { qty: v });
        });
        Object.keys(stock).filter((id) => !(id in stockPlan)).forEach((id) => b.delete(doc(db, "stock", id)));
        await b.commit();
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
