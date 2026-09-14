// components/MlConnect.tsx
"use client";
import { useState } from "react";
import { useMlOrders, MlOrderItem } from "@/hooks/useMlOrders";
import { iniciarVinculoML } from "@/lib/ml/iniciar-vinculo";

interface Props {
  onImport: (items: MlOrderItem[]) => void;
  date?: string;
  connected?: boolean;
}

export function MlConnect({ onImport, date, connected = false }: Props) {
  const { items, loading, error, fetchOrders } = useMlOrders();
  const [erroVinculo, setErroVinculo] = useState<string | null>(null);

  async function handleImport() {
    await fetchOrders(date);
    if (items.length > 0) onImport(items);
  }

  if (!connected) {
    // Era um <a href="/api/ml/auth">: navegacao simples nao leva o token, e por
    // isso a rota precisava ser publica. Agora o inicio e um POST autenticado.
    return (
      <div className="flex flex-col items-start gap-1">
        <button
          type="button"
          onClick={async () => setErroVinculo(await iniciarVinculoML())}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-yellow-400 text-black font-semibold hover:bg-yellow-300 transition"
        >
          🛒 Conectar Mercado Livre
        </button>
        {erroVinculo && <span className="text-red-400 text-sm">{erroVinculo}</span>}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3">
      <button
        onClick={handleImport}
        disabled={loading}
        className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-yellow-400 text-black font-semibold hover:bg-yellow-300 transition disabled:opacity-50"
      >
        {loading ? "⏳ Importando..." : "🛒 Importar vendas ML"}
      </button>
      {error && <span className="text-red-400 text-sm">{error}</span>}
    </div>
  );
}