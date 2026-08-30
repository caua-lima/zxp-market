"use client";

import { useEffect, useMemo, useState } from "react";
import { papelDe, roleLabel, type AccessEntry, type AuditEvent, type PermissionTab } from "@/lib/domain/types";
import {
  addAccessEntry,
  logAudit,
  removeAccessEntry,
  updateAccessEntry,
  watchAccessList,
  watchAuditLog,
} from "@/lib/firebase/data";
import type { UserData } from "@/components/useUserData";
import { authedFetch } from "@/lib/api/authed-fetch";
import { useAccess } from "@/components/tabs/AccessGuard";

const PERMISSION_TABS: PermissionTab[] = ["custos", "metas", "estoque", "ads"];
const PERMISSION_TAB_LABEL: Record<PermissionTab, string> = {
  custos: "Custos", metas: "Metas", estoque: "Estoque", ads: "Ads (últimas alterações)",
};

export default function AccessControlTab({
  uid,
  data,
}: {
  uid: string;
  data: UserData;
}) {
  void uid;
  void data;
  const { canEdit } = useAccess();

  const [entries, setEntries] = useState<AccessEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [editingEmail, setEditingEmail] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<AccessEntry["role"]>("partner");
  const [displayName, setDisplayName] = useState("");
  const [photoURL, setPhotoURL] = useState("");
  const [password, setPassword] = useState("");
  /**
   * Revelar o que está sendo DIGITADO — não a senha de quem já existe.
   *
   * Senha cadastrada é impossível de mostrar: o Firebase Auth guarda hash, não
   * a senha. O que dá (e é o que resolve o erro de digitação na hora de criar
   * o acesso) é conferir o que acabou de ser digitado antes de salvar.
   */
  const [senhaVisivel, setSenhaVisivel] = useState(false);
  const [permissoesEdicao, setPermissoesEdicao] = useState<PermissionTab[]>([]);

  useEffect(() => {
    const unsubscribe = watchAccessList((nextEntries) => {
      setEntries(nextEntries);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const [auditLog, setAuditLog] = useState<AuditEvent[]>([]);
  const [auditLoading, setAuditLoading] = useState(true);
  const [auditErro, setAuditErro] = useState("");
  useEffect(() => {
    const unsubscribe = watchAuditLog(
      (events) => { setAuditLog(events); setAuditLoading(false); setAuditErro(""); },
      200,
      // Sem isto a tela ficava em "Carregando…" pra sempre quando a leitura
      // era negada — o erro morria dentro do onSnapshot.
      (msg) => { setAuditErro(msg); setAuditLoading(false); },
    );
    return () => unsubscribe();
  }, []);

  const filteredEntries = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return entries;
    return entries.filter((entry) => {
      return (
        entry.email.toLowerCase().includes(term) ||
        entry.role.toLowerCase().includes(term) ||
        (entry.displayName ?? "").toLowerCase().includes(term)
      );
    });
  }, [entries, search]);

  const editingEntry = useMemo(
    () => entries.find((entry) => entry.email === editingEmail) ?? null,
    [entries, editingEmail],
  );

  function resetForm() {
    setEditingEmail(null);
    setEmail("");
    setRole("partner");
    setDisplayName("");
    setPhotoURL("");
    setPassword("");
    setPermissoesEdicao([]);
    setError("");
  }

  function startEdit(entry: AccessEntry) {
    setEditingEmail(entry.email);
    setEmail(entry.email);
    // Normaliza ao abrir pra edição — ver o comentário no <select>.
    setRole(papelDe(entry.role));
    setDisplayName(entry.displayName ?? "");
    setPhotoURL(entry.photoURL ?? "");
    setPassword("");
    setPermissoesEdicao(entry.permissoesEdicao ?? []);
    setError("");
  }

  function togglePermissao(tab: PermissionTab) {
    setPermissoesEdicao((cur) => (cur.includes(tab) ? cur.filter((t) => t !== tab) : [...cur, tab]));
  }

  async function saveEntry() {
    if (!canEdit) { setError("Somente o owner pode alterar acessos."); return; }
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) {
      setError("Informe um e-mail válido.");
      return;
    }
    if (password && password.length < 6) {
      setError("A senha precisa ter pelo menos 6 caracteres.");
      return;
    }

    try {
      setError("");
      const effectiveRole = editingEntry?.role === "owner" ? "owner" : role;
      // Owner edita tudo sempre — gravar permissoesEdicao pra ele seria um
      // campo morto que some assim que a UI reabrisse a edição.
      const payload: AccessEntry = {
        email: normalizedEmail,
        role: effectiveRole,
        displayName: displayName.trim() || undefined,
        photoURL: photoURL.trim() || undefined,
        // papelDe, e nao a string crua: com o papel novo chamando-se
        // "partner", comparar com "colaborador" fazia as permissoes NUNCA
        // serem gravadas. Member nao tem permissao de edicao por definicao.
        permissoesEdicao: papelDe(effectiveRole) === "partner" ? permissoesEdicao : undefined,
      };
      const detalhePermissoes = papelDe(effectiveRole) === "partner"
        ? ` · edita: ${permissoesEdicao.length ? permissoesEdicao.map((t) => PERMISSION_TAB_LABEL[t]).join(", ") : "nenhuma aba"}`
        : "";

      if (editingEmail) {
        if (editingEmail !== normalizedEmail) {
          await removeAccessEntry(editingEmail);
        }
        await updateAccessEntry(normalizedEmail, payload);
        logAudit({ acao: "editar", entidade: "acesso", entidadeId: normalizedEmail, entidadeLabel: normalizedEmail, detalhe: `papel: ${effectiveRole}${detalhePermissoes}` }).catch(() => {});
      } else {
        await addAccessEntry(payload);
        logAudit({ acao: "criar", entidade: "acesso", entidadeId: normalizedEmail, entidadeLabel: normalizedEmail, detalhe: `papel: ${effectiveRole}${detalhePermissoes}` }).catch(() => {});
      }

      // Se informou senha, cria/atualiza o login por e-mail/senha
      if (password) {
        const res = await authedFetch("/api/admin/create-user", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: normalizedEmail, password }),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => null);
          setError("Acesso salvo, mas falhou criar o login: " + (j?.error ?? res.status));
          return;
        }
      }

      resetForm();
    } catch {
      setError("Não foi possível salvar a entrada de acesso.");
    }
  }

  async function deleteEntry(entryEmail: string) {
    if (!canEdit) return;
    const target = entries.find((entry) => entry.email === entryEmail) ?? null;
    const totalOwners = entries.filter((e) => e.role === "owner").length;
    // Único bloqueio real: não pode sumir o último owner, senão ninguém mais
    // consegue editar nada (nem esta própria tela) — trava o sistema.
    if (target?.role === "owner" && totalOwners <= 1) {
      setError("Este é o único Owner — remova antes de promover outra pessoa a Owner, senão ninguém mais consegue editar.");
      return;
    }

    const aviso = target?.role === "owner"
      ? `Remover o acesso de OWNER de ${entryEmail}? Essa pessoa perde acesso total ao sistema.`
      : `Remover acesso de ${entryEmail}?`;
    if (!confirm(aviso)) return;

    try {
      setError("");
      await removeAccessEntry(entryEmail);
      logAudit({ acao: "excluir", entidade: "acesso", entidadeId: entryEmail, entidadeLabel: entryEmail, detalhe: target ? `papel: ${target.role}` : undefined }).catch(() => {});
      if (editingEmail === entryEmail) {
        resetForm();
      }
    } catch {
      setError("Não foi possível remover a entrada.");
    }
  }

  const owners = entries.filter((e) => e.role === "owner").length;
  const AUDIT_ACAO_LABEL: Record<AuditEvent["acao"], string> = {
    criar: "criou", editar: "editou", arquivar: "arquivou", reativar: "reativou", excluir: "excluiu",
  };
  const AUDIT_ENTIDADE_LABEL: Record<AuditEvent["entidade"], string> = {
    custo: "custo", meta: "meta", acesso: "acesso", produto: "produto", movimento: "movimentação de estoque",
  };
  const AUDIT_TONE: Record<AuditEvent["acao"], string> = {
    criar: "var(--green)", editar: "var(--brand)", arquivar: "var(--yellow)", reativar: "var(--green)", excluir: "var(--red)",
  };
  /**
   * Cada papel com a sua cor. Antes owner e colaborador saíam quase no mesmo
   * amarelo (#F4B942 x #E9A92D), então o badge existia sem distinguir nada —
   * justamente a informação mais importante da linha. Agora usa o sistema de
   * chips da casa, e o Member fica em cinza de propósito: é o papel de menor
   * alcance e não deve competir por atenção com o dono da conta.
   */
  const roleBadge = (r: AccessEntry["role"]) => {
    const p = papelDe(r);
    const classe = p === "owner" ? "chip chip-green" : p === "partner" ? "chip chip-accent" : "chip chip-muted";
    return <span className={classe}>{roleLabel(r)}</span>;
  };

  /** O que o papel alcança, em uma linha — some a dúvida sem abrir documentação. */
  const alcanceDoPapel = (r: AccessEntry["role"]): string => {
    const p = papelDe(r);
    if (p === "owner") return "acesso total, incluindo esta aba";
    if (p === "member") return "só Dashboard e notificações";
    return "vê todas as abas, exceto Acesso";
  };

  /**
   * Avatar: foto quando existe, senão a inicial. A lista era só e-mail em
   * negrito repetido linha após linha, sem nenhuma âncora visual pra achar
   * uma pessoa específica de relance.
   */
  const avatar = (entry: AccessEntry) => {
    const nome = entry.displayName || entry.email;
    const inicial = nome.trim().charAt(0).toUpperCase() || "?";
    const p = papelDe(entry.role);
    const cor = p === "owner" ? "var(--green)" : p === "partner" ? "var(--accent)" : "var(--muted)";
    return (
      <div
        aria-hidden
        style={{
          width: 38, height: 38, borderRadius: "50%", flexShrink: 0,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontWeight: 800, fontSize: ".95rem", color: cor,
          background: "var(--surface2)", border: `1.5px solid ${cor}`,
          backgroundImage: entry.photoURL ? `url(${entry.photoURL})` : undefined,
          backgroundSize: "cover", backgroundPosition: "center",
          overflow: "hidden",
        }}
      >
        {entry.photoURL ? "" : inicial}
      </div>
    );
  };

  return (
    <div className="dash">
      <div className="tab-head">
        <div className="tab-head-left"><h2 className="tab-title">Controle de Acesso</h2></div>
      </div>

      <div className="kpi-grid">
        <div className="kpi k-acc"><div className="k-lbl">Acessos</div><div className="k-val">{entries.length}</div></div>
        <div className="kpi k-pos"><div className="k-lbl">Owners</div><div className="k-val" style={{ color: "var(--green)" }}>{owners}</div></div>
        <div className="kpi k-warn"><div className="k-lbl">Partners</div><div className="k-val" style={{ color: "var(--yellow)" }}>{entries.filter((e) => papelDe(e.role) === "partner").length}</div></div>
        <div className="kpi"><div className="k-lbl">Members</div><div className="k-val" style={{ color: "var(--muted)" }}>{entries.filter((e) => papelDe(e.role) === "member").length}</div></div>
      </div>

      <div style={{ display: "grid", gap: 16, gridTemplateColumns: "minmax(0, 1fr)" }}>
        <div className="panel">
          <div className="panel-head" style={{ marginBottom: 4 }}>
            <span className="panel-title">{editingEmail ? "Editar acesso" : "＋ Nova entrada"}</span>
            {editingEmail ? (
              <button type="button" className="btn btn-ghost btn-sm" onClick={resetForm}>Cancelar edição</button>
            ) : null}
          </div>
          <div style={{ fontSize: ".78rem", color: "var(--muted)", marginBottom: 14 }}>
            Autorize por e-mail. A pessoa entra por Google ou, se definir uma senha, por e-mail/senha.
          </div>

          <div style={{ display: "grid", gap: 12 }}>
            <div className="config-field" style={{ margin: 0 }}>
              <label>E-mail</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="usuario@empresa.com"
                disabled={!!editingEmail}
              />
            </div>

            <div className="config-field" style={{ margin: 0 }}>
              <label>Nome de exibição</label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Nome opcional"
              />
            </div>

            <div className="config-field" style={{ margin: 0 }}>
              <label>Senha de login (opcional)</label>
              <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
                <input
                  type={senhaVisivel ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Deixe em branco para só Google · mín. 6 caracteres"
                  autoComplete="new-password"
                  style={{ paddingRight: 78, width: "100%" }}
                />
                <button
                  type="button"
                  onClick={() => setSenhaVisivel((v) => !v)}
                  disabled={!password}
                  aria-pressed={senhaVisivel}
                  title={password ? (senhaVisivel ? "Ocultar a senha digitada" : "Ver a senha digitada") : "Digite uma senha para poder vê-la"}
                  style={{
                    position: "absolute", right: 6, background: "none", border: "none",
                    color: password ? "var(--accent, #6aa9ff)" : "var(--muted)",
                    cursor: password ? "pointer" : "default", fontSize: ".72rem",
                    fontWeight: 700, padding: "4px 6px", textTransform: "uppercase", letterSpacing: ".04em",
                  }}
                >
                  {senhaVisivel ? "Ocultar" : "Ver"}
                </button>
              </div>
              <div className="hint">
                Preenchendo, cria um login por e-mail/senha (além do Google). Reeditar troca a senha.
                {" "}<b>Ver</b> mostra só o que você está digitando agora — senha já cadastrada não
                dá pra exibir, o Firebase guarda um hash irreversível, não a senha.
              </div>
            </div>

            <div className="form-grid">
              <div className="config-field" style={{ margin: 0 }}>
                <label>Perfil</label>
                <select
                  /* papelDe normaliza o legado: "colaborador" gravado por versões
                     anteriores não casa com nenhuma option e deixaria o campo em
                     branco, fazendo o owner salvar sem perceber a troca. */
                  value={editingEntry ? papelDe(editingEntry.role) : role}
                  onChange={(e) => setRole(e.target.value as AccessEntry["role"]) }
                  disabled={editingEntry?.role === "owner"}
                >
                  <option value="owner">Owner (acesso total)</option>
                  <option value="partner">Partner (vê tudo, exceto Acesso)</option>
                  <option value="member">Member (só Dashboard e notificações)</option>
                </select>
                <div className="hint">
                  <b>Partner</b> é o que antes se chamava Colaborador: vê todas as abas e edita
                  as que você liberar abaixo. <b>Member</b> vê só o Dashboard e recebe
                  notificações — sem custo, margem, preço, estoque ou DRE.
                </div>
              </div>

              <div className="config-field" style={{ margin: 0 }}>
                <label>Foto URL</label>
                <input
                  type="url"
                  value={photoURL}
                  onChange={(e) => setPhotoURL(e.target.value)}
                  placeholder="https://..."
                />
              </div>
            </div>

            {/* Só Partner tem edição granular: owner edita tudo e member não
                edita nada, então a seção não faz sentido pros dois. */}
            {papelDe(editingEntry ? editingEntry.role : role) === "partner" && (
              <div className="config-field" style={{ margin: 0 }}>
                <label>Pode editar (além de só ver)</label>
                <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
                  {PERMISSION_TABS.map((tab) => (
                    <label key={tab} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: ".85rem", fontWeight: 500, cursor: "pointer" }}>
                      <input type="checkbox" checked={permissoesEdicao.includes(tab)} onChange={() => togglePermissao(tab)} />
                      {PERMISSION_TAB_LABEL[tab]}
                    </label>
                  ))}
                </div>
                <div className="hint">
                  Fora daqui, o Partner vê tudo mas só edita Tarefas (que já é compartilhado com o owner por padrão). Marque as abas onde ele também pode editar.
                </div>
              </div>
            )}

            {error ? (
              <div className="note note-danger" role="alert">{error}</div>
            ) : null}

            <div className="row-actions">
              <button type="button" className="btn btn-success" onClick={saveEntry} disabled={!canEdit} style={{ opacity: canEdit ? 1 : 0.5 }}>
                {editingEmail ? "Salvar alterações" : "＋ Adicionar e-mail"}
              </button>
              <button type="button" className="btn btn-ghost" onClick={resetForm}>Limpar</button>
              {!canEdit && <span style={{ fontSize: ".78rem", color: "var(--muted)", alignSelf: "center" }}>somente leitura</span>}
            </div>
          </div>
        </div>

        <div className="panel">
          <div className="panel-head">
            <span className="panel-title">E-mails autorizados <span className="panel-sub">· {loading ? "…" : `${filteredEntries.length} registro(s)`}</span></span>
            <input
              className="search-inp" type="search" value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Filtrar por e-mail ou nome"
              aria-label="Filtrar acessos"
              style={{ maxWidth: 260 }}
            />
          </div>

          <div className="list-stack">
            {loading ? (
              <div style={{ color: "var(--muted)", fontSize: ".9rem" }}>Carregando…</div>
            ) : filteredEntries.length ? (
              filteredEntries.map((entry) => (
                <div key={entry.email} className="list-row list-row-split">
                  <div className="list-row-main" style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                    {avatar(entry)}
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <span style={{ fontWeight: 700 }}>{entry.displayName || "Sem nome"}</span>
                        {roleBadge(entry.role)}
                      </div>
                      <div style={{ fontSize: ".82rem", color: "var(--text)", overflowWrap: "anywhere", marginTop: 2 }}>
                        {entry.email}
                      </div>
                      <div style={{ marginTop: 3, fontSize: ".76rem", color: "var(--muted)" }}>
                        {alcanceDoPapel(entry.role)}
                        {papelDe(entry.role) === "partner" && entry.permissoesEdicao?.length
                          ? ` · edita ${entry.permissoesEdicao.map((t) => PERMISSION_TAB_LABEL[t]).join(", ")}`
                          : papelDe(entry.role) === "partner" ? " · só leitura" : ""}
                        {entry.addedAt ? ` · desde ${new Date(entry.addedAt).toLocaleDateString("pt-BR")}` : ""}
                      </div>
                    </div>
                  </div>
                  {canEdit && (
                    <div className="row-actions">
                      <button type="button" className="btn btn-warning btn-xs" onClick={() => startEdit(entry)}>Editar</button>
                      <button
                        type="button" className="btn btn-danger btn-xs" onClick={() => deleteEntry(entry.email)}
                        disabled={entry.role === "owner" && owners <= 1}
                        title={entry.role === "owner" && owners <= 1 ? "Único Owner — não pode ser removido" : undefined}
                      >
                        Remover
                      </button>
                    </div>
                  )}
                </div>
              ))
            ) : (
              <div className="empty-state"><span className="empty-ico">🔐</span>Nenhum e-mail encontrado.</div>
            )}
          </div>
        </div>

        <div className="panel">
          <div className="panel-head" style={{ marginBottom: 4 }}>
            <span className="panel-title">Trilha de auditoria</span>
            <span className="panel-sub">últimas {auditLog.length} ações</span>
          </div>
          <div style={{ fontSize: ".78rem", color: "var(--muted)", marginBottom: 14 }}>
            Registro imutável de quem criou, editou, arquivou ou excluiu custos, metas e acessos. Não cobre edição campo a campo (ex.: digitar num valor de custo) — só ações discretas, pra não virar ruído.
          </div>
          <div className="list-stack">
            {auditErro ? (
              <div className="note note-danger">
                <b>Não consegui ler a trilha de auditoria.</b> Se a mensagem abaixo fala em permissão,
                as regras do Firestore precisam ser republicadas com a coleção <b>auditLog</b>{" "}
                (<code>firebase deploy --only firestore:rules</code>).
                <div style={{ marginTop: 6, fontFamily: "ui-monospace, monospace", fontSize: ".7rem", overflowWrap: "anywhere" }}>{auditErro}</div>
              </div>
            ) : auditLoading ? (
              <div style={{ color: "var(--muted)", fontSize: ".9rem" }}>Carregando…</div>
            ) : auditLog.length === 0 ? (
              <div className="empty-state"><span className="empty-ico">📜</span>Nenhuma ação registrada ainda.</div>
            ) : (
              auditLog.map((evt) => (
                <div key={evt.id} className="list-row" style={{ padding: "8px 12px" }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                    <span
                      className="severity-chip"
                      style={{ color: AUDIT_TONE[evt.acao], background: "transparent", border: `1px solid ${AUDIT_TONE[evt.acao]}` }}
                    >
                      {AUDIT_ACAO_LABEL[evt.acao]}
                    </span>
                    <span style={{ fontSize: ".85rem" }}>
                      {AUDIT_ENTIDADE_LABEL[evt.entidade]} <b style={{ overflowWrap: "anywhere" }}>{evt.entidadeLabel}</b>
                    </span>
                  </div>
                  <div style={{ marginTop: 3, fontSize: ".76rem", color: "var(--muted)" }}>
                    {evt.por} · {new Date(evt.em).toLocaleString("pt-BR")}
                    {evt.detalhe ? ` · ${evt.detalhe}` : ""}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
