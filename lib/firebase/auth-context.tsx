"use client";

import {
  type User,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut as firebaseSignOut,
} from "firebase/auth";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { getFirebase, googleProvider, getGoogleProviderWithAccountSelection } from "./client";
import { ligarRevalidacaoAutomatica, limparCache } from "./cache";
import { definirUsuarioDoPush, reconciliarPush, soltarPushAoSair } from "./push";

type AuthState = {
  user: User | null;
  loading: boolean;
  signIn: () => Promise<void>;
  signInWithAccountSelection: () => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const { auth } = getFirebase();
    return onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
  }, []);

  /**
   * SYNC-01: revalidacao por evento.
   *
   * A validade do cache era conferida so na INSCRICAO. Depois de inscrito, o
   * componente segurava o dado indefinidamente — uma aba aberta a tarde
   * inteira mostrava o estado da manha, e o TTL so tinha efeito na proxima
   * montagem. O comentario do cache dizia que mudanca de outra pessoa
   * "aparece quando o TTL vence"; pra quem ja estava assinando, ele nunca
   * vencia.
   *
   * Aqui, no provider que existe durante toda a sessao: revalida o que esta
   * VELHO quando a janela volta ao foco e quando a conexao volta, mais um
   * intervalo que so corre com a aba visivel. Aba em segundo plano nao gasta
   * leitura, que e o ponto do cache inteiro.
   */
  useEffect(() => ligarRevalidacaoAutomatica(), []);

  /**
   * O push acompanha a PESSOA, não o navegador.
   *
   * A cada mudança de usuário (login, troca de conta) alinha o registro
   * deste navegador com quem está na tela: reativa o push de quem já o
   * quis aqui, solta o vínculo de quem saiu, e acompanha a rotação do token.
   * A volta ao app também reconcilia (no máximo a cada 30 min) — um PWA que
   * vive em segundo plano por dias é onde o token roda sem ninguém ver.
   */
  const ultimaReconciliacao = useRef(0);
  const emailAtual = user?.email ?? null;
  useEffect(() => {
    definirUsuarioDoPush(emailAtual);
    if (!emailAtual) return;
    ultimaReconciliacao.current = Date.now();
    void reconciliarPush(emailAtual);

    const aoVoltar = () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - ultimaReconciliacao.current < 30 * 60_000) return;
      ultimaReconciliacao.current = Date.now();
      void reconciliarPush(emailAtual);
    };
    document.addEventListener("visibilitychange", aoVoltar);
    return () => document.removeEventListener("visibilitychange", aoVoltar);
  }, [emailAtual]);

  async function signIn() {
    const { auth } = getFirebase();
    await signInWithPopup(auth, googleProvider);
  }

  async function signInWithAccountSelection() {
    const { auth } = getFirebase();
    const provider = getGoogleProviderWithAccountSelection();
    await signInWithPopup(auth, provider);
  }

  async function signInWithEmail(email: string, password: string) {
    const { auth } = getFirebase();
    await signInWithEmailAndPassword(auth, email.trim(), password);
  }

  async function signOut() {
    const { auth } = getFirebase();
    // Solta o push ANTES de perder a sessão: sem ela, o servidor não sabe de
    // quem é o registro. Sem rede, fica pendente e é refeito depois (ver
    // soltarPushAoSair) — a saída nunca fica presa por causa disso.
    await soltarPushAoSair();
    await firebaseSignOut(auth);
    definirUsuarioDoPush(null);
    // O cache de leitura vive em memória do módulo, fora do React — sem
    // limpar, dado da conta anterior continuaria visível pra quem logasse
    // em seguida no mesmo navegador (ver lib/firebase/cache.ts).
    limparCache();
  }

  return (
    <AuthContext.Provider value={{ user, loading, signIn, signInWithAccountSelection, signInWithEmail, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
