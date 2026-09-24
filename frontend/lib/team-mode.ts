// lib/team-mode.ts
// Utilities para modo equipe (TEAM_MODE)

export const isTeamMode = () => {
  return process.env.TEAM_MODE === "1" || process.env.TEAM_MODE === "true";
};

export const getOwnerSlug = () => {
  return process.env.OWNER_SLUG ?? "vitor";
};
