"use client";

import { fmtBRL, fmtPct } from "@/lib/domain/calc";
import type { ComputedAd } from "@/lib/domain/types";

type Props = {
  ads: ComputedAd[];
};

export default function TopAdsTable({ ads }: Props) {
  const top3 = [...ads]
    .sort((a, b) => b.liquido - a.liquido)
    .slice(0, 3);

  if (top3.length === 0) {
    return (
      <div style={{ color: "var(--muted)", fontSize: ".82rem", padding: "12px 0" }}>
        Nenhum anuncio hoje.
      </div>
    );
  }

  return (
    <div className="table-wrapper">
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Anuncio</th>
            <th>Faturamento</th>
            <th>L. Liquido</th>
            <th>Margem</th>
          </tr>
        </thead>
        <tbody>
          {top3.map((ad, i) => {
            const medals = ["1", "2", "3"];
            return (
              <tr key={i}>
                <td style={{ color: "var(--muted)", fontWeight: 700 }}>{medals[i]}</td>
                <td className="td-name">{ad.name}</td>
                <td className="positive">{fmtBRL(ad.faturamento)}</td>
                <td
                  className={
                    ad.liquido > 0 ? "positive" : ad.liquido < 0 ? "negative" : "neutral"
                  }
                >
                  {fmtBRL(ad.liquido)}
                </td>
                <td
                  className={
                    ad.margem >= 20
                      ? "positive"
                      : ad.margem >= 10
                      ? "neutral"
                      : "negative"
                  }
                >
                  {fmtPct(ad.margem, 1)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
