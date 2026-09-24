import "server-only";
import { sendToUser } from "./whatsapp/channel";

/** Short operational notice to the user's own linked WhatsApp (if any). Never throws. */
export async function sendWhatsApp(userId: string, text: string): Promise<void> {
  try {
    await sendToUser(userId, text);
  } catch {
    console.warn("[whatsapp] aviso não enviado");
  }
}
