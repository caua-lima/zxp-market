import { describe, it, expect } from "vitest";
import { filtrarComandos } from "./busca-rapida";

const itens = [
  { id: "dre", label: "DRE" },
  { id: "preco", label: "Precificação" },
  { id: "pedidos", label: "Pedidos" },
  { id: "ads", label: "Ads" },
  { id: "adschat", label: "Chat de Ads" },
  { id: "estoque", label: "Estoque" },
];
const ids = (l: { id: string }[]) => l.map((x) => x.id);

describe("filtrarComandos", () => {
  it("consulta vazia devolve tudo, na ordem original", () => {
    expect(ids(filtrarComandos(itens, ""))).toEqual(ids(itens));
    expect(ids(filtrarComandos(itens, "   "))).toEqual(ids(itens));
  });

  it("'precificacao' (sem cedilha e sem til) acha 'Precificação' — o exemplo do relatório", () => {
    expect(ids(filtrarComandos(itens, "precificacao"))).toEqual(["preco"]);
  });

  it("ignora caixa e acento dos dois lados", () => {
    expect(ids(filtrarComandos(itens, "PRECIFICAÇÃO"))).toEqual(["preco"]);
    expect(ids(filtrarComandos(itens, "precificaçao"))).toEqual(["preco"]);
  });

  it("várias palavras são E, em qualquer ordem", () => {
    expect(ids(filtrarComandos(itens, "ads chat"))).toEqual(["adschat"]);
    expect(ids(filtrarComandos(itens, "chat ads"))).toEqual(["adschat"]);
  });

  it("quem COMEÇA pelo termo vem antes de quem só contém", () => {
    // 'ads' começa "Ads" e está no meio de "Chat de Ads"
    expect(ids(filtrarComandos(itens, "ads"))).toEqual(["ads", "adschat"]);
  });

  it("não acha o que não existe", () => {
    expect(filtrarComandos(itens, "xyz")).toEqual([]);
  });

  it("não muda o array recebido", () => {
    const copia = ids(itens);
    filtrarComandos(itens, "ads");
    expect(ids(itens)).toEqual(copia);
  });
});
