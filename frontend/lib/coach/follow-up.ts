import { createHash } from "node:crypto";
import type { CoachCommitment, CoachMemory, CoachMessage } from "./types";

/** A due date is a reason to ask, never proof that the person failed to deliver. */
export function commitmentsDueForFollowup(commitments: CoachCommitment[], now: Date): CoachCommitment[] {
  const instant = now.getTime();
  return commitments.filter(commitment => {
    if (!["open", "renegotiated"].includes(commitment.status) || !commitment.due_at) return false;
    const due = Date.parse(commitment.due_at);
    if (!Number.isFinite(due) || due > instant) return false;
    // Give a recent response room to be acted on before asking again.
    if (commitment.outcome && Date.parse(commitment.updated_at) > instant - 4 * 60 * 60 * 1000) return false;
    return true;
  }).sort((a, b) => Date.parse(a.due_at!) - Date.parse(b.due_at!) || a.id.localeCompare(b.id));
}

/** Only changes from the user/records invalidate this cache; generated text cannot trigger itself. */
export function accountabilityFingerprint(commitments: CoachCommitment[], memories: CoachMemory[], messages: CoachMessage[]): string {
  const byId = <T extends { id: string }>(items: T[]) => [...items].sort((a, b) => a.id.localeCompare(b.id));
  return createHash("sha256").update(JSON.stringify({
    commitments: byId(commitments).map(c => [c.id, c.title, c.status, c.outcome, c.outcome_source, c.due_at, c.updated_at, c.task_updated_at]),
    memories: byId(memories.filter(m => m.origin === "user" || m.status === "confirmed" || m.status === "rejected")).map(m => [m.id, m.content, m.status, m.lifecycle, m.updated_at]),
    replies: byId(messages.filter(m => m.role === "user" && !m.stale)).map(m => [m.id, m.content, m.created_at]),
  })).digest("hex");
}
