import axios from 'axios';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { config } from '../config';
import { LocalVoiceService } from './localVoice.service';

export interface TtsResult {
  audioBuffer: Buffer;
  contentType: string;
  voice: string;
  cached: boolean;
  latencyMs: number;
}

/**
 * Servicio de Síntesis de Voz Hiperrealista en Español Latino (`ef_dora` de MediaSuite)
 * - Incluye normalización fonética literal de números a palabras (idéntico al motor de Audiolibros de MediaSuite)
 *   para que el modelo ONNX de Kokoro pronuncie cada cifra con entonación humana cálida y nunca deletree ni suene robótico.
 * - Incluye caché L1 en RAM (<1ms) + L2 en disco (<3ms) con pre-calentamiento de locuciones operativas puntuales.
 */
export class KokoroTtsService {
  private static memoryCache: Map<string, Buffer> = new Map();
  private static cacheDir = path.join(__dirname, '../../tts_cache');
  /** Tope de locuciones en RAM para operación 24/7 sin crecimiento indefinido. */
  private static readonly MAX_MEMORY_ENTRIES = 400;

  /** Guarda en RAM respetando el tope (FIFO de inserción) para no fugar memoria. */
  private static rememberInMemory(hash: string, buf: Buffer) {
    if (this.memoryCache.has(hash)) this.memoryCache.delete(hash);
    this.memoryCache.set(hash, buf);
    while (this.memoryCache.size > this.MAX_MEMORY_ENTRIES) {
      const oldest = this.memoryCache.keys().next().value;
      if (oldest === undefined) break;
      this.memoryCache.delete(oldest);
    }
  }

  static initCacheDir() {
    if (!fs.existsSync(this.cacheDir)) {
      fs.mkdirSync(this.cacheDir, { recursive: true });
    }
  }

  /**
   * Convierte un número entero (0 - 9999) a su representación fonética en español latino
   * igual que `num2words(val, lang="es")` en el motor de audiolibros de MediaSuite.
   */
  static integerToSpanishWords(n: number): string {
    if (!Number.isFinite(n) || n < 0) return String(n);
    n = Math.floor(n);
    if (n === 0) return 'cero';

    const exact: Record<number, string> = {
      1: 'uno',
      2: 'dos',
      3: 'tres',
      4: 'cuatro',
      5: 'cinco',
      6: 'seis',
      7: 'siete',
      8: 'ocho',
      9: 'nueve',
      10: 'diez',
      11: 'once',
      12: 'doce',
      13: 'trece',
      14: 'catorce',
      15: 'quince',
      16: 'dieciséis',
      17: 'diecisiete',
      18: 'dieciocho',
      19: 'diecinueve',
      20: 'veinte',
      21: 'veintiuno',
      22: 'veintidós',
      23: 'veintitrés',
      24: 'veinticuatro',
      25: 'veinticinco',
      26: 'veintiséis',
      27: 'veintisiete',
      28: 'veintiocho',
      29: 'veintinueve',
      30: 'treinta',
      40: 'cuarenta',
      50: 'cincuenta',
      60: 'sesenta',
      70: 'setenta',
      80: 'ochenta',
      90: 'noventa',
      100: 'cien',
      200: 'doscientos',
      300: 'trescientos',
      400: 'cuatrocientos',
      500: 'quinientos',
      600: 'seiscientos',
      700: 'setecientos',
      800: 'ochocientos',
      900: 'novecientos',
      1000: 'mil',
    };

    if (exact[n]) return exact[n];

    if (n < 100) {
      const tens = Math.floor(n / 10) * 10;
      const units = n % 10;
      return `${exact[tens]} y ${exact[units]}`;
    }

    if (n < 1000) {
      const hundreds = Math.floor(n / 100) * 100;
      const rem = n % 100;
      const prefix = hundreds === 100 ? 'ciento' : exact[hundreds];
      return rem === 0 ? prefix : `${prefix} ${this.integerToSpanishWords(rem)}`;
    }

    if (n < 10000) {
      const thousands = Math.floor(n / 1000);
      const rem = n % 1000;
      const prefix = thousands === 1 ? 'mil' : `${this.integerToSpanishWords(thousands)} mil`;
      return rem === 0 ? prefix : `${prefix} ${this.integerToSpanishWords(rem)}`;
    }

    return String(n);
  }

