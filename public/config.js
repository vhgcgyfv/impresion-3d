// =====================================================================
//  CONFIGURACIÓN DE LA WEB  —  aquí cambias casi todo sin tocar código
// =====================================================================

// 1) Pega aquí la configuración de tu proyecto de Firebase
//    (Firebase console → ⚙️ Configuración del proyecto → Tus apps → Web)
export const firebaseConfig = {
  apiKey: "PEGA_AQUI_TU_API_KEY",
  authDomain: "TU-PROYECTO.firebaseapp.com",
  projectId: "TU-PROYECTO",
  storageBucket: "TU-PROYECTO.appspot.com",
  messagingSenderId: "000000000000",
  appId: "1:000000000000:web:0000000000000000",
};

// 2) Correo del administrador (el único que puede aceptar, poner precios, etc.)
//    OJO: si lo cambias, cámbialo también en firestore.rules
export const ADMIN_EMAIL = "o39459309@gmail.com";

// 3) Suplemento por versión llavero (en euros)
export const KEYCHAIN_EXTRA = 0.10;

// 4) Códigos de apoyo válidos (en minúsculas). Su uso se cuenta en el panel admin.
export const PROMO_CODES = ["manchis14"];

// 5) Ofertas que se muestran a tus amigos
export const OFFERS = [
  {
    id: "fennecs-balon",
    emoji: "🚗🚗⚽",
    title: "2 Fennecs + balón GRATIS",
    description: "Pide dos Fennecs y te regalo un balón impreso en 3D.",
  },
];

// 6) Sitios de recogida que te salen como sugerencia al aceptar un pedido
export const PICKUP_PLACES = [
  // "Puerta del instituto",
  // "Mi casa",
];
