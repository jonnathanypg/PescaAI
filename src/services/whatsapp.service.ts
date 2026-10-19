import { DirectWhatsappManager } from './direct_whatsapp.service';
import { getDatabase } from '../database';
import { config } from '../config';

export class WhatsappMonitoringService {
  static async init() {
    // Solo reconecta si ya existe una sesión vinculada; de lo contrario permanece en reposo bajo demanda
    await DirectWhatsappManager.resumeSavedSessionIfPresent();
  }

  static async handleIncomingMessage(senderJid: string, text: string): Promise<string> {
    return DirectWhatsappManager.handleDirectivoQuery(senderJid, text);
  }

  static async sendNotification(recipientPhone: string, text: string) {
    return DirectWhatsappManager.sendMessage(recipientPhone, text);
  }

  static async alertLineStop(mesa: number, motivo: string, tiempoMin: number) {
    return DirectWhatsappManager.broadcastLineStop(mesa, motivo, tiempoMin);
  }
}
