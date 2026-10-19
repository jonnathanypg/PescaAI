import axios from 'axios';
import { config } from '../config';

export type ConfirmationMode = 'normal' | 'short' | 'beep';

export interface LlmIntentDecision {
  intent:
    | 'RECORD_WEIGHING'
    | 'CORRECT_LAST_WEIGHING'
    | 'RECORD_HACCP'
    | 'RECORD_LINE_STOP'
    | 'QUERY_PRODUCTION'
    | 'SET_CONFIRMATION_MODE'
    | 'CONVERSATIONAL_SUPERVISOR';
  mesa?: number;
  operariaId?: string;
  tipoProducto?: 'lomo' | 'sangacho' | 'trozos';
  pesoKg?: number;
  parametroHaccp?: 'TEMPERATURA_AUTOCLAVE' | 'TEMPERATURA_ESPINA' | 'HISTAMINA' | 'ORGANOLEPTICO';
  valorHaccp?: number;
  unidadHaccp?: string;
  loteCuba?: string;
  motivoParada?: string;
  tiempoParadaMin?: number;
  tipoConsulta?: string;
  confirmationMode?: ConfirmationMode;
  spokenResponse: string;
}

interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

/**
 * Motor Cognitivo Conversacional de Ultra-Baja Latencia
 * - Si el dictado es un pesaje directo, control de calidad o parada de línea, NO se invoca el LLM (0ms de razonamiento).
 * - Solo se invoca cuando el supervisor hace una pregunta, saludo u observación, respondiendo en MÁXIMO 12 PALABRAS
 *   y cerrando siempre con "Listo para el siguiente registro."
 */
export class LlmBrainService {
  private static sessionHistories: Map<string, ConversationMessage[]> = new Map();
  private static sessionModes: Map<string, ConfirmationMode> = new Map();
  private static readonly MAX_HISTORY_TURNS = 8;
  private static readonly MAX_SESSIONS = 300;

  /** Evita fugas de memoria liberando las sesiones más antiguas cuando se supera el tope. */
  private static evictSessionsIfNeeded() {
    while (this.sessionHistories.size > this.MAX_SESSIONS) {
      const oldest = this.sessionHistories.keys().next().value;
      if (oldest === undefined) break;
      this.sessionHistories.delete(oldest);
      this.sessionModes.delete(oldest);
    }
  }

  static getConfirmationMode(sessionId: string): ConfirmationMode {
    return this.sessionModes.get(sessionId) || 'normal';
  }

  static setConfirmationMode(sessionId: string, mode: ConfirmationMode) {
    this.sessionModes.set(sessionId, mode);
    this.evictSessionsIfNeeded();
  }

  static appendHistory(sessionId: string, role: 'user' | 'assistant', content: string) {
    if (!content) return;
    let history = this.sessionHistories.get(sessionId);
    if (!history) {
      history = [];
      this.sessionHistories.set(sessionId, history);
    }
    history.push({ role, content, timestamp: Date.now() });
    if (history.length > this.MAX_HISTORY_TURNS * 2) {
      history.splice(0, history.length - this.MAX_HISTORY_TURNS * 2);
    }
    this.evictSessionsIfNeeded();
  }

  static getRecentHistoryText(sessionId: string): string {
    const history = this.sessionHistories.get(sessionId) || [];
    if (history.length === 0) return 'Sin turnos previos.';
    return history
      .slice(-6)
      .map((m) => `${m.role === 'user' ? 'Supervisor' : 'Asistente'}: ${m.content}`)
      .join('\n');
  }

