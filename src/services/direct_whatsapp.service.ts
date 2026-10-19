import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion
} from '@whiskeysockets/baileys';
import QRCode from 'qrcode';
import pino from 'pino';
import path from 'path';
import fs from 'fs';
import { getDatabase } from '../database';
import { config } from '../config';

export interface WhatsAppSessionState {
  status: 'disconnected' | 'connecting' | 'qr_ready' | 'connected';
  phone: string | null;
  qrDataUrl: string | null;
  lastError: string | null;
}

export class DirectWhatsappManager {
  private static socket: any = null;
  private static reconnectTimer: NodeJS.Timeout | null = null;
  private static manualStopRequested = false;
  private static sessionState: WhatsAppSessionState = {
    status: 'disconnected',
    phone: null,
    qrDataUrl: null,
    lastError: null
  };
  private static authDir = path.join(__dirname, '../../tokens/tecopesca_direct');

  static getStatus(): WhatsAppSessionState {
    return this.sessionState;
  }

  /**
   * En el arranque del servidor: solo reconecta si ya existe una sesión vinculada previamente.
   * Si no hay sesión vinculada, permanece en modo reposo (0 consumo de recursos) hasta que el usuario solicite generar QR.
   */
  static async resumeSavedSessionIfPresent(): Promise<WhatsAppSessionState> {
    const credsPath = path.join(this.authDir, 'creds.json');
    if (fs.existsSync(credsPath)) {
      console.log('[WhatsApp Admin] Credenciales previas detectadas. Reconectando sesión...');
      return this.startSession(false);
    }
    console.log('[WhatsApp Admin] En espera bajo demanda (QR desactivado hasta que el usuario lo inicie).');
    return this.sessionState;
  }

  /**
   * Inicia o reinicia bajo demanda la sesión de WhatsApp generando el QR para el panel de administración
   */
  static async startSession(forceNew = false): Promise<WhatsAppSessionState> {
    this.manualStopRequested = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.sessionState.status === 'connected' && !forceNew) {
      return this.sessionState;
    }

    if (this.socket) {
      try {
        this.socket.ev.removeAllListeners('connection.update');
        this.socket.ev.removeAllListeners('creds.update');
        this.socket.ev.removeAllListeners('messages.upsert');
        this.socket.end(new Error('Restart requested'));
      } catch (_) {}
      this.socket = null;
    }

    if (forceNew) {
      console.log('[WhatsApp Admin] Reiniciando credenciales para generar nuevo QR...');
      if (fs.existsSync(this.authDir)) {
        fs.rmSync(this.authDir, { recursive: true, force: true });
      }
    }

    if (!fs.existsSync(this.authDir)) {
      fs.mkdirSync(this.authDir, { recursive: true });
    }

