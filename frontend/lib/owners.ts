import { withTenant } from "./db";

export type OwnerInfo = { name: string; is_me: boolean; frequency: number };

export const ownersFor = (userId: string) => ({
  list: () =>
    withTenant(userId, async (db) => {
      const r = await db.query<{ name: string; frequency: number }>(
        `SELECT TRIM(owner) AS name, COUNT(*)::int AS frequency
           FROM tarefas
          WHERE owner IS NOT NULL AND TRIM(owner) <> '' AND owner <> '?'
          GROUP BY TRIM(owner)
          ORDER BY frequency DESC, name ASC
          LIMIT 30`,
      );
      const owners: OwnerInfo[] = r.rows.map((o) => ({
        name: o.name,
        is_me: o.name.toLowerCase() === "vitor",
        frequency: o.frequency,
      }));
      // garante "vitor" presente e no topo
      if (!owners.some((o) => o.is_me)) owners.unshift({ name: "vitor", is_me: true, frequency: 0 });
      owners.sort((a, b) => Number(b.is_me) - Number(a.is_me) || b.frequency - a.frequency);
      return owners;
    }),
});
