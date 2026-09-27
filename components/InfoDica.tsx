"use client";
import { useRef, useState, type CSSProperties, type ReactNode } from "react";
import { deslocamentoDaDica } from "@/lib/domain/dica";

/**
 * O ⓘ com dica ao passar o mouse ou focar (S28).
 *
 * Duas correções em relação ao `<span className="pg-tooltip">` solto:
 *  - escondida, a dica sai do layout (`display:none` em globals.css). Com
 *    `visibility:hidden` ela continuava ocupando espaço fora da tela e alargava
 *    a página inteira.
 *  - ao abrir, mede onde está e desloca pro lado pra caber na janela
 *    (lib/domain/dica.ts), em vez de sempre centralizar no ícone.
 */
export default function InfoDica({ children, id, style }: { children: ReactNode; id?: string; style?: CSSProperties }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [deslocamento, setDeslocamento] = useState(0);

  const posicionar = () => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    setDeslocamento(deslocamentoDaDica({ centro: r.left + r.width / 2, largura: 210, larguraTela: document.documentElement.clientWidth }));
  };

  return (
    <span ref={ref} className="pg-info" tabIndex={0} aria-describedby={id} onMouseEnter={posicionar} onFocus={posicionar} style={style}>
      ⓘ
      <span role="tooltip" id={id} className="pg-tooltip" style={{ "--pg-desloca": `${deslocamento}px` } as CSSProperties}>
        {children}
      </span>
    </span>
  );
}
