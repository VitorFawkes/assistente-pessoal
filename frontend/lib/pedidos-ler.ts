// Subir um arquivo com as perguntas e a IA montar o rascunho do formulário (Pedidos ao Marketing, bloco 7,
// 30/09/2026). Word, PDF com texto, .txt e .md chegam já como texto (lidos no navegador do TTARS); foto, print
// e PDF escaneado chegam como imagem. A IA (GPT-6 Luna, pelo chamarModelo) devolve as perguntas em tipos
// fechados; sem IA, cada linha do texto vira uma pergunta de texto (foto não dá). O arquivo não é guardado:
// só o nome, quem, quando e o texto lido (pedido_leituras). O gasto vai para o registro de IA (ai_usage).
import { randomUUID } from "node:crypto";
import type { User } from "./auth";
import { query } from "./db";
import { recordAiUsage } from "./ai-usage";
import { chamarModelo, IaIndisponivel, type Item } from "./ia";
import { podeMontar, type Saida } from "./pedidos";
import { PREENCHE, TIPOS, ehErro, limparPergunta, type Pergunta } from "./pedidos-tipos";

export const MAX_ARQUIVO_BYTES = 10 * 1024 * 1024;
const MAX_TEXTO = 200_000;
const IMAGENS = ["image/png", "image/jpeg", "image/webp", "image/gif"];
const PDF = "application/pdf";

const falha = (status: number, mensagem: string): Saida => ({ status, json: { error: mensagem, erro: mensagem } });

type Lida = { perguntas: Pergunta[]; ignoradas: string[] };

const ESQUEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    perguntas: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          tipo: { type: "string", enum: TIPOS.filter((t) => t !== "automatico_quem_pede") },
          rotulo: { type: "string", description: "A pergunta como a pessoa vai ler (curta, sem numeração)." },
          ajuda: { type: ["string", "null"], description: "Explicação que estava junto da pergunta, ou null." },
          obrigatoria: { type: "boolean" },
          aceita_nao_temos: { type: "boolean", description: "true quando o dado pode ainda não existir (ex.: Instagram, contato)." },
          opcoes: { type: "array", items: { type: "string" }, description: "Só em escolha_unica e multipla; senão []." },
          preenche: { type: ["string", "null"], enum: [...PREENCHE, null] },
          linha_original: { type: "string", description: "A linha do arquivo de onde a pergunta saiu, sem mudar nada." },
        },
        required: ["tipo", "rotulo", "ajuda", "obrigatoria", "aceita_nao_temos", "opcoes", "preenche", "linha_original"],
      },
    },
    ignoradas: { type: "array", items: { type: "string" }, description: "Linhas que não são pergunta (títulos, avisos), como estão no arquivo." },
  },
  required: ["perguntas", "ignoradas"],
};

const INSTRUCOES = [
  "Você lê um documento com as perguntas de um formulário de pedido interno da Welcome (agência de viagens e casamentos) e devolve as perguntas.",
  "Cada pergunta do documento vira UMA pergunta, na mesma ordem, com as palavras do documento (tire só numeração e marcadores).",
  "tipo: texto (resposta curta), paragrafo (resposta longa ou lista), data, sim_nao (sim/não), escolha_unica e multipla (quando o documento lista as opções; ponha em opcoes), telefone_email, instagram (@ de alguém), link, numero, casamento (quando pede para escolher o casamento).",
  "preenche: data_casamento, casal, local, programacao, produtora ou instagram quando a pergunta é exatamente esse dado do casamento; senão null.",
  "obrigatoria: true quando o documento diz que é obrigatória (asterisco, 'obrigatório'); na dúvida, false.",
  "linha_original: copie a linha do documento de onde saiu a pergunta.",
  "ignoradas: títulos, instruções e textos que não são pergunta, como estão no documento.",
  "Não invente pergunta que não está no documento.",
].join("\n");

/** Sem IA: cada linha não vazia vira uma pergunta de texto (a pessoa ajusta na revisão). */
export function perguntasPorLinha(texto: string): Lida {
  const perguntas: Pergunta[] = [];
  for (const bruta of texto.split(/\r?\n/)) {
    const linha = bruta.trim();
    if (!linha) continue;
    const rotulo = linha.replace(/^([-*•·–]|\d+[.)-]|[a-z][.)])\s*/i, "").trim().slice(0, 300);
    if (!rotulo) continue;
    perguntas.push({ id: `p${perguntas.length + 1}`, tipo: "texto", rotulo, obrigatoria: false, aceita_nao_temos: false, linha_original: linha.slice(0, 1000) });
    if (perguntas.length >= 80) break;
  }
  return { perguntas, ignoradas: [] };
}

