import type { ResultadoCompradores } from "@/lib/domain/repurchase";
import type { ResultadoHeatmap } from "@/lib/domain/sales-heatmap";
import type { ResultadoEntregas } from "@/lib/domain/shipping-performance";
import type { SellerReputation } from "@/lib/domain/reputation";
import type { RequisitoMercadoLider } from "@/lib/domain/mercadolider-requisitos";
import type { PeriodoDaReputacao } from "@/lib/domain/fonte-desempenho";
import type { SourceState } from "@/lib/domain/tenant";

export type DesempenhoResponse = {
  months: number;
  /** Quando setado, o periodo foi medido em dias (pra bater com o painel do ML). */
  dias: number | null;
  /** Pedidos validos do periodo sem buyer_id — ficam fora da conta de compradores. */
  semComprador: number;
  from: string;
  to: string;
  compradores: ResultadoCompradores;
  /** Data mais antiga entre os pedidos sincronizados (YYYY-MM-DD), ou null se não há nenhum. */
  historicoDesde: string | null;
  heatmap: ResultadoHeatmap;
  entregas: ResultadoEntregas;
  reputacao: SellerReputation | null;
  reputacaoIndisponivel: boolean;
  /** A janela que o ML usa pra reputação (60 ou 365 dias). Ausente em resposta de antes do S10. */
  periodoReputacao?: PeriodoDaReputacao;
  /** Quando a reputação foi buscada e de qual geração da conexão (S10). */
  fonteReputacao?: SourceState;
  registrationDate: string | null;
  requisitosMercadoLider: RequisitoMercadoLider[];
  cached?: boolean;
};
