import { requireAdmin } from "@/lib/auth";
import { query } from "@/lib/db";
import { LiberarList } from "./liberar-list";

export const dynamic = "force-dynamic";

type Pessoa = {
  nome: string;
  email: string;
  organizacao?: string;
  times?: Array<{ id: string; nome: string }>;
};

async function getTtarsRoster(): Promise<Pessoa[]> {
  // Atualizada a cada entrada do admin pela aba do TTARS (lib/ttars-auth.ts).
  return query<Pessoa>(`SELECT nome, email, organizacao, times FROM ttars_pessoas ORDER BY nome`);
}

async function getAccessControls(): Promise<Map<string, { liberado: boolean }>> {
  try {
    const rows = await query<{ email: string; liberado: boolean }>(
      `SELECT email, liberado FROM acessos_equipe`,
    );
    return new Map(rows.map((r) => [r.email.toLowerCase(), { liberado: r.liberado }]));
  } catch (err) {
    console.error("erro lendo acessos_equipe", err);
    return new Map();
  }
}

export default async function AdminLiberarPage() {
  await requireAdmin();

  const roster = await getTtarsRoster();
  const acessos = await getAccessControls();

  const pessoas = roster.map((p) => ({
    ...p,
    email: p.email.toLowerCase(),
    liberado: acessos.get(p.email.toLowerCase())?.liberado ?? false,
  }));

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Liberar acesso ao Ações</h1>

      <LiberarList pessoas={pessoas} />
    </div>
  );
}
