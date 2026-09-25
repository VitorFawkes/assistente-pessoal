import { spawn } from "node:child_process";
import { appendFile, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { query } from "./db";

export const PASTA_PEDACOS = "/audios/tmp";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// <parte>-<n>.bin: "parte" = cada vez que o gravador liga (retomar cria outra); n = ordem dentro dela.
const PEDACO_RE = /^(\d{1,15})-(\d{1,4})\.bin$/;

export function idDeGravacaoValido(id: string): boolean {
  return UUID_RE.test(id);
}

export function nomeDoPedaco(parte: number, n: number): string {
  return `${parte}-${n}.bin`;
}

/** Agrupa os pedaços por parte, em ordem. Cada parte é um arquivo contínuo cortado em bytes. */
export function ordenarPedacos(arquivos: string[]): { parte: number; pedacos: string[] }[] {
  const partes = new Map<number, { n: number; nome: string }[]>();
  for (const nome of arquivos) {
    const m = PEDACO_RE.exec(nome);
    if (!m) continue;
    const parte = Number(m[1]);
    if (!partes.has(parte)) partes.set(parte, []);
    partes.get(parte)!.push({ n: Number(m[2]), nome });
  }
  return [...partes.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([parte, lista]) => ({ parte, pedacos: lista.sort((a, b) => a.n - b.n).map((x) => x.nome) }));
}

function ffmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", (c) => (stderr += c.toString()));
    proc.on("error", reject);
    proc.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`ffmpeg ${code}: ${stderr.slice(-400)}`)),
    );
  });
}

/**
 * Junta os pedaços de uma gravação (ou de um arquivo enviado), converte e manda
 * para o ingest-svc com o dono certo. O segredo do ingest fica só no servidor.
 */
export async function finalizarGravacao(
  userId: string,
  gravacaoId: string,
  nomeOriginal?: string,
  origem: "macbook" | "ios-app" = "macbook",
) {
  if (!idDeGravacaoValido(gravacaoId) || !idDeGravacaoValido(userId)) throw new Error("id inválido");
  // Reserva a finalização (o "parar" e a varredura automática podem chegar juntos)
  const sessao = await query<{ created_at: string }>(
    `UPDATE gravacao_sessoes SET finalizada_em = now()
     WHERE id = $1 AND user_id = $2 AND finalizada_em IS NULL
     RETURNING created_at`,
    [gravacaoId, userId],
  );
  if (!sessao.length) return { jaFinalizada: true };
  try {

  const pasta = join(PASTA_PEDACOS, userId, gravacaoId);
  const partes = ordenarPedacos(await readdir(pasta));
  if (!partes.length) throw new Error("gravação sem áudio");

  const mp3s: string[] = [];
  for (const { parte, pedacos } of partes) {
    const inteiro = join(pasta, `parte-${parte}.src`);
    await writeFile(inteiro, new Uint8Array());
    for (const p of pedacos) await appendFile(inteiro, await readFile(join(pasta, p)));
    const mp3 = join(pasta, `parte-${parte}.mp3`);
    await ffmpeg(["-y", "-i", inteiro, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "libmp3lame", "-b:a", "64k", mp3]);
    mp3s.push(mp3);
  }

  let final = mp3s[0];
  if (mp3s.length > 1) {
    const lista = join(pasta, "lista.txt");
    await writeFile(lista, mp3s.map((m) => `file '${m}'`).join("\n"));
    final = join(pasta, "final.mp3");
    await ffmpeg(["-y", "-f", "concat", "-safe", "0", "-i", lista, "-c", "copy", final]);
  }

  const form = new FormData();
  const inicio = new Date(sessao[0].created_at);
  const nome = nomeOriginal || `gravacao-${inicio.toISOString().slice(0, 16).replace(/[:T]/g, "-")}.mp3`;
  form.append("audio", new Blob([await readFile(final)], { type: "audio/mpeg" }), nome);
  form.append("recorded_at", inicio.toISOString());
  form.append("original_filename", nome);
  form.append("source", origem);
  const r = await fetch(`${process.env.INGEST_INTERNAL_URL || "http://ingest-svc:8000"}/upload`, {
    method: "POST",
    headers: { "X-Auth": process.env.WEBHOOK_TOKEN || "", "X-User-Id": userId },
    body: form,
  });
  if (!r.ok) throw new Error(`ingest ${r.status}: ${(await r.text()).slice(0, 300)}`);

  await rm(pasta, { recursive: true, force: true });
  return { jaFinalizada: false };
  } catch (err) {
    await query(`UPDATE gravacao_sessoes SET finalizada_em = NULL WHERE id = $1 AND user_id = $2`, [
      gravacaoId,
      userId,
    ]);
    throw err;
  }
}

export async function pastaDaGravacao(userId: string, gravacaoId: string) {
  const pasta = join(PASTA_PEDACOS, userId, gravacaoId);
  await mkdir(pasta, { recursive: true });
  return pasta;
}
