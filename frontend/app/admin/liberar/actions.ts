"use server";

import { requireAdmin } from "@/lib/auth";
import { query } from "@/lib/db";

export async function toggleAcesso(
  email: string,
  liberado: boolean,
): Promise<{ success: boolean; error?: string }> {
  try {
    const admin = await requireAdmin();

    // Normalizar email
    const normalizedEmail = email.toLowerCase().trim();

    if (!normalizedEmail) {
      return { success: false, error: "Email inválido" };
    }

    // Atualizar ou inserir em acessos_equipe
    await query(
      `INSERT INTO acessos_equipe (email, liberado, alterado_por, alterado_em, criado_em)
       VALUES ($1, $2, $3, now(), now())
       ON CONFLICT (email) DO UPDATE
       SET liberado = $2, alterado_por = $3, alterado_em = now()`,
      [normalizedEmail, liberado, admin.id],
    );

    // Se foi removida a liberação, revogar todas as sessões dessa pessoa
    if (!liberado) {
      // Encontrar o user pelo email
      const userRows = await query<{ id: string }>(
        `SELECT id FROM users WHERE LOWER(email) = $1 AND deleted_at IS NULL`,
        [normalizedEmail],
      );

      if (userRows.length > 0) {
        const userId = userRows[0].id;
        // Revogar todas as sessões
        await query(
          `UPDATE sessions SET revoked_at = now()
           WHERE user_id = $1 AND revoked_at IS NULL`,
          [userId],
        );

        // Audit log
        await query(
          `INSERT INTO audit_log (user_id, action, metadata)
           VALUES ($1, 'access.revoked', $2)`,
          [admin.id, JSON.stringify({ target_email: normalizedEmail })],
        );
      }
    }

    return { success: true };
  } catch (err) {
    console.error("[toggleAcesso] erro", err);
    return { success: false, error: String(err) };
  }
}
