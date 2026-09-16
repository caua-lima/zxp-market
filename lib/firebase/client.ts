"use client";

import { type FirebaseApp, getApp, getApps, initializeApp } from "firebase/app";
import {
  type Auth,
  GoogleAuthProvider,
  browserLocalPersistence,
  connectAuthEmulator,
  getAuth,
  setPersistence,
} from "firebase/auth";
import {
  type Firestore,
  connectFirestoreEmulator,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from "firebase/firestore";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

let app: FirebaseApp | null = null;
let db: Firestore | null = null;
let auth: Auth | null = null;

/**
 * ─── O APP CONTRA O EMULADOR ────────────────────────────────────────────
 *
 * Serve pro ensaio de restauração: sobe o emulador, restaura um dump nele e
 * abre o app apontado pra lá. É a única forma de responder *o app funciona
 * em cima do que foi restaurado?* sem criar um projeto Firebase paralelo.
 *
 * ─── AS TRÊS TRAVAS ─────────────────────────────────────────────────────
 *
 * Conectar produção ao emulador por acidente seria pior que não ter o
 * recurso: a tela abriria vazia e pareceria perda de dados.
 *
 *   1. `NEXT_PUBLIC_FIREBASE_EMULADOR` precisa existir. Sem ela, nada muda.
 *   2. Só em `NODE_ENV !== 'production'`. O Next substitui isso em tempo de
 *      build, então no pacote de produção este bloco inteiro é removido —
 *      a variável nem chega a ser lida.
 *   3. Só em host local. Uma variável vazada num deploy de preview não
 *      redireciona nada.
 */
function ligarEmulador(appFb: FirebaseApp, dbFb: Firestore, authFb: Auth) {
  const alvo = process.env.NEXT_PUBLIC_FIREBASE_EMULADOR;
  if (!alvo || process.env.NODE_ENV === "production") return;

  const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(window.location.hostname);
  if (!local) return;

  // Formato: "127.0.0.1:8199" pro Firestore; a porta do Auth vem depois da
  // vírgula porque são dois serviços e duas portas.
  const [firestoreAlvo, authAlvo] = alvo.split(",").map((x) => x.trim());
  const [fsHost, fsPorta] = firestoreAlvo.split(":");

  connectFirestoreEmulator(dbFb, fsHost, Number(fsPorta));
  if (authAlvo) {
    connectAuthEmulator(authFb, `http://${authAlvo}`, { disableWarnings: true });
  }

  // Barra amarela no topo. Uma sessão apontada pro emulador que PARECE
  // produção é como alguém conclui que os dados sumiram.
  const aviso = document.createElement("div");
  aviso.textContent = `EMULADOR LOCAL — ${alvo} · nenhum dado real nesta tela`;
  aviso.style.cssText = [
    "position:fixed", "top:0", "left:0", "right:0", "z-index:99999",
    "background:#F4B942", "color:#10100E", "font:700 12px system-ui",
    "text-align:center", "padding:4px", "letter-spacing:.04em",
  ].join(";");
  document.addEventListener("DOMContentLoaded", () => document.body.prepend(aviso));
  if (document.body) document.body.prepend(aviso);

  void appFb;
}

export function getFirebase() {
  if (typeof window === "undefined") {
    throw new Error("Firebase client SDK must run in the browser");
  }
  if (!app) {
    app = getApps().length ? getApp() : initializeApp(firebaseConfig);
  }
  if (!db) {
    db = initializeFirestore(app, {
      localCache: persistentLocalCache({
        tabManager: persistentMultipleTabManager(),
      }),
    });
  }
  if (!auth) {
    auth = getAuth(app);
    setPersistence(auth, browserLocalPersistence).catch(() => {
      /* no-op: persistence may already be set */
    });

    // Depois de db e auth existirem, e uma vez só — as duas funções de
    // conexão do SDK falham se chamadas com o cliente já em uso.
    ligarEmulador(app, db, auth);
  }
  return { app, db, auth };
}

export const googleProvider = new GoogleAuthProvider();

// Provider que força a seleção de conta (para trocar de conta)
export function getGoogleProviderWithAccountSelection() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({
    prompt: 'select_account',
  });
  return provider;
}
