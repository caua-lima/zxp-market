import type { Metadata } from "next";
import DocumentoLegal from "@/components/DocumentoLegal";

export const metadata: Metadata = { title: "Termos de uso | ZXP Market" };

export default function Termos() {
  return (
    <DocumentoLegal titulo="Termos de uso">
      <h2>1. O serviço</h2>
      <p>O ZXP Market é um software de gestão para vendedores do Mercado Livre Brasil: lê as vendas da conta autorizada por você e mostra faturamento, custos, lucro estimado, estoque, metas e tarefas. Valores em reais, horário de Brasília.</p>
      <h2>2. Conta e empresa</h2>
      <p>Quem cria a empresa é o dono: responde pelas pessoas que convida e pelo que elas fazem no sistema. Cada pessoa usa o próprio login. Não compartilhe senha.</p>
      <h2>3. Conexão com o Mercado Livre</h2>
      <p>A conexão é autorizada por você no site do Mercado Livre e pode ser revogada a qualquer momento, pelo app ou pelo Mercado Livre. O ZXP Market lê os dados necessários ao painel; não publica, altera anúncios nem movimenta dinheiro na sua conta.</p>
      <h2>4. Números estimados</h2>
      <p>Lucro, margem e projeções dependem dos custos que você informa e dos dados que o Mercado Livre disponibiliza. São estimativas de gestão, não demonstrações contábeis nem fiscais.</p>
      <h2>5. Teste grátis, assinatura e cancelamento</h2>
      <p>A empresa começa com um período de teste sem cartão. Depois, o uso depende de assinatura, cobrada pelo processador de pagamentos na página dele. O cancelamento vale no fim do período já pago. Com a assinatura encerrada ou em atraso, a empresa fica em modo somente leitura: nada é apagado e os dados podem ser exportados.</p>
      <h2>6. Seus dados</h2>
      <p>Os dados da empresa são da empresa. O tratamento de dados pessoais está descrito na <a href="/privacidade">política de privacidade</a>. Ao encerrar a conta, você pode pedir a exportação e a exclusão.</p>
      <h2>7. Disponibilidade</h2>
      <p>O serviço depende de terceiros (Mercado Livre, Google Firebase, hospedagem) e pode ter interrupções. Avisos e sincronizações podem atrasar.</p>
      <h2>8. Mudanças</h2>
      <p>Mudanças relevantes nestes termos são avisadas no app, com nova versão e novo aceite quando necessário.</p>
    </DocumentoLegal>
  );
}
