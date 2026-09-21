"use client";

import { useEffect, useState } from "react";
import Modal from "@/components/Modal";
import { AvatarUpload } from "@/components/AvatarUpload";
import { useAuth } from "@/lib/firebase/auth-context";
import { updateAccessEntry, watchAccessEntry } from "@/lib/firebase/data";
import type { AccessEntry } from "@/lib/domain/types";

/**
 * "Meu Perfil" — autosserviço de nome de exibição e foto, pra owner E
 * colaborador (cada um só mexe no PRÓPRIO registro; ver isSelfNameUpdate/
 * isSelfPhotoUpdate em firestore.rules). Antes só o owner conseguia mudar o
 * nome de alguém, e só via a tela de Acesso — que edita o registro dos
 * OUTROS, não vive um "editar meus próprios dados" em lugar nenhum.
 *
 * A foto já tinha autosserviço (AvatarUpload, reaproveitado aqui do mesmo
 * jeito que aparece na sidebar) — só o nome era o que faltava.
 *
 * Sem prop `open`: quem chama só monta este componente enquanto o modal
 * estiver aberto (`{profileOpen && <MyProfileModal ... />}`, ver
 * app/page.tsx) — assim o rascunho do nome já nasce limpo a cada abertura,
 * sem precisar de um efeito só pra resetar estado ao fechar (mesmo padrão
 * já usado no CommandPalette).
 */
export default function MyProfileModal({ onClose }: { onClose: () => void }) {
  const { user } = useAuth();
  const [entry, setEntry] = useState<AccessEntry | null>(null);
  const [nome, setNome] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  const email = user?.email?.toLowerCase() ?? "";

  useEffect(() => {
    if (!email) return;
    return watchAccessEntry(email, (e) => {
      setEntry(e);
      // Só sincroniza o campo enquanto o usuário não começou a digitar nesta
      // sessão do modal — sem isso, o listener em tempo real sobrescreveria
      // o que a pessoa está escrevendo a cada snapshot novo do Firestore.
      setNome((cur) => (cur === "" ? (e?.displayName ?? "") : cur));
    });
  }, [email]);

  async function salvar() {
    const nomeLimpo = nome.trim();
    if (!nomeLimpo) { setError("O nome não pode ficar em branco."); return; }
    if (nomeLimpo === entry?.displayName) { onClose(); return; }
    setSaving(true);
    setError("");
    try {
      await updateAccessEntry(email, { displayName: nomeLimpo });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch {
      setError("Não foi possível salvar. Tente de novo.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open onClose={onClose}>
      <div className="modal-title">Meu perfil</div>

      <div style={{ display: "flex", justifyContent: "center", margin: "4px 0 18px" }}>
        <AvatarUpload size={72} />
      </div>

      <div className="config-field">
        <label htmlFor="perfil-1">E-mail</label>
        <input id="perfil-1" type="email" value={email} disabled readOnly />
        <div className="hint">Não pode ser alterado — fale com o owner se precisar trocar.</div>
      </div>

      <div className="config-field">
        <label htmlFor="perfil-2">Nome de exibição</label>
        <input id="perfil-2"
          type="text"
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          placeholder="Como você quer ser chamado"
          maxLength={119}
          autoFocus
        />
        <div className="hint">Aparece na saudação do Dashboard, em Tarefas e na aba Acesso.</div>
      </div>

      {error && <div className="note note-danger" role="alert">{error}</div>}
      {saved && <div style={{ fontSize: ".82rem", color: "var(--green)", fontWeight: 600 }} role="status">✓ Salvo!</div>}

      <div className="modal-btns">
        <button type="button" className="btn btn-success" onClick={salvar} disabled={saving}>
          {saving ? "Salvando…" : "Salvar"}
        </button>
        <button type="button" className="btn btn-ghost" onClick={onClose}>Fechar</button>
      </div>
    </Modal>
  );
}
