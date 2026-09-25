"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { syncN8nUsage } from "@/lib/ai-usage-n8n";

/** Reads now what n8n spent since the last reading (the cron also does it every 15 minutes). */
export async function atualizarGastos(): Promise<void> {
  await requireAdmin();
  await syncN8nUsage({ deadline: Date.now() + 45_000, maxExecutions: 10 }).catch((e) => console.error("ai usage n8n sync failed", e instanceof Error ? e.message : ""));
  revalidatePath("/admin/gastos");
}