  /**
   * Normaliza texto industrial/pesquero al estilo exacto de `normalize_text_for_tts` de MediaSuite Audiobooks:
   * - Elimina markdown, símbolos y emojis.
   * - Convierte decimales y enteros a palabras fonéticas en español para que Kokoro `ef_dora`
   *   suene hiperrealista, cálida y fluida como en audiolibros.
   */
  static normalizeForSpeech(text: string): string {
    if (!text) return '';
    let clean = text
      .replace(/[*_~`#]/g, '')
      .replace(/\[.*?\]/g, '')
      .replace(/🚨|✅|⚠️|🐟|📦|✨|🥩|📈|🛡️|🎙️|⚙️|🔄|⛔|💬|📞|🔴|🔊/g, '')
      .replace(/(\d+(?:[.,]\d+)?)\s*%/g, '$1 por ciento')
      .replace(/\bkg\b/gi, 'kilos')
      .replace(/\bgr\b/gi, 'gramos')
      .replace(/\bmin\b/gi, 'minutos')
      .replace(/\bOp\b\.?\s*(\d+)/gi, 'Operaria $1')
      .replace(/\bppm\b/gi, 'partes por millón')
      .replace(/°C/gi, ' grados');

    // Convertir números decimales (ej: 16.3 -> "dieciséis punto tres")
    clean = clean.replace(/\b(\d+)[.,](\d+)\b/g, (_match, intPart, decPart) => {
      const iWords = this.integerToSpanishWords(parseInt(intPart, 10));
      // Si el decimal empieza con 0 (ej. 16.05), leer dígito a dígito
      if (decPart.startsWith('0') && decPart.length > 1) {
        const dWords = decPart
          .split('')
          .map((d: string) => this.integerToSpanishWords(parseInt(d, 10)))
          .join(' ');
        return `${iWords} punto ${dWords}`;
      }
      // Remover ceros finales (ej: 16.300 -> 16 punto 3)
      const trimmedDec = decPart.replace(/0+$/, '') || '0';
      const dWords = this.integerToSpanishWords(parseInt(trimmedDec, 10));
      return trimmedDec === '0' ? iWords : `${iWords} punto ${dWords}`;
    });

    // Convertir números enteros restantes a palabras en español
    clean = clean.replace(/\b(\d{1,4})\b/g, (_match, numStr) => {
      return this.integerToSpanishWords(parseInt(numStr, 10));
    });

    // Ajustar "uno kilos" -> "un kilo", "veintiuno kilos" -> "veintiún kilos"
    clean = clean
      .replace(/\buno\s+kilos\b/gi, 'un kilo')
      .replace(/\bveintiuno\s+kilos\b/gi, 'veintiún kilos')
      .replace(/\s+/g, ' ')
      .trim();

    return clean;
  }

  private static getCacheKey(text: string, voice: string): string {
    const norm = this.normalizeForSpeech(text).toLowerCase();
    return crypto.createHash('md5').update(`v2_kokoro|${voice}|${norm}`).digest('hex');
  }

  /**
   * Sintetiza voz en español latino femenino usando Kokoro (`ef_dora`) desde media.weblifetech.com
   */
  static async synthesize(
    text: string,
    voice: string = config.tts.defaultVoice,
    rate: string = '+10%'
  ): Promise<TtsResult> {
    const start = Date.now();
    this.initCacheDir();

    const cleanText = this.normalizeForSpeech(text);
    if (!cleanText) {
      throw new Error('Texto vacío para síntesis de voz');
    }

    const selectedVoice = voice || 'ef_dora';
    const hash = this.getCacheKey(cleanText, selectedVoice);

    // 1. Verificar caché L1 en RAM (<1ms)
    if (this.memoryCache.has(hash)) {
      return {
        audioBuffer: this.memoryCache.get(hash)!,
        contentType: 'audio/mpeg',
        voice: selectedVoice,
        cached: true,
        latencyMs: Date.now() - start,
      };
    }

    // 2. Verificar caché L2 en disco (<3ms)
    const diskPath = path.join(this.cacheDir, `${hash}.mp3`);
    if (fs.existsSync(diskPath)) {
      const buf = fs.readFileSync(diskPath);
      if (buf.length > 256) {
        this.rememberInMemory(hash, buf);
        return {
          audioBuffer: buf,
          contentType: 'audio/mpeg',
          voice: selectedVoice,
          cached: true,
          latencyMs: Date.now() - start,
        };
      }
    }

    // 2.5 Motor de voz LOCAL/VPS (Piper es_ES) — sin nube ni MediaSuite
    const localBuf = await LocalVoiceService.synthesize(cleanText);
    if (localBuf) {
      this.rememberInMemory(hash, localBuf);
      try { fs.writeFileSync(diskPath, localBuf); } catch (_) {}
      return {
        audioBuffer: localBuf,
        contentType: 'audio/wav',
        voice: selectedVoice,
        cached: false,
        latencyMs: Date.now() - start,
      };
    }

    // 3. Fallback de desarrollo: Kokoro-82M en media.weblifetech.com
    try {
      const response = await axios.post(
        config.tts.speakUrl,
        {
          text: cleanText,
          voice: selectedVoice,
          rate,
          pitch: '+0Hz',
        },
        {
          responseType: 'arraybuffer',
          timeout: 12000,
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );

      const audioBuffer = Buffer.from(response.data);
      if (audioBuffer.length > 256) {
        this.rememberInMemory(hash, audioBuffer);
        try {
          fs.writeFileSync(diskPath, audioBuffer);
        } catch (_) {}

        return {
          audioBuffer,
          contentType: 'audio/mpeg',
          voice: selectedVoice,
          cached: false,
          latencyMs: Date.now() - start,
        };
      }
      throw new Error('Buffer de audio incompleto');
    } catch (err: any) {
      console.warn(`[Voz Planta] Advertencia en síntesis primaria (${selectedVoice}): ${err.message}`);
      throw err;
    }
  }

  /**
   * Pre-calienta (Warmup) las locuciones operativas puntuales en segundo plano al iniciar el servidor
   * para que el supervisor obtenga respuesta de voz humana hiperrealista en < 2ms (0ms red).
   */
  static async warmupCommonPhrases(): Promise<void> {
    this.initCacheDir();

    // Cargar primero todos los archivos existentes en tts_cache a RAM
    try {
      const files = fs.readdirSync(this.cacheDir);
      for (const f of files) {
        if (f.endsWith('.mp3')) {
          const h = f.replace('.mp3', '');
          const b = fs.readFileSync(path.join(this.cacheDir, f));
          if (b.length > 256) this.rememberInMemory(h, b);
        }
      }
    } catch (_) {}

    const commonPhrases = [
      'Registro confirmado.',
      'Confirmado.',
      'Modo solo pitido activado.',
      'Modo confirmación corta activado.',
      'Modo confirmación completa activado.',
      'En línea. Dicte el pesaje.',
      'No se detectó voz. Repita el pesaje.',
      'Alerta: verifique peso. Excede el límite de bandeja.',
      'Alerta: operaria no asignada a esta mesa.',
      'Alerta: operaria 99 no asignada a Mesa 6.',
      'Registro duplicado bloqueado.',
      'Confirmado: lomo 16.3 kilos, operaria 14.',
      'Confirmado: sangacho 12.4 kilos, operaria 15.',
      'Confirmado: lomo 15.1 kilos, operaria 16.',
      'Confirmado: lomo 16.2 kilos, operaria 14.',
      'Confirmado: lomo 15.8 kilos, operaria 14.',
      'Operaria 14 lista en Mesa 6. ¿Cuántos kilos tiene la bandeja?',
      'Operaria 15 lista en Mesa 6. ¿Cuántos kilos tiene la bandeja?',
      'Operaria 16 lista en Mesa 6. ¿Cuántos kilos tiene la bandeja?',
      'Hola, soy Pesca AI, tu asistente de planta. Estoy listo para registrar pesajes, revisar calidad o darte el balance de producción. ¿En qué te ayudo?',
      '¡Hola! Soy Pesca AI, tu asistente de planta. Puedo registrar pesajes, darte el balance de producción, revisar calidad o ayudarte a corregir un registro. ¿Qué necesitas?',
      'Parada de línea registrada en Mesa 6. Mantenimiento notificado.',
      'Control de calidad en norma. Autoclave en 118.5 grados.',
      'Alerta crítica de calidad: valor fuera de norma.',
    ];

    console.log(`[Voz Planta] Pre-calentando caché de voz hiperrealista '${config.tts.defaultVoice}'...`);
    // Ejecutar en segundo plano sin bloquear el arranque del servidor
    (async () => {
      for (const phrase of commonPhrases) {
        try {
          const hash = this.getCacheKey(phrase, config.tts.defaultVoice);
          const diskPath = path.join(this.cacheDir, `${hash}.mp3`);
          if (!fs.existsSync(diskPath)) {
            await this.synthesize(phrase, config.tts.defaultVoice);
          } else {
            const buf = fs.readFileSync(diskPath);
            if (buf.length > 256) this.rememberInMemory(hash, buf);
          }
        } catch (_) {}
      }
      console.log(`[Voz Planta] ✅ Caché de voz lista (${this.memoryCache.size} locuciones instantáneas en RAM).`);
    })();
  }

  static async getAvailableVoices() {
    return {
      default: 'ef_dora',
      voices: {
        ef_dora: 'Asistente de Planta (Femenina Latina Natural)',
        em_alex: 'Asistente de Planta (Masculino Profesional)',
      },
    };
  }
}
