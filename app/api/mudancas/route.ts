import { NextResponse } from "next/server";
import { requireAccess } from "@/lib/api-auth";
import { normalizarCommits, type CommitBruto } from "@/lib/domain/mudancas";

export const maxDuration = 30;

/**
 * O histórico de mudanças publicadas do próprio app, lido do GitHub.
 *
 * ─── POR QUE DA API, E NÃO GERADO NO BUILD ──────────────────────────────
 *
 * A alternativa era um script no `prebuild` gravando um JSON. Dois problemas:
 * o build da Vercel clona raso, então o `git log` podia vir truncado sem
 * avisar; e o arquivo nunca conteria o commit que o próprio arquivo cria —
 * a lista estaria sempre uma mudança atrasada.
 *
 * Lendo a API, a lista está sempre completa e atual, e o app não fica
 * acoplado a como o build foi feito.
 *
 * ─── SEM TOKEN TAMBÉM FUNCIONA ──────────────────────────────────────────
 *
 * O repositório é público, então a busca funciona sem credencial — o limite
 * é de 60 chamadas por hora por IP. Com o cache abaixo isso dá de sobra.
 * `GITHUB_TOKEN`, se existir, sobe pra 5.000/h; é opcional de propósito, pra
 * a tela não depender de uma configuração a mais pra existir.
 */

const REPO = process.env.GITHUB_REPO || "caua-lima/zxp-market";
const BRANCH = process.env.GITHUB_BRANCH || "main";
/** 100 é o teto da API por página; 5 páginas cobrem ~500 commits. */
const POR_PAGINA = 100;
const MAX_PAGINAS = 6;

/**
 * Cache por lambda quente. A lista muda algumas vezes por dia e a aba recarrega
 * a cada troca — sem isto, uma tarde de uso estouraria o limite sem token.
 */
let cache: { at: number; body: unknown } | null = null;
const CACHE_TTL = 10 * 60 * 1000;

type CommitDaApi = {
  sha?: string;
  html_url?: string;
  commit?: {
    message?: string;
    author?: { name?: string; date?: string };
  };
  author?: { login?: string } | null;
};

export async function GET(req: Request) {
  const gate = await requireAccess(req);
  if (gate instanceof NextResponse) return gate;

  if (cache && Date.now() - cache.at < CACHE_TTL) {
    return NextResponse.json({ ...(cache.body as object), cached: true });
  }

  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    // A API recusa requisição sem User-Agent.
    "User-Agent": "zxp-market",
  };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

  const brutos: CommitBruto[] = [];
  let paginas = 0;
  let truncado = false;

  try {
    for (let pagina = 1; pagina <= MAX_PAGINAS; pagina++) {
      const url = `https://api.github.com/repos/${REPO}/commits`
        + `?sha=${encodeURIComponent(BRANCH)}&per_page=${POR_PAGINA}&page=${pagina}`;
      const res = await fetch(url, { headers, cache: "no-store" });

      if (!res.ok) {
        /**
         * Erro na PRIMEIRA página é falha de verdade; nas seguintes, devolve
         * o que já veio e avisa. Mostrar 300 mudanças com uma nota é melhor
         * que mostrar zero por causa de um limite de taxa no fim da varredura.
         */
        if (pagina === 1) {
          const detalhe = (await res.text()).slice(0, 300);
          return NextResponse.json({
            erro: res.status === 403 || res.status === 429 ? "limite_github" : "falha_github",
            status: res.status,
            detalhe,
            repo: REPO,
            mudancas: [],
          }, { status: 200 });
        }
        truncado = true;
        break;
      }

      const lote = (await res.json()) as CommitDaApi[];
      if (!Array.isArray(lote) || lote.length === 0) break;

      for (const c of lote) {
        const mensagem = String(c.commit?.message ?? "");
        brutos.push({
          sha: String(c.sha ?? ""),
          data: String(c.commit?.author?.date ?? ""),
          // Só a primeira linha vira título; o resto é o corpo do commit.
          titulo: mensagem.split("\n")[0] ?? "",
          corpo: mensagem.split("\n").slice(1).join("\n").trim() || undefined,
          autor: String(c.author?.login || c.commit?.author?.name || "—"),
          url: c.html_url,
        });
      }

      paginas = pagina;
      // Página incompleta significa que acabou.
      if (lote.length < POR_PAGINA) break;
      if (pagina === MAX_PAGINAS) truncado = true;
    }
  } catch (e) {
    return NextResponse.json({
      erro: "falha_rede",
      detalhe: e instanceof Error ? e.message : String(e),
      repo: REPO,
      mudancas: [],
    }, { status: 200 });
  }

  const body = {
    repo: REPO,
    branch: BRANCH,
    paginas,
    /** Bateu o teto de páginas: há mudanças mais antigas não listadas. */
    truncado,
    autenticado: Boolean(process.env.GITHUB_TOKEN),
    mudancas: normalizarCommits(brutos),
  };
  cache = { at: Date.now(), body };
  return NextResponse.json(body);
}
