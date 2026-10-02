// Entender o pedido antes de agir (Vitor, 02/10/2026: "quando não tiver certeza, ele pode perguntar" e "faz" no
// cérebro maior só para entender). O modelo pequeno lia "reuniões que falei em fazer coisas no CRM" como "só as que eu
// faço" e cortava de 54 para 4. Aqui o GPT-6 Sol lê só a conversa (sem o retrato) e diz o que ela quer, de quem são as
// ações e se há dúvida; o Assistente (GPT-6 Luna) segue esse entendimento. Falhou ou demorou: o Assistente segue sem ele.
import { chamarModelo } from "./ia";

export const MODELO_ENTENDER = process.env.ACOES_ENTENDER_MODEL || "gpt-6-sol";

export type DeQuem = "todos" | "dela" | "de_outra_pessoa" | "dela_e_de_outra";
export type Entendimento = {
  resumo: string;
  tipo: "consulta" | "mudanca" | "outro";
  de_quem: DeQuem;
  certeza: "alta" | "baixa";
  /** Consulta com duas leituras: a resposta vai pela mais ampla e termina oferecendo a outra. */
  oferecer: string | null;
  /** Mudança que pode sair errada sem saber o que ela quer: pergunta antes de fazer. */
  pergunta: string | null;
  custoUsd: number;
  segundos: number;
};

const nulo = (descricao: string) => ({ type: ["string", "null"], description: descricao });

const ESQUEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    resumo: { type: "string", description: "O que ela quer, em uma frase curta." },
    tipo: { type: "string", enum: ["consulta", "mudanca", "outro"] },
    de_quem: { type: "string", enum: ["todos", "dela", "de_outra_pessoa", "dela_e_de_outra"] },
    certeza: { type: "string", enum: ["alta", "baixa"] },
    oferecer: nulo("Só em consulta com certeza baixa: a pergunta curta que oferece a leitura mais estreita."),
    pergunta: nulo("Só em mudança que pode sair errada: a pergunta curta, com as opções numeradas."),
  },
  required: ["resumo", "tipo", "de_quem", "certeza", "oferecer", "pergunta"],
};

function instrucoes(nome: string): string {
  return [
    `Você é a primeira etapa do Assistente do Ações, dentro do TTARS da Welcome. Antes de o Assistente agir, você entende o que ${nome} pediu. Você não responde o pedido nem procura nada.`,
    "Ações são combinados internos da equipe: saem das reuniões gravadas ou são criadas na mão. Cada uma tem quem faz, de quem é a lista (quem criou), prazo, situação, reunião, projeto e time.",
    "Leia a conversa inteira: a última fala dela pode continuar a anterior (pedir as concluídas, pedir todas, pedir em texto, limitar às dela).",
    "resumo: o que ela quer agora, em uma frase curta, sem inventar nada.",
    "tipo: consulta (ver, listar, resumir, contar, achar, compilar), mudanca (criar, mudar, concluir, cancelar, passar, comentar, juntar, puxar, marcar) ou outro (conversa, agradecimento, assunto fora do Ações).",
    "de_quem, pela pessoa que FAZ ou de quem é a LISTA: todos = ela pede por assunto, reunião, projeto ou time, sem dizer de quem (falar de um assunto numa reunião não é ficar de fazer); dela = as que ela faz, cobra ou estão na lista dela; de_outra_pessoa = as de alguém que ela cita; dela_e_de_outra = o que há entre ela e alguém (o que ela deve a alguém, o que alguém deve a ela).",
    "Sem assunto nem pessoa, pergunta sobre prazo, atraso, prioridade, andamento ou o que ela faz, cobra ou espera fala da lista dela: dela, com certeza alta.",
    "certeza: alta quando as palavras dela decidem; baixa quando o pedido aceita duas leituras e a resposta muda muito entre elas.",
    "oferecer: só em consulta com certeza baixa entre uma leitura mais ampla e uma mais estreita. Fique com a mais ampla em de_quem e escreva aqui a pergunta curta, falando com ela, que oferece a outra. Senão, null.",
    "pergunta: só em mudança que pode sair errada por não saber o que ela quer (o que mudar, em quais ações, para quem). Escreva a pergunta curta com as opções numeradas. Nome de pessoa repetido e qual ação da lista o Assistente resolve com a lista dele: não pergunte por isso. Senão, null.",
    "Nunca pergunte em consulta: a resposta vai pela leitura mais ampla e oferece a outra.",
  ].join("\n");
}

/** As últimas falas como o Sol lê: as dela inteiras (até 600 letras), as do Assistente só o começo. */
function conversaEmTexto(falas: { quem: string; texto: string }[]): string {
  return falas
    .slice(-6)
    .map((f) => (f.quem === "pessoa" ? `ELA: ${f.texto.slice(0, 600)}` : `ASSISTENTE: ${f.texto.replace(/\s+/g, " ").slice(0, 300)}`))
    .join("\n");
}

export async function entenderPedido(
  user: { id: string; nome: string },
  falas: { quem: string; texto: string }[],
  lugar: string | null,
): Promise<Entendimento | null> {
  const comeco = Date.now();
  try {
    const r = await chamarModelo({
      userId: user.id,
      modelo: MODELO_ENTENDER,
      instrucoes: instrucoes(user.nome),
      entrada: [{ role: "user", content: `${lugar ? `TELA ABERTA: ${lugar}\n` : ""}CONVERSA:\n${conversaEmTexto(falas)}` }],
      formato: { nome: "entendimento", schema: ESQUEMA },
      esforco: "low",
      maxSaida: 1500,
      signal: AbortSignal.timeout(20_000),
    });
    const d = JSON.parse(r.texto || "{}") as Partial<Entendimento>;
    if (!d.resumo || !d.tipo || !d.de_quem || !d.certeza) return null;
    return {
      resumo: d.resumo,
      tipo: d.tipo,
      de_quem: d.de_quem,
      certeza: d.certeza,
      oferecer: d.tipo === "consulta" && d.certeza === "baixa" ? (d.oferecer?.trim() || null) : null,
      pergunta: d.tipo === "mudanca" ? (d.pergunta?.trim() || null) : null,
      custoUsd: r.custoUsd,
      segundos: Number(((Date.now() - comeco) / 1000).toFixed(1)),
    };
  } catch (e) {
    console.error("[agente] entender o pedido:", e);
    return null;
  }
}

const DE_QUEM: Record<DeQuem, string> = {
  todos: "de qualquer pessoa (procurar vai sem quem_faz e sem lista_de)",
  dela: "dela (as que ela faz, cobra ou estão na lista dela)",
  de_outra_pessoa: "da pessoa que ela cita",
  dela_e_de_outra: "entre ela e a pessoa que ela cita",
};

/** O entendimento como o Assistente recebe, logo depois da última fala. */
export function entendimentoEmTexto(e: Entendimento): string {
  return [
    `ENTENDIMENTO DA ÚLTIMA FALA (feito antes; siga): ${e.resumo}`,
    `De quem: ${DE_QUEM[e.de_quem]}.`,
    e.oferecer ? `No fim da resposta, em uma linha, ofereça: "${e.oferecer}". Só se o que achou deixar a oferta útil (nenhuma dela = não ofereça só as dela).` : null,
  ]
    .filter(Boolean)
    .join("\n");
}
