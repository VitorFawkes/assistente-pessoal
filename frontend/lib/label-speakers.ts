// Identifica quem é cada Speaker (A/B/…) pelo CONTEÚDO da conversa — fallback
// quando a voz não bate (ver voice-svc). A IA já faz isso de forma confiável no
// resumo ("Speaker A (Vitor, …)"); aqui formalizamos num mapa estruturado.

const MODEL = process.env.CAPTURE_MODEL || "gpt-5.1";

export type SpeakerGuess = { nome: string; confidence: number };

const SYSTEM = `Você identifica QUEM é cada falante de uma reunião gravada pelo Vitor Gambetti, a partir do CONTEÚDO (papel, o que cada um fala, nomes citados). A transcrição vem rotulada por falante anônimo: "Speaker A:", "Speaker B:"…

REGRAS:
- O Vitor é o DONO da gravação e quase sempre está presente — costuma ser quem dirige, decide, pergunta, fala do "meu produto/time/empresa". Se um falante claramente tem esse papel, é o Vitor.
- Para os DEMAIS falantes, só dê um nome se ele estiver CLARAMENTE indicado no conteúdo (a pessoa é chamada pelo nome, se apresenta, ou o contexto não deixa dúvida). Senão use "?".
- NUNCA invente nomes que não apareçam no contexto (a única exceção é "Vitor", o dono).
- confidence de 0 a 1: use >= 0.7 só quando tiver real certeza.

Responda APENAS com JSON, uma chave por letra de speaker presente:
{ "A": { "nome": "Vitor" | "<nome>" | "?", "confidence": 0.0 }, "B": { ... } }`;

export async function labelSpeakersByContent(
  transcript: string,
  ctx: { letters: string[]; knownPeople: string[] },
): Promise<Record<string, SpeakerGuess>> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY ausente no ambiente");

  const userPayload = {
    speakers: ctx.letters,
    pessoas_conhecidas: ctx.knownPeople,
    transcricao: transcript.slice(0, 24000),
  };

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: JSON.stringify(userPayload) },
      ],
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("OpenAI: resposta sem conteúdo");

  const raw = JSON.parse(content) as Record<string, { nome?: unknown; confidence?: unknown }>;
  const out: Record<string, SpeakerGuess> = {};
  for (const [letter, v] of Object.entries(raw)) {
    if (!ctx.letters.includes(letter)) continue;
    const nome = typeof v?.nome === "string" ? v.nome.trim() : "";
    const confidence = typeof v?.confidence === "number" ? v.confidence : 0;
    if (nome) out[letter] = { nome, confidence };
  }
  return out;
}