/** O que a IA devolveu, conferido (tipo, "preenche" e opções fechados; id novo para cada uma). */
export function perguntasDaIa(json: unknown): Lida {
  const o = (json && typeof json === "object" ? json : {}) as { perguntas?: unknown[]; ignoradas?: unknown[] };
  const perguntas: Pergunta[] = [];
  for (const x of Array.isArray(o.perguntas) ? o.perguntas : []) {
    const p = limparPergunta({ ...(x as object), id: `p${perguntas.length + 1}` }, perguntas.length);
    if (!ehErro(p)) perguntas.push(p);
    if (perguntas.length >= 80) break;
  }
  const ignoradas = (Array.isArray(o.ignoradas) ? o.ignoradas : [])
    .filter((x): x is string => typeof x === "string" && !!x.trim())
    .map((x) => x.trim().slice(0, 1000))
    .slice(0, 200);
  return { perguntas, ignoradas };
}

async function guardarLeitura(user: User, nome: string, textoLido: string, usouIa: boolean) {
  await query(`INSERT INTO pedido_leituras (nome_arquivo, user_id, texto_lido, usou_ia) VALUES ($1, $2, $3, $4)`, [
    nome,
    user.id,
    textoLido.slice(0, MAX_TEXTO),
    usouIa,
  ]);
}

/** POST /api/ttars/pedidos/montar/ler-arquivo. Corpo: { nome_arquivo, texto?, imagem_base64?, mime? }. */
export async function lerArquivoDePerguntas(user: User, corpo: unknown): Promise<Saida> {
  if (!(await podeMontar(user.id))) return falha(403, "Só quem monta os pedidos mexe nos formulários.");
  const b = (corpo && typeof corpo === "object" ? corpo : {}) as Record<string, unknown>;
  const nome = typeof b.nome_arquivo === "string" && b.nome_arquivo.trim() ? b.nome_arquivo.trim().slice(0, 300) : "arquivo";
  const texto = typeof b.texto === "string" ? b.texto.replace(/\u0000/g, "") : "";
  const base64 = typeof b.imagem_base64 === "string" ? b.imagem_base64.replace(/^data:[^,]*,/, "").replace(/\s+/g, "") : "";
  const mime = typeof b.mime === "string" ? b.mime.trim().toLowerCase() : "";
  if (!texto.trim() && !base64) return falha(400, "O arquivo veio vazio.");
  if (texto.length > MAX_TEXTO) return falha(413, "O texto passa do tamanho que dá para ler de uma vez.");
  let bytes = 0;
  if (base64) {
    if (!IMAGENS.includes(mime) && mime !== PDF) return falha(415, "Esse tipo de arquivo não dá para ler. Mande foto, print ou PDF.");
    bytes = Buffer.byteLength(base64, "base64");
    if (bytes > MAX_ARQUIVO_BYTES) return falha(413, "O arquivo passa de 10 MB.");
  }

  const conteudo: Item[] = [];
  if (texto.trim()) conteudo.push({ type: "input_text", text: `Arquivo: ${nome}\n\n${texto}` });
  if (base64) {
    const dado = `data:${mime};base64,${base64}`;
    conteudo.push(
      mime === PDF ? { type: "input_file", filename: nome, file_data: dado } : { type: "input_image", image_url: dado, detail: "high" },
    );
    if (!texto.trim()) conteudo.unshift({ type: "input_text", text: `Arquivo: ${nome}` });
  }

  let lida: Lida;
  let usouIa = false;
  try {
    const r = await chamarModelo({
      userId: user.id,
      instrucoes: INSTRUCOES,
      entrada: [{ role: "user", content: conteudo }],
      formato: { nome: "formulario", schema: ESQUEMA },
      maxSaida: 6000,
      signal: AbortSignal.timeout(90_000),
    });
    await recordAiUsage({
      ref: `pedidos_ler_arquivo:${randomUUID()}`,
      agent: "pedidos_ler_arquivo",
      provider: "openai",
      model: r.modelo,
      source: "app",
      userId: user.id,
      inputTokens: r.uso.entrada,
      cachedTokens: r.uso.cache,
      outputTokens: r.uso.saida,
      costUsd: r.custoUsd,
      basis: "medido",
      note: base64 ? `arquivo ${Math.round(bytes / 1024)} KB` : null,
    });
    lida = perguntasDaIa(JSON.parse(r.texto));
    usouIa = true;
  } catch (e) {
    if (!(e instanceof IaIndisponivel) && !(e instanceof SyntaxError)) console.error("[pedidos] ler arquivo:", e);
    // Plano B: texto vira uma pergunta por linha; foto não tem como.
    if (!texto.trim()) return falha(422, "Sem a IA não dá para ler foto: cole o texto");
    lida = perguntasPorLinha(texto);
  }
  const textoLido = texto.trim() ? texto : [...lida.perguntas.map((p) => p.linha_original ?? p.rotulo), ...lida.ignoradas].join("\n");
  await guardarLeitura(user, nome, textoLido, usouIa);
  return { status: 200, json: { perguntas: lida.perguntas, ignoradas: lida.ignoradas, usou_ia: usouIa } };
}
