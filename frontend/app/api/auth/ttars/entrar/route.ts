import {
  atualizarListaDoTtars,
  cabecalhosTtars,
  criarCodigoDeEntrada,
  ehAdmin,
  estaLiberado,
  pessoaDoTtars,
  tokenDoPedido,
} from "@/lib/ttars-auth";
import { clientIp, rateLimit } from "@/lib/rate-limit";

// Clique na aba do TTARS: confere a pessoa e devolve o endereço de entrada (código de uso único).
export async function OPTIONS(req: Request) {
  return new Response(null, { status: 204, headers: cabecalhosTtars(req) });
}

export async function POST(req: Request) {
  const cors = cabecalhosTtars(req);
  if (!rateLimit(`ttars-entrar:${clientIp(req.headers)}`, 20, 60_000)) {
    return Response.json({ liberado: false }, { status: 429, headers: cors });
  }
  const token = tokenDoPedido(req);
  const pessoa = await pessoaDoTtars(token);
  if (!pessoa || !(await estaLiberado(pessoa.email))) {
    return Response.json({ liberado: false }, { headers: cors });
  }
  if (await ehAdmin(pessoa.email)) {
    await atualizarListaDoTtars(token).catch((e) => console.error("lista do TTARS:", e));
  }
  const codigo = await criarCodigoDeEntrada(pessoa);
  const base = (process.env.PUBLIC_BASE_URL || "").replace(/\/$/, "");
  return Response.json({ liberado: true, url: `${base}/api/auth/ttars?c=${codigo}` }, { headers: cors });
}
