import "server-only";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { getMessaging } from "firebase-admin/messaging";
import { comCaminhosDeDados } from "./db-de-dados";

function formatPrivateKey(key?: string) {
  if (!key) return undefined;
  return key.replace(/\\n/g, "\n");
}

function ensureAdminApp() {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = formatPrivateKey(process.env.FIREBASE_PRIVATE_KEY);

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error("Missing Firebase Admin env vars");
  }

  if (!getApps().length) {
    initializeApp({
      credential: cert({
        projectId,
        clientEmail,
        privateKey,
      }),
    });
  }
}

/**
 * O Firestore do servidor. Com NEXT_PUBLIC_ZXP_MODO_DADOS=tenant, o dado da
 * empresa é lido e gravado em tenants/{id}/… (ver lib/firebase/caminhos.ts);
 * desligada, é o Firestore de sempre.
 */
export function getAdminDb() {
  ensureAdminApp();
  return comCaminhosDeDados(getFirestore());
}

export function getAdminAuth() {
  ensureAdminApp();
  return getAuth();
}

export function getAdminMessaging() {
  ensureAdminApp();
  return getMessaging();
}