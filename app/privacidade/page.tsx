import type { Metadata } from "next";
import DocumentoLegal from "@/components/DocumentoLegal";

export const metadata: Metadata = { title: "Política de privacidade | ZXP Market" };

export default function Privacidade() {
  return (
    <DocumentoLegal titulo="Política de privacidade">
      <h2>O que guardamos</h2>
      <ul>
        <li><b>Do time</b>: e-mail, nome e foto de quem usa o sistema, papel e permissões — para login e controle de acesso.</li>
        <li><b>Da operação</b>: vendas lidas do Mercado Livre, estoque, custos, metas e tarefas informados por vocês.</li>
        <li><b>Dos compradores</b>: somente o número de comprador do Mercado Livre em cada pedido. Não guardamos nome, e-mail, telefone, documento nem endereço de comprador.</li>
        <li><b>Registros de segurança</b>: quem fez o quê e quando, e registros técnicos com dados pessoais ocultados.</li>
      </ul>
      <h2>Para que</h2>
      <p>Prestar o serviço contratado (mostrar os números da operação), manter a segurança e cumprir obrigações legais.</p>
      <h2>Com quem</h2>
      <p>Provedores que operam o serviço: Google (banco de dados, login e notificações), Vercel (hospedagem), Mercado Livre (origem das vendas, por autorização de vocês) e o processador de pagamentos da assinatura. Não vendemos dados.</p>
      <h2>Por quanto tempo</h2>
      <p>Enquanto a empresa for cliente. Registros técnicos e de notificação têm prazos curtos (de 14 a 30 dias); cópias de segurança expiram pela rotina de retenção.</p>
      <h2>Seus direitos</h2>
      <p>Você pode pedir acesso, correção, portabilidade e exclusão dos seus dados pessoais (Lei 13.709/2018). Dados da operação de uma empresa são tratados em nome dela: o pedido passa pelo dono da empresa.</p>
      <h2>Contato</h2>
      <p>Pelo canal de atendimento informado na sua conta.</p>
    </DocumentoLegal>
  );
}
