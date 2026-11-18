// =====================================================================
//  CONFIGURACIÓN DE LA WEB  —  aquí cambias casi todo sin tocar código
// =====================================================================

// 1) Pega aquí la configuración de tu proyecto de Firebase
//    (Firebase console → ⚙️ Configuración del proyecto → Tus apps → Web)
export const firebaseConfig = {
  apiKey: "AIzaSyCVugBPIS38xiQ88cYHvhgH1l0i5NvMGhg",
  authDomain: "impresion3d-4bdb7.firebaseapp.com",
  projectId: "impresion3d-4bdb7",
  storageBucket: "impresion3d-4bdb7.firebasestorage.app",
  messagingSenderId: "42350154042",
  appId: "1:42350154042:web:4dd581ac38769e06e60003",
};

// 2) Nombre de la web (sale arriba y en la pestaña del navegador)
export const SITE_NAME = "Impresión 3D";

// 3) Correo del administrador (el único que puede aceptar, poner precios, etc.)
//    OJO: si lo cambias, cámbialo también en firestore.rules
export const ADMIN_EMAIL = "o39459309@gmail.com";

// 3a) Co-dueños: gestionan pedidos y chats, pero no el dinero, los precios
//     ni borrar. OJO: si lo cambias, cámbialo también en firestore.rules
export const COOWNER_EMAILS = ["martincsurcui@gmail.com"];

// 3b) Envío del código de verificación al crear cuenta (EmailJS, gratis).
//     Mientras esté vacío, en vez de un código se manda un enlace de verificación.
//     Pasos en el README → "Código de verificación por correo".
export const EMAILJS = {
  serviceId: "service_0f0j8m6",   // p. ej. "service_abc123"
  templateId: "template_qsydhgm",  // plantilla del código, p. ej. "template_xyz789"
  orderTemplateId: "template_pouf8uf", // plantilla del aviso de pedido nuevo (te llega a ti)
  publicKey: "rJSTf0tXceLR1wp5d",   // Account → General → Public Key
};

// 4) Suplemento por versión llavero (en euros, por pedido)
export const KEYCHAIN_EXTRA = 0.10;

// 5) Productos predeterminados con su precio (en euros)
export const PRODUCTS = [
  { id: "fennec", emoji: "🚗", name: "Fennec", price: 0.50 },
  { id: "balon", emoji: "⚽", name: "Balón", price: 0.25 },
  { id: "octane", emoji: "🏎️", name: "Octane", price: 0.50 },
];

// 6) Códigos de apoyo válidos (en minúsculas).
//    discount = % de descuento · rickroll = sale el vídeo 5 segundos al ponerlo
export const PROMO_CODES = {
  manchis14: { discount: 10, rickroll: true },
};

// 7) Ofertas. "items" = lo que incluye, "free" = lo que sale gratis
export const OFFERS = [
  {
    id: "fennecs-balon",
    emoji: "🚗🚗⚽",
    title: "2 Fennecs + balón GRATIS",
    description: "Pide dos Fennecs y te regalo un balón.",
    items: { fennec: 2, balon: 1 },
    free: { balon: 1 },
  },
];

// 8) Sitios de recogida que te salen como sugerencia al aceptar un pedido
export const PICKUP_PLACES = [
  // "Puerta del instituto",
  // "Mi casa",
];