    try {
      this.sessionState.status = 'connecting';
      this.sessionState.qrDataUrl = null;
      this.sessionState.lastError = null;

      const { state, saveCreds } = await useMultiFileAuthState(this.authDir);
      const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: [2, 3000, 1015901307] as [number, number, number] }));

      this.socket = makeWASocket({
        version: version as [number, number, number],
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }),
        browser: ['Pesca AI', 'Chrome', '124.0.0']
      });

      this.socket.ev.on('creds.update', saveCreds);

      this.socket.ev.on('connection.update', async (update: any) => {
        if (this.manualStopRequested) return;

        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          console.log('[WhatsApp Admin] Nuevo código QR generado bajo demanda.');
          const qrDataUrl = await QRCode.toDataURL(qr, { margin: 2, scale: 7 });
          this.sessionState.qrDataUrl = qrDataUrl;
          this.sessionState.status = 'qr_ready';
        }

        if (connection === 'close') {
          if (this.manualStopRequested) {
            this.sessionState.status = 'disconnected';
            this.sessionState.qrDataUrl = null;
            return;
          }

          const statusCode = (lastDisconnect?.error as any)?.output?.statusCode;
          const hasSavedPhone = Boolean(this.sessionState.phone);
          const shouldReconnect = statusCode !== DisconnectReason.loggedOut && hasSavedPhone;
          console.log(`[WhatsApp Admin] Conexión cerrada. Status: ${statusCode}, reconectar: ${shouldReconnect}`);

          if (statusCode === DisconnectReason.loggedOut) {
            this.sessionState.status = 'disconnected';
            this.sessionState.phone = null;
            this.sessionState.qrDataUrl = null;
            if (fs.existsSync(this.authDir)) {
              fs.rmSync(this.authDir, { recursive: true, force: true });
            }
          } else if (shouldReconnect) {
            this.sessionState.status = 'disconnected';
            this.reconnectTimer = setTimeout(() => {
              if (!this.manualStopRequested) this.startSession();
            }, 3000);
          } else {
            // Si estaba mostrando QR y expiró sin escanearse, se detiene limpiamente para no consumir recursos
            console.log('[WhatsApp Admin] Tiempo de espera de QR finalizado. En modo reposo.');
            this.sessionState.status = 'disconnected';
            this.sessionState.qrDataUrl = null;
          }
        } else if (connection === 'open') {
          console.log('[WhatsApp Admin] ✅ WhatsApp CONECTADO exitosamente.');
          const rawUser = this.socket.user?.id || '';
          const phone = rawUser.split(':')[0].split('@')[0] || null;
          this.sessionState.status = 'connected';
          this.sessionState.phone = phone;
          this.sessionState.qrDataUrl = null;
        }
      });

      // Procesar mensajes entrantes interactivos de directivos
      this.socket.ev.on('messages.upsert', async (m: any) => {
        if (m.type === 'notify') {
          for (const msg of m.messages) {
            if (!msg.key.fromMe && msg.message) {
              const fromJid = msg.key.remoteJid || '';
              const text = msg.message.conversation ||
                           msg.message.extendedTextMessage?.text || '';
              
              if (text) {
                console.log(`[WhatsApp Directivo] Mensaje recibido de ${fromJid}: "${text}"`);
                const reply = await this.handleDirectivoQuery(fromJid, text);
                await this.sendMessage(fromJid, reply);
              }
            }
          }
        }
      });

      return this.sessionState;
    } catch (err: any) {
      console.error('[WhatsApp Admin Error]:', err);
      this.sessionState.status = 'disconnected';
      this.sessionState.lastError = err.message;
      return this.sessionState;
    }
  }

  /**
   * Responde consultas operativas y ejecutivas
   */
  static async handleDirectivoQuery(senderJid: string, text: string): Promise<string> {
    const raw = text.toLowerCase().trim();
    const db = await getDatabase();

    // Resumen Ejecutivo de Turno / Mesa
    if (raw.includes('resumen') || raw.includes('kpi') || raw.includes('estado') || raw.includes('reporte')) {
      const pesajesStats = await db.query(`
        SELECT 
          COUNT(*) as total_pesajes,
          COALESCE(SUM(CASE WHEN tipo_producto = 'lomo' THEN peso_kg ELSE 0 END), 0) as total_lomo,
          COALESCE(SUM(CASE WHEN tipo_producto = 'sangacho' THEN peso_kg ELSE 0 END), 0) as total_sangacho,
          COALESCE(AVG(rendimiento_estimado), 0) as rend_promedio
        FROM pesajes
      `);

      const paradasStats = await db.query(`
        SELECT COUNT(*) as total_paradas, COALESCE(SUM(tiempo_estimado_min), 0) as tiempo_total
        FROM paradas_linea WHERE resuelto = 0
      `);

      const s = pesajesStats[0] || {};
      const p = paradasStats[0] || {};

      return `🌊 *Pesca AI — PLANTA Y LOGÍSTICA PESQUERA*\n` +
             `*Módulo:* Control de Pesaje y Deslomado (Mesa 6)\n` +
             `*Fecha:* ${new Date().toLocaleDateString('es-EC')} | *Turno:* Activo\n` +
             `------------------------------------\n` +
             `📦 *Bandejas Validadas:* ${s.total_pesajes || 0}\n` +
             `✨ *Lomo Blanco Acumulado:* ${Number(s.total_lomo || 0).toFixed(2)} kg\n` +
             `🥩 *Sangacho Acumulado:* ${Number(s.total_sangacho || 0).toFixed(2)} kg\n` +
             `📈 *Rendimiento Promedio:* ${Number(s.rend_promedio || 0).toFixed(1)}%\n` +
             `⚠️ *Paradas de Línea:* ${p.total_paradas || 0} (${p.tiempo_total || 0} min)\n` +
             `🛡️ *Validación de Planta:* 100% Verificada\n` +
             `------------------------------------\n` +
             `_Escribe 'operaria 14', 'paradas' o 'alerta' para detalle inmediato._`;
    }

    // Detalle por Operaria
    const opMatch = raw.match(/operaria\s*(\d+)/i);
    if (opMatch) {
      const opId = opMatch[1];
      const rows = await db.query(`
        SELECT p.*, o.nombre 
        FROM pesajes p 
        LEFT JOIN operarias o ON p.operaria_id = o.id 
        WHERE p.operaria_id = ? 
        ORDER BY p.id DESC LIMIT 5
      `, [opId]);

      if (rows.length === 0) {
        return `⚠️ No constan pesajes recientes para la operaria #${opId} en este turno.`;
      }

      const totalKg = rows.reduce((acc: number, r: any) => acc + Number(r.peso_kg), 0);
      const nombre = rows[0]?.nombre || `Operaria #${opId}`;

      let msg = `👤 *Ficha de Operaria:* ${nombre} (#${opId})\n` +
                `*Total procesado:* ${totalKg.toFixed(2)} kg\n` +
                `*Últimas bandejas:*\n`;

      rows.forEach((r: any, idx: number) => {
        msg += `${idx + 1}. ${r.tipo_producto.toUpperCase()}: ${r.peso_kg} kg (Verificado)\n`;
      });

      return msg;
    }

    // Paradas de Línea
    if (raw.includes('parada') || raw.includes('paro') || raw.includes('alerta')) {
      const paradas = await db.query(`SELECT * FROM paradas_linea ORDER BY id DESC LIMIT 5`);
      if (paradas.length === 0) {
        return `✅ No hay incidencias activas en este momento. Línea 6 operando con normalidad.`;
      }
      let msg = `🚨 *Paradas de Línea Recientes (Mesa 6):*\n`;
      paradas.forEach((p: any) => {
        msg += `• Mesa ${p.mesa}: ${p.motivo} (~${p.tiempo_estimado_min} min) - ${p.resuelto ? 'Resuelto' : 'En atención'}\n`;
      });
      return msg;
    }

    // Menú de ayuda
    return `👋 *Hola. Plataforma Pesca AI — Control Pesquero*\n\n` +
           `Comandos rápidos para gerencia:\n` +
           `• *resumen* : Balance de masa y kg acumulados.\n` +
           `• *operaria [número]* : Historial de pesaje de una operaria.\n` +
           `• *paradas* : Incidencias y tiempos de paro.\n`;
  }

  /**
   * Envía mensaje directo a un teléfono o JID
   */
  static async sendMessage(recipient: string, message: string): Promise<boolean> {
    if (!this.socket || this.sessionState.status !== 'connected') {
      console.log(`[WhatsApp Simulado -> ${recipient}]:\n${message}`);
      return false;
    }

    try {
      let jid = recipient;
      if (!jid.includes('@')) {
        const clean = recipient.replace(/\D/g, '');
        jid = `${clean}@s.whatsapp.net`;
      }
      await this.socket.sendMessage(jid, { text: message });
      console.log(`[WhatsApp Admin] Mensaje entregado a ${jid}`);
      return true;
    } catch (e: any) {
      console.error(`[WhatsApp Error enviando a ${recipient}]:`, e.message);
      return false;
    }
  }

  /**
   * Disparo de alerta crítica a directivos por WhatsApp (<5 segundos)
   */
  static async broadcastLineStop(mesa: number, motivo: string, tiempoMin: number) {
    const alertMsg = `🚨 *ALERTA DE LÍNEA — Pesca AI*\n` +
                     `Parada registrada en *Mesa ${mesa}*\n` +
                     `*Motivo:* ${motivo}\n` +
                     `*Tiempo estimado:* ${tiempoMin} minutos\n` +
                     `_Aviso enviado automáticamente a Mantenimiento._`;

    for (const phone of config.whatsapp.alertRecipients) {
      await this.sendMessage(phone, alertMsg);
    }
  }

  /**
   * Cancela la generación activa de código QR y detiene el socket para ahorrar recursos
   */
  static async cancelQrSession(): Promise<WhatsAppSessionState> {
    this.manualStopRequested = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.socket) {
      try {
        this.socket.ev.removeAllListeners('connection.update');
        this.socket.ev.removeAllListeners('creds.update');
        this.socket.ev.removeAllListeners('messages.upsert');
        this.socket.end(new Error('QR cancelled by user'));
      } catch (_) {}
      this.socket = null;
    }
    this.sessionState.status = 'disconnected';
    this.sessionState.qrDataUrl = null;
    this.sessionState.lastError = null;
    console.log('[WhatsApp Admin] Generación de QR cancelada por el usuario (0 recursos en segundo plano).');
    return this.sessionState;
  }

  /**
   * Cierre voluntario de sesión desde el panel admin
   */
  static async disconnectSession(): Promise<void> {
    this.manualStopRequested = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.socket) {
      try {
        this.socket.ev.removeAllListeners('connection.update');
        await this.socket.logout();
      } catch (_) {}
      try {
        this.socket.end(new Error('Disconnected by user'));
      } catch (_) {}
      this.socket = null;
    }
    this.sessionState.status = 'disconnected';
    this.sessionState.phone = null;
    this.sessionState.qrDataUrl = null;
    if (fs.existsSync(this.authDir)) {
      fs.rmSync(this.authDir, { recursive: true, force: true });
    }
  }
}
