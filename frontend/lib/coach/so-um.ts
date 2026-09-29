// O Coach é de uma pessoa só (Vitor, 29/09/2026: "não quero que nenhuma outra pessoa tenha o coach").
// No Ações da equipe só a conta em COACH_SO_USER_ID tem Coach; sem a variável, ninguém tem. Quem troca a conta
// é quem mexe no servidor, nunca uma tela. Fora da equipe (Ações pessoal) nada muda.
import { isTeamMode } from "../team-mode";

export function coachPermitido(userId: string | null | undefined): boolean {
 if (!isTeamMode()) return true;
 const unico = (process.env.COACH_SO_USER_ID || "").trim();
 return !!unico && userId === unico;
}
