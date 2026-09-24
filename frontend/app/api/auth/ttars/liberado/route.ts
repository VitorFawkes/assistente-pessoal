import { cabecalhosTtars, estaLiberado, pessoaDoTtars, tokenDoPedido } from "@/lib/ttars-auth";
import { clientIp, rateLimit } from "@/lib/rate-limit";

// A aba do TTARS pergunta aqui se deve aparecer para a pessoa logada.
export async function OPTIONS(req: Request) {
  return new Response(null, { status: 204, headers: cabecalhosTtars(req) });
}

export async function POST(req: Request) {
  const cors = cabecalhosTtars(req);
  if (!rateLimit(`ttars-liberado:${clientIp(req.headers)}`, 60, 60_000)) {
    return Response.json({ liberado: false }, { status: 429, headers: cors });
  }
  const pessoa = await pessoaDoTtars(tokenDoPedido(req));
  const liberado = pessoa ? await estaLiberado(pessoa.email) : false;
  return Response.json({ liberado }, { headers: cors });
}
