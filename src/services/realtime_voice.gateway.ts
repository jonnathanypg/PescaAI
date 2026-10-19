import { Server as HttpServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import { WhisperService } from './whisper.service';
import { KokoroTtsService } from './kokoro.service';
import { PesajeProcessor } from './pesaje.processor';
import { LemGuardianService } from './lem.service';
import { ConfirmationMode, LlmBrainService } from './llm.service';
import { config } from '../config';

interface ClientSession {
  id: string;
  ws: WebSocket;
  audioChunks: Buffer[];
  audioBytes: number;
  role: string;
  voice: string;
  filename: string;
  confirmationMode: ConfirmationMode;
  turnCount: number;
  connectedAt: number;
  /** Cola secuencial para que los comandos de una misma sesión nunca se intercalen. */
  chain: Promise<void>;
}

/**
 * Gateway WebSocket de Voz en Tiempo Real (<5ms overhead) preparado para operación continua 24/7
 * - Si el navegador ya envió `browserTranscript` claro para un pesaje directo, omite esperar la red STT (0ms STT!)
 * - Soporta modos de confirmación ('normal', 'short', 'beep'): en modo 'beep', si el pesaje es válido,
 *   no sintetiza TTS y devuelve la respuesta en <15ms para que suene solo el pitido instantáneo.
 */
export class RealtimeVoiceGateway {
  private static wss: WebSocketServer | null = null;

  static attach(server: HttpServer) {
    this.wss = new WebSocketServer({ server, path: '/ws/voice' });

    this.wss.on('connection', (ws: WebSocket) => {
      const session: ClientSession = {
        id: `call_${uuidv4().slice(0, 8)}`,
        ws,
        audioChunks: [],
        audioBytes: 0,
        role: 'supervisor',
        voice: config.tts.defaultVoice,
        filename: 'realtime.webm',
        confirmationMode: 'normal',
        turnCount: 0,
        connectedAt: Date.now(),
        chain: Promise.resolve(),
      };

      this.sendJson(ws, {
        type: 'SESSION_READY',
        sessionId: session.id,
        voice: session.voice,
        confirmationMode: session.confirmationMode,
        lemSilicon: LemGuardianService.getSiliconStatus(),
        timestamp: Date.now(),
      });

      ws.on('message', async (data: Buffer | string, isBinary: boolean) => {
        try {
          if (isBinary) {
            const chunk = Buffer.isBuffer(data) ? data : Buffer.from(data as any);
            // Se conserva el audio de forma íntegra (sin descartes silenciosos) con un tope de
            // seguridad muy holgado para evitar agotar memoria ante un cliente defectuoso.
            const MAX_CHUNKS = 12000;
            const MAX_BYTES = 48 * 1024 * 1024;
            if (session.audioChunks.length < MAX_CHUNKS && session.audioBytes + chunk.length <= MAX_BYTES) {
              session.audioChunks.push(chunk);
              session.audioBytes += chunk.length;
            } else {
              console.warn(
                `[Voz] Tope de seguridad de audio alcanzado en ${session.id} (${session.audioBytes} bytes).`
              );
            }
            return;
          }

          const msgStr = data.toString();
          const msg = JSON.parse(msgStr);

          if (msg.type === 'CONFIG') {
            if (msg.role) session.role = msg.role;
            if (msg.voice) session.voice = msg.voice;
            if (msg.filename) session.filename = msg.filename;
            if (msg.sessionId) session.id = msg.sessionId;
            if (msg.confirmationMode) {
              session.confirmationMode = msg.confirmationMode;
              LlmBrainService.setConfirmationMode(session.id, msg.confirmationMode);
              this.sendJson(ws, {
                type: 'MODE_UPDATED',
                confirmationMode: session.confirmationMode,
              });
            }
            return;
          }

          if (msg.type === 'START_AUDIO') {
            session.audioChunks = [];
            session.audioBytes = 0;
            if (msg.filename) session.filename = msg.filename;
            this.sendJson(ws, { type: 'ORB_STATE', state: 'listening' });
            return;
          }

          if (msg.type === 'END_AUDIO') {
            const fullAudio = Buffer.concat(session.audioChunks);
            session.audioChunks = [];
            session.audioBytes = 0;
            if (msg.confirmationMode) {
              session.confirmationMode = msg.confirmationMode;
            }
            this.enqueue(session, () =>
              this.handleAudioSubmission(session, fullAudio, msg.browserTranscript)
            );
            return;
          }

          if (msg.type === 'TEXT_COMMAND') {
            if (msg.confirmationMode) {
              session.confirmationMode = msg.confirmationMode;
            }
            this.enqueue(session, () =>
              this.handleTextCommand(session, msg.text || '', msg.includeTts !== false)
            );
            return;
          }

          if (msg.type === 'GREET') {
            this.enqueue(session, () => this.handleGreeting(session));
            return;
          }

          if (msg.type === 'PING') {
            this.sendJson(ws, {
              type: 'PONG',
              timestamp: Date.now(),
              uptimeSec: Math.round((Date.now() - session.connectedAt) / 1000),
              turns: session.turnCount,
            });
          }
        } catch (err: any) {
          session.audioChunks = [];
          session.audioBytes = 0;
          this.sendJson(ws, {
            type: 'ERROR',
            error: err.message || 'Error en comunicación de voz',
          });
        }
      });

      ws.on('close', () => {
        session.audioChunks = [];
        session.audioBytes = 0;
      });
    });

    console.log(`⚡ [WebSocket Voz Planta 24/7] Activo en ws://localhost:${config.port}/ws/voice`);
  }

  /**
   * Serializa el procesamiento de una sesión: los comandos se ejecutan en orden estricto,
   * uno tras otro, evitando que dos dictados simultáneos se pisen (sin perder ninguno).
   */
  private static enqueue(session: ClientSession, task: () => Promise<void>): void {
    session.chain = session.chain.then(task).catch((err: any) => {
      console.warn(`[Voz] Error en cola de ${session.id}: ${err?.message || err}`);
      this.sendJson(session.ws, { type: 'ERROR', error: err?.message || 'Error procesando el turno' });
    });
  }

  /**
   * Saludo inicial proactivo al iniciar una llamada manos libres, con voz natural.
   */
  private static async handleGreeting(session: ClientSession): Promise<void> {
    const greeting =
      'Hola, soy Pesca AI, tu asistente de planta. Estoy listo para registrar pesajes, revisar calidad o darte el balance de producción. ¿En qué te ayudo?';

    let ttsBase64: string | null = null;
    let ttsLatencyMs = 0;
    let ttsCached = false;

    try {
      const tts = await KokoroTtsService.synthesize(greeting, session.voice);
      ttsBase64 = tts.audioBuffer.toString('base64');
      ttsLatencyMs = tts.latencyMs;
      ttsCached = tts.cached;
    } catch (err: any) {
      console.warn(`[Voz] Saludo sin TTS: ${err.message}`);
    }

    this.sendJson(session.ws, {
      type: 'AGENT_RESULT',
      transcription: '',
      turn: session.turnCount,
      success: true,
      action: 'CONVERSACION_COPILOTO',
      agentUsed: 'SupervisorCopilotAgent',
      intent: 'GREETING',
      toolCalled: 'greeting',
      audioFeedback: greeting,
      confirmationMode: session.confirmationMode,
      tts: ttsBase64
        ? {
            audioBase64: ttsBase64,
            contentType: 'audio/mpeg',
            voice: session.voice,
            cached: ttsCached,
            latencyMs: ttsLatencyMs,
          }
        : null,
      totalPipelineMs: ttsLatencyMs,
    });
  }

  private static async handleAudioSubmission(
    session: ClientSession,
    audioBuffer: Buffer,
    browserTranscript?: string
  ) {
    const t0 = Date.now();
    this.sendJson(session.ws, {
      type: 'ORB_STATE',
      state: 'thinking',
      stage: 'Procesando voz...',
    });

    let transcription = '';

    // Ultra-Fast Path: Si el reconocimiento nativo del navegador ya capturó un comando claro con números/kilos,
    // lo usamos de inmediato en 0ms sin esperar la subida de audio por red.
    const cleanBrowser = (browserTranscript || '').trim();
    const browserHasClearCommand =
      cleanBrowser.length >= 4 &&
      (/\d/.test(cleanBrowser) ||
        /kilo|lomo|sangacho|operaria|mesa|peso|pesó|corrige|confirmado|pitido|silencioso|hola|resumen|parada|autoclave/i.test(
          cleanBrowser
        ));

    if (browserHasClearCommand) {
      transcription = WhisperService.applyIndustrialPhoneticCorrection(cleanBrowser);
      console.log(`[Voz Instantánea 0ms] -> "${transcription}"`);
    } else if (audioBuffer && audioBuffer.length > 400) {
      try {
        transcription = await WhisperService.transcribeAudio(audioBuffer, session.filename);
      } catch (err: any) {
        console.warn(`[Voz] Advertencia STT: ${err.message}`);
      }
    }

    if ((!transcription || transcription.trim().length < 2) && cleanBrowser.length >= 2) {
      transcription = WhisperService.applyIndustrialPhoneticCorrection(cleanBrowser);
    }

    if (!transcription || transcription.trim().length < 2) {
      this.sendJson(session.ws, {
        type: 'NO_SPEECH_DETECTED',
        sttLatencyMs: Date.now() - t0,
      });
      return;
    }

    session.turnCount++;
    this.sendJson(session.ws, {
      type: 'TRANSCRIPTION_READY',
      text: transcription,
      sttLatencyMs: Date.now() - t0,
      turn: session.turnCount,
    });

    await this.handleTextCommand(session, transcription, true, t0);
  }

  private static async handleTextCommand(
    session: ClientSession,
    text: string,
    includeTts: boolean = true,
    pipelineStartMs?: number
  ) {
    const start = pipelineStartMs || Date.now();
    this.sendJson(session.ws, {
      type: 'ORB_STATE',
      state: 'thinking',
      stage: 'Validando registro...',
    });

    const result = await PesajeProcessor.processVoiceTranscription(
      text,
      session.role,
      session.id,
      session.confirmationMode
    );

    if (result.confirmationMode) {
      session.confirmationMode = result.confirmationMode;
    }

    let ttsBase64: string | null = null;
    let ttsLatencyMs = 0;
    let ttsCached = false;

    // Si estamos en modo 'beep' (Solo Pitido) y el registro fue exitoso (skipTtsSpeech === true),
    // NO generamos audio TTS para que la respuesta regrese en <15ms y solo suene el pitido en planta.
    const shouldSpeak = includeTts && !result.skipTtsSpeech && Boolean(result.audioFeedback);

    if (shouldSpeak) {
      try {
        // Si está en caché RAM/Disco regresa en <2ms; si es frase nueva de red, esperamos hasta 8500ms
        const synthPromise = KokoroTtsService.synthesize(result.audioFeedback, session.voice);
        const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), 8500));
        const ttsRes = await Promise.race([synthPromise, timeoutPromise]);
        if (ttsRes) {
          ttsBase64 = ttsRes.audioBuffer.toString('base64');
          ttsLatencyMs = ttsRes.latencyMs;
          ttsCached = ttsRes.cached;
        } else {
          // Si el servicio de red demoró demasiado, no pisamos el texto real para que el cliente lo sintetice vía Web Speech o reproduzca locución corta coherente
          if (
            result.action === 'PESAJE_REGISTRADO' ||
            result.action === 'PESAJE_CORREGIDO' ||
            result.action === 'HACCP_REGISTRADO'
          ) {
            const fastTts = await KokoroTtsService.synthesize('Registro confirmado.', session.voice);
            ttsBase64 = fastTts.audioBuffer.toString('base64');
            ttsLatencyMs = fastTts.latencyMs;
            ttsCached = true;
          } else if (!result.success) {
            const fastTts = await KokoroTtsService.synthesize('Alerta: verifique peso. Excede el límite de bandeja.', session.voice);
            ttsBase64 = fastTts.audioBuffer.toString('base64');
            ttsLatencyMs = fastTts.latencyMs;
            ttsCached = true;
          }
        }
      } catch (err: any) {
        console.warn(`[Voz] Advertencia síntesis: ${err.message}`);
      }
    }

    this.sendJson(session.ws, {
      type: 'AGENT_RESULT',
      transcription: text,
      turn: session.turnCount,
      ...result,
      tts: ttsBase64
        ? {
            audioBase64: ttsBase64,
            contentType: 'audio/mpeg',
            voice: session.voice,
            cached: ttsCached,
            latencyMs: ttsLatencyMs,
          }
        : null,
      totalPipelineMs: Date.now() - start,
    });
  }

  private static sendJson(ws: WebSocket, payload: any) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
    }
  }
}
