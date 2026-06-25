"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

// Quando há speakers sem nome e o resumo já existe, tenta rotulá-los pela
// conversa (1x por sessão). A IA preenche pelo menos o Vitor (dono); o resto
// fica como sugestão pra confirmar. Roda em background, sem bloquear a página.
export function AutoLabelByContent({
  meetingId,
  enabled,
}: {
  meetingId: string;
  enabled: boolean;
}) {
  const router = useRouter();
  const ran = useRef(false);

  useEffect(() => {
    if (!enabled || ran.current) return;
    const key = `label-by-content:${meetingId}`;
    if (typeof sessionStorage !== "undefined" && sessionStorage.getItem(key)) return;
    ran.current = true;
    if (typeof sessionStorage !== "undefined") sessionStorage.setItem(key, "1");

    fetch(`/api/meetings/${meetingId}/label-by-content`, { method: "POST" })
      .then((r) => r.json())
      .then((d) => {
        if (d?.applied && Object.keys(d.applied).length > 0) router.refresh();
      })
      .catch(() => {});
  }, [enabled, meetingId, router]);

  return null;
}