  static async analyzeSupervisorUtterance(
    utterance: string,
    livePlantContext: {
      totalBandejas: number;
      totalLomoKg: number;
      totalSangachoKg: number;
      rendimientoPromedio: number;
      lastPesaje?: {
        id: number;
        uuid: string;
        mesa: number;
        operaria_id: string;
        operaria_nombre?: string;
        tipo_producto: string;
        peso_kg: number;
      } | null;
      operariasActivas: string;
    },
    sessionId: string = 'planta_mesa_6'
  ): Promise<LlmIntentDecision> {
    const cleanWord = utterance
      .trim()
      .toLowerCase()
      .replace(/[.,¡!¿?;"'()]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    // Fast-path instantáneo (0ms LLM + 0ms TTS cacheado) para saludos cortos o pruebas de micrófono en planta
    if (
      cleanWord === 'hola' ||
      cleanWord === 'hola hola' ||
      cleanWord === 'hola que tal' ||
      cleanWord === 'hola qué tal' ||
      cleanWord === 'buenos dias' ||
      cleanWord === 'buenos días' ||
      cleanWord === 'buenas tardes' ||
      cleanWord === 'buenas' ||
      cleanWord === 'me escuchas' ||
      cleanWord === 'hola me escuchas' ||
      cleanWord === 'probando' ||
      cleanWord === 'aló' ||
      cleanWord === 'alo'
    ) {
      return {
        intent: 'CONVERSATIONAL_SUPERVISOR',
        spokenResponse:
          '¡Hola! Soy Pesca AI, tu asistente de planta. Puedo registrar pesajes, darte el balance de producción, revisar calidad o ayudarte a corregir un registro. ¿Qué necesitas?',
      };
    }

    const recentHistory = this.getRecentHistoryText(sessionId);
    const lastPesajeStr = livePlantContext.lastPesaje
      ? `Mesa ${livePlantContext.lastPesaje.mesa}, Operaria ${livePlantContext.lastPesaje.operaria_id}, ${livePlantContext.lastPesaje.tipo_producto} ${livePlantContext.lastPesaje.peso_kg} kg`
      : 'Ninguno';

    const systemPrompt = `Eres Pesca AI, la copiloto de voz de planta y operaciones de Tecopesca (Manta, Ecuador).
ESTILO DE CONVERSACIÓN:
- Hablas como un asistente humano cercano, cálido, profesional y natural; nunca como un robot ni con frases rígidas repetidas.
- Puedes saludar, conversar, dar información, analizar los datos en vivo, asesorar al supervisor o directivo, ayudar a corregir o anular registros y guiar paso a paso.
- Responde en 1 a 3 frases fluidas y útiles. No leas listas, ni tecnicismos, ni menciones modelos o detalles internos.
- Si falta un dato para registrar (mesa, operaria, producto o kilos), pídelo amablemente en la misma respuesta.
ACCIONES (usa el intent adecuado):
- Datos de pesaje dictados -> "RECORD_WEIGHING" con mesa, operariaId, tipoProducto, pesoKg.
- Corrección del último registro -> "CORRECT_LAST_WEIGHING" con pesoKg y tipoProducto.
- Calidad/HACCP/autoclave/temperatura/histamina -> "RECORD_HACCP".
- Parada de línea o falla -> "RECORD_LINE_STOP" con motivoParada y tiempoParadaMin.
- Pregunta de producción, rendimiento, kilos, balance o estado -> "QUERY_PRODUCTION" con tipoConsulta ("RESUMEN_GENERAL", "PARADAS_LINEA", "CALIDAD_HACCP" u "OPERARIA_<id>").
- Pedir "solo pitido" / "sin confirmación verbal" -> intent "SET_CONFIRMATION_MODE", confirmationMode "beep".
- Pedir "solo confirmado" / "modo corto" -> intent "SET_CONFIRMATION_MODE", confirmationMode "short".
- Pedir "modo completo" / "modo normal" -> intent "SET_CONFIRMATION_MODE", confirmationMode "normal".
- Cualquier saludo, charla o duda abierta -> "CONVERSATIONAL_SUPERVISOR".
Datos en vivo de Planta (Mesa 6): ${livePlantContext.totalBandejas} bandejas, Lomo ${livePlantContext.totalLomoKg.toFixed(1)} kg, Sangacho ${livePlantContext.totalSangachoKg.toFixed(1)} kg, Rendimiento ${livePlantContext.rendimientoPromedio.toFixed(1)}%. Último pesaje: ${lastPesajeStr}. Operarias activas: ${livePlantContext.operariasActivas}.
Historial:
${recentHistory}

Responde SOLO un objeto JSON válido:
{
  "intent": "RECORD_WEIGHING" | "CORRECT_LAST_WEIGHING" | "RECORD_HACCP" | "RECORD_LINE_STOP" | "QUERY_PRODUCTION" | "SET_CONFIRMATION_MODE" | "CONVERSATIONAL_SUPERVISOR",
  "mesa": 6,
  "operariaId": "14",
  "tipoProducto": "lomo" | "sangacho" | "trozos",
  "pesoKg": 0,
  "parametroHaccp": "TEMPERATURA_AUTOCLAVE" | "TEMPERATURA_ESPINA" | "HISTAMINA" | "ORGANOLEPTICO",
  "valorHaccp": 0,
  "unidadHaccp": "°C" | "ppm",
  "loteCuba": "CUBA-04",
  "motivoParada": "",
  "tiempoParadaMin": 0,
  "tipoConsulta": "RESUMEN_GENERAL",
  "confirmationMode": "normal" | "short" | "beep",
  "spokenResponse": "Respuesta natural, cálida y orientadora (1 a 3 frases)."
}`;

    const t0 = Date.now();

    // Carrera simultánea de Sub-Agentes Cognitivos:
    // 1. Groq LPU (qwen/qwen3.8-27b) -> ~250ms
    // 2. OpenAI (gpt-5-nano minimal reasoning) -> ~950ms
    // Gana el primero que entregue un JSON válido para lograr respuesta casi inmediata (<300ms).
    const callGroqFast = async (): Promise<LlmIntentDecision> => {
      if (!config.llm.groqApiKey) throw new Error('No Groq key');
      const groqRes = await axios.post(
        'https://api.groq.com/openai/v1/chat/completions',
        {
          model: 'qwen/qwen3.8-27b',
          response_format: { type: 'json_object' },
          temperature: 0.15,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: utterance },
          ],
          max_tokens: 220,
        },
        {
          headers: {
            Authorization: `Bearer ${config.llm.groqApiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: 2200,
        }
      );
      const content = groqRes.data?.choices?.[0]?.message?.content || '';
      const parsed = JSON.parse(content) as LlmIntentDecision;
      if (!parsed || !parsed.spokenResponse) throw new Error('Empty Groq JSON');
      console.log(`[Pesca AI • LPU Rápido] ⚡ (${Date.now() - t0}ms) Intent=${parsed.intent} -> "${parsed.spokenResponse}"`);
      return parsed;
    };

    const callOpenAiNano = async (): Promise<LlmIntentDecision> => {
      if (!config.llm.openaiApiKey) throw new Error('No OpenAI key');
      const response = await axios.post(
        'https://api.openai.com/v1/chat/completions',
        {
          model: config.llm.model || 'gpt-4o-mini',
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: utterance },
          ],
          max_tokens: 220,
          temperature: 0.2,
        },
        {
          headers: {
            Authorization: `Bearer ${config.llm.openaiApiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: 4500,
        }
      );
      const content = response.data?.choices?.[0]?.message?.content || '';
      const parsed = JSON.parse(content) as LlmIntentDecision;
      if (!parsed || !parsed.spokenResponse) throw new Error('Empty OpenAI JSON');
      console.log(`[Pesca AI • Copiloto Fast] ⚡ (${Date.now() - t0}ms) Intent=${parsed.intent} -> "${parsed.spokenResponse}"`);
      return parsed;
    };

    try {
      return await Promise.any([callGroqFast(), callOpenAiNano()]);
    } catch (_) {
      return {
        intent: 'CONVERSATIONAL_SUPERVISOR',
        spokenResponse: 'Estoy aquí para ayudarte. ¿Me repites lo que necesitas?',
      };
    }
  }
}
