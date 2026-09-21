"use client";

import { faixaInvertida } from "@/lib/domain/ads-faixas";

/**
 * Um par mínimo/máximo, com nome, unidade e aviso de faixa invertida.
 *
 * Era escrito à mão em cada tela (Ads, Pedidos): "mín." e "máx." soltos, sem o nome
 * da faixa ligado a eles — o leitor de tela dizia "campo numérico, mín." quatro vezes
 * seguidas — e mínimo maior que máximo zerava a lista sem nenhum aviso. Aqui o
 * `<fieldset>` dá o nome do grupo, cada campo tem o seu ("ROAS mínimo, em x") e a
 * faixa invertida é dita na hora. A regra de "invertida" mora em `lib/domain/ads-faixas`.
 */
export default function CampoFaixa({ id, nome, unidade, min, max, onMin, onMax, larg }: {
  /** Prefixo único dos ids (o do aviso de erro sai daqui). */
  id: string;
  nome: string;
  unidade: string;
  min: string; max: string;
  onMin: (v: string) => void; onMax: (v: string) => void;
  larg?: number;
}) {
  const invertida = faixaInvertida({ min, max });
  const erroId = `${id}-erro`;
  return (
    <fieldset className="campo-faixa" aria-describedby={invertida ? erroId : undefined}>
      <legend>{nome} <span className="campo-faixa-un">({unidade})</span></legend>
      <div className="campo-faixa-campos">
        <input
          type="number" inputMode="decimal" step="any" min="0" placeholder="mín."
          aria-label={`${nome} mínimo, em ${unidade}`} aria-invalid={invertida || undefined}
          value={min} onChange={(e) => onMin(e.target.value)} style={larg ? { width: larg } : undefined}
        />
        <span aria-hidden="true">–</span>
        <input
          type="number" inputMode="decimal" step="any" min="0" placeholder="máx."
          aria-label={`${nome} máximo, em ${unidade}`} aria-invalid={invertida || undefined}
          value={max} onChange={(e) => onMax(e.target.value)} style={larg ? { width: larg } : undefined}
        />
      </div>
      {invertida && (
        <div id={erroId} className="campo-faixa-erro" role="alert">
          O mínimo é maior que o máximo — nada passa por esta faixa.
        </div>
      )}
    </fieldset>
  );
}
