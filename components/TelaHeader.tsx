"use client";

import { useId, useState } from "react";
import type { EstadoDaTela } from "@/lib/domain/estado-da-tela";
import { rotuloDoPeriodo } from "@/lib/domain/estado-da-tela";

/**
 * O cabeçalho que toda tela do app passa a ter.
 *
 * ─── O QUE HAVIA ─────────────────────────────────────────────────────────
 *
 * Dez abas, dez cabeçalhos escritos à mão. Cada um decidia sozinho o que
 * mostrar ao lado do título, e o resultado era que nenhum mostrava a mesma
 * coisa: Custos dizia "12 ativo(s) · valores de setembro", Ads mostrava um
 * botão de atualizar, Estoque mostrava dois. Nenhum dizia o **estado dos
 * dados** — se o que está na tela pode ser lido como o estado atual.
 *
 * A pergunta que o cabeçalho responde é sempre a mesma: *posso confiar no que
 * estou vendo agora?* Não "o app está ocupado" — isso o spinner já diz.
 *
 * ─── UMA AÇÃO PRINCIPAL, E O RESTO ATRÁS ─────────────────────────────────
 *
 * `acao` é uma só, de propósito. Estoque tinha quatro botões na mesma altura
 * e com o mesmo peso visual — "Atualizar Full", "Vincular por SKU", "Imposto
 * em massa", "Novo produto" — e quatro ações com o mesmo peso não são quatro
 * ações, são nenhuma: a pessoa lê os quatro toda vez pra achar o que quer.
 *
 * As secundárias continuam alcançáveis, num menu. O que muda é que a
 * principal fica sozinha e visível.
 */

export type AcaoDeTela = {
  rotulo: string;
  onClick: () => void;
  titulo?: string;
  desabilitada?: boolean;
};

export default function TelaHeader({
  titulo, subtitulo, periodo, estado, acao, secundarias = [], extra,
}: {
  titulo: string;
  /** Uma linha de contexto — contagem, escopo. Nunca o estado dos dados. */
  subtitulo?: string;
  /** Período apurado. Formatado por `rotuloDoPeriodo`, igual em todo o app. */
  periodo?: { de: string; ate: string } | null;
  estado?: EstadoDaTela | null;
  /** A ação principal. Uma só. */
  acao?: AcaoDeTela | null;
  /** As demais, atrás de um menu. */
  secundarias?: AcaoDeTela[];
  /** Controle que pertence ao cabeçalho, como o seletor de período. */
  extra?: React.ReactNode;
}) {
  const [menuAberto, setMenuAberto] = useState(false);
  const menuId = useId();

  return (
    <div className="tela-head">
      <div className="tela-head-id">
        <h2 className="tab-title">{titulo}</h2>

        <div className="tela-head-meta">
          {periodo?.de && periodo?.ate && (
            <span className="tela-head-periodo">{rotuloDoPeriodo(periodo.de, periodo.ate)}</span>
          )}
          {subtitulo && <span className="tela-head-sub">{subtitulo}</span>}

          {/*
            O selo do estado carrega COR e TEXTO. Só cor excluiria quem não
            distingue verde de âmbar — que é o par exato usado aqui pra
            "confiável" e "falta informação".
          */}
          {estado && (
            <span
              className="tela-head-estado"
              style={{ color: estado.cor, borderColor: estado.cor }}
              title={estado.detalhe}
            >
              {estado.situacao === "carregando" ? "◌" : estado.situacao === "completo" ? "●" : "▲"}
              {" "}{estado.rotulo}
            </span>
          )}
        </div>
      </div>

      <div className="tela-head-acoes">
        {extra}

        {acao && (
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={acao.onClick}
            title={acao.titulo}
            disabled={acao.desabilitada}
          >
            {acao.rotulo}
          </button>
        )}

        {secundarias.length > 0 && (
          <div style={{ position: "relative" }}>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setMenuAberto((v) => !v)}
              aria-expanded={menuAberto}
              aria-haspopup="menu"
              aria-controls={menuId}
              // O nome acessível não pode ser só "⋯": um leitor de tela
              // anunciaria "reticências, botão", que não diz o que acontece.
              aria-label="Mais ações desta tela"
            >
              ⋯
            </button>

            {menuAberto && (
              <>
                {/*
                  A camada de fechar vem ANTES do menu na ordem do DOM e sem
                  foco: clicar fora fecha, e quem navega por teclado nunca
                  tropeça nela — chega direto nos itens.
                */}
                <div
                  onClick={() => setMenuAberto(false)}
                  style={{ position: "fixed", inset: 0, zIndex: 40 }}
                  aria-hidden="true"
                />
                <div
                  id={menuId}
                  role="menu"
                  className="tela-head-menu"
                  onKeyDown={(e) => { if (e.key === "Escape") setMenuAberto(false); }}
                >
                  {secundarias.map((s) => (
                    <button
                      key={s.rotulo}
                      type="button"
                      role="menuitem"
                      className="tela-head-menu-item"
                      title={s.titulo}
                      disabled={s.desabilitada}
                      onClick={() => { setMenuAberto(false); s.onClick(); }}
                    >
                      {s.rotulo}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
