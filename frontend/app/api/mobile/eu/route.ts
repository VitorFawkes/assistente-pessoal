import { withBearerAuth } from "@/lib/auth";

// App do iPhone: confere se o acesso do aparelho ainda vale (sem limite por rede, ao contrário da troca).
export const GET = withBearerAuth(async (user) =>
  Response.json({ user: { id: user.id, nome: user.nome, email: user.email, consent_terms_at: user.consent_terms_at } }),
);
