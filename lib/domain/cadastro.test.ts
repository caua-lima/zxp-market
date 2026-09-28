import { describe, expect, it } from "vitest";
import { avaliarCadastro, idDaEmpresa, TERMOS_VERSAO, validarNomeDaEmpresa } from "./cadastro";
import { passosDeAtivacao, resumoDaAtivacao, type SinaisDeAtivacao } from "./ativacao";

const pedido = (p: Partial<Parameters<typeof avaliarCadastro>[0]> = {}) => ({
  email: "dona@nova.com", emailVerificado: true, nome: "Loja da Ana", termos: TERMOS_VERSAO,
  cadastroAberto: true, modoEmpresa: true, empresaAtual: null, ...p,
});

describe("S24 — cadastro da empresa", () => {
  it("id: sem acento, minúsculo, com sufixo — dois nomes iguais não colidem", () => {
    expect(idDaEmpresa("Loja do João & Cia.", "a1B2c3")).toBe("loja-do-joao-cia-a1b2c3");
    expect(idDaEmpresa("   ", "zz99")).toBe("empresa-zz99");
    expect(idDaEmpresa("Loja do João", "x1")).not.toBe(idDaEmpresa("Loja do João", "x2"));
    expect(idDaEmpresa("a".repeat(100), "12345678")).toMatch(/^[a-z0-9-]{2,60}$/);
  });

  it("nome: espaços normalizados; curto, longo ou com caractere de código é recusado", () => {
    expect(validarNomeDaEmpresa("  Loja   da  Ana ")).toEqual({ ok: true, nome: "Loja da Ana" });
    expect(validarNomeDaEmpresa("A").ok).toBe(false);
    expect(validarNomeDaEmpresa("x".repeat(81)).ok).toBe(false);
    expect(validarNomeDaEmpresa("<script>").ok).toBe(false);
    expect(validarNomeDaEmpresa(42).ok).toBe(false);
  });

  it("recusas, na ordem que a tela explica", () => {
    expect(avaliarCadastro(pedido({ cadastroAberto: false }))).toMatchObject({ motivo: "cadastro_fechado" });
    expect(avaliarCadastro(pedido({ modoEmpresa: false }))).toMatchObject({ motivo: "so_modo_empresa" });
    expect(avaliarCadastro(pedido({ emailVerificado: false }))).toMatchObject({ motivo: "email_nao_verificado" });
    expect(avaliarCadastro(pedido({ empresaAtual: "outra" }))).toMatchObject({ motivo: "ja_tem_empresa" });
    expect(avaliarCadastro(pedido({ termos: "2020-01-01" }))).toMatchObject({ motivo: "termos_nao_aceitos" });
    expect(avaliarCadastro(pedido({ nome: "" }))).toMatchObject({ motivo: "nome_invalido" });
    expect(avaliarCadastro(pedido())).toEqual({ ok: true, nome: "Loja da Ana" });
  });
});

describe("S24 — checklist de ativação", () => {
  const vazio: SinaisDeAtivacao = { mlConectado: false, pedidosImportados: 0, primeiraSincronizacao: false, produtos: 0, produtosComCusto: 0, custosCadastrados: 0, temMeta: false, pessoasNoTime: 1 };

  it("empresa recém-criada: nada feito, e o painel ainda não é confiável", () => {
    const p = passosDeAtivacao(vazio);
    expect(p.map((x) => x.feito)).toEqual([false, false, false, false, false, false]);
    expect(resumoDaAtivacao(p)).toEqual({ feitos: 0, total: 6, confiavel: false, completo: false });
  });

  it("conectado e importando: a sincronização mostra progresso, não 'feito'", () => {
    const p = passosDeAtivacao({ ...vazio, mlConectado: true });
    expect(p[1]).toMatchObject({ feito: false, detalhe: expect.stringContaining("Importando") });
  });

  it("produto sem custo segura o 'confiável' — o lucro sairia inflado", () => {
    const quase = { ...vazio, mlConectado: true, primeiraSincronizacao: true, pedidosImportados: 40, produtos: 5, produtosComCusto: 3 };
    const p = passosDeAtivacao(quase);
    expect(p[2].detalhe).toContain("2 produto(s) ainda sem custo");
    expect(resumoDaAtivacao(p).confiavel).toBe(false);
    expect(resumoDaAtivacao(passosDeAtivacao({ ...quase, produtosComCusto: 5 })).confiavel).toBe(true);
  });

  it("primeira sincronização sem nenhum pedido ainda conta como feita (loja nova)", () => {
    expect(passosDeAtivacao({ ...vazio, mlConectado: true, primeiraSincronizacao: true })[1]).toMatchObject({ feito: true, detalhe: "0 pedido(s) importado(s)." });
  });

  it("tudo feito: completo", () => {
    const tudo = { mlConectado: true, pedidosImportados: 3, primeiraSincronizacao: true, produtos: 2, produtosComCusto: 2, custosCadastrados: 1, temMeta: true, pessoasNoTime: 2 };
    expect(resumoDaAtivacao(passosDeAtivacao(tudo))).toEqual({ feitos: 6, total: 6, confiavel: true, completo: true });
  });
});
