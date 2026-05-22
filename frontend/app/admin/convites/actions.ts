"use server";

import { requireAdmin } from "@/lib/auth";
import { query } from "@/lib/db";
import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";

export async function criarConvite(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const nome = formData.get("nome")?.toString().trim();
  if (!nome || nome.length < 2) return;
  if (nome.length > 80) return;

  // 128 bits de entropia (16 bytes → 22 chars base64url)
  const code = randomBytes(16).toString("base64url");

  await query(
    `INSERT INTO invites (code, nome_sugerido, created_by)
     VALUES ($1, $2, $3)`,
    [code, nome, admin.id],
  );
  await query(
    `INSERT INTO audit_log (user_id, action, target_id, metadata)
     VALUES ($1, 'invite.create', $2, $3)`,
    [admin.id, code, JSON.stringify({ nome_sugerido: nome })],
  );
  revalidatePath("/admin/convites");
}

export async function revogarConvite(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const code = formData.get("code")?.toString();
  if (!code) return;

  await query(
    `UPDATE invites SET revoked_at = now()
     WHERE code = $1 AND revoked_at IS NULL AND consumed_at IS NULL`,
    [code],
  );
  await query(
    `INSERT INTO audit_log (user_id, action, target_id)
     VALUES ($1, 'invite.revoke', $2)`,
    [admin.id, code],
  );
  revalidatePath("/admin/convites");
}
