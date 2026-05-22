"use server";

import { requireUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { redirect } from "next/navigation";

export async function aceitarTermos() {
  const user = await requireUser();
  await query(
    `UPDATE users SET consent_terms_at = now()
     WHERE id = $1 AND consent_terms_at IS NULL`,
    [user.id],
  );
  redirect("/");
}
