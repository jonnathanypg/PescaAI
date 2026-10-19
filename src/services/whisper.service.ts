import axios from 'axios';
import FormData from 'form-data';
import fs from 'fs';
import { config } from '../config';
import { LocalVoiceService } from './localVoice.service';

/**
 * Servicio Speech-to-Text (Whisper) en Cascada de Ultra-Baja Latencia (<800ms) para Tecopesca Manta
 * Sigue la arquitectura resiliente multi-proveedor de `aikrofy`:
 * 1. Groq Whisper (`whisper-large-v3-turbo` / `whisper-large-v3`) -> ~350-800ms
 * 2. OpenAI Whisper (`gpt-4o-mini-transcribe` / `whisper-1`) -> ~700-1200ms
 * 3. MediaSuite Micro-Engine (`media.weblifetech.com/api/micro/audio/transcribe`) -> Fallback dedicado
 * 4. Filtro anti-alucinación de silencios + Corrección fonética determinista adaptada a >85dB y jerga manabita
 */
export class WhisperService {
  private static cachedJwtToken: string | null = null;
  private static tokenExpiresAt: number = 0;

  private static readonly INDUSTRIAL_PROMPT =
    'Planta atunera Tecopesca Manta. Mesa 6, operaria 14, operaria 15, operaria 16, operaria 17, operaria 18, bandeja, lomo, sangacho, trozos, kilos, gramos, parada de línea, autoclave, temperatura, histamina, cuba, corregir último pesaje, hola.';

  /**
   * Detecta alucinaciones clásicas de Whisper cuando solo recibe ruido blanco o silencio de planta
   */
  static isSilenceHallucination(text: string): boolean {
    if (!text) return true;
    const clean = text.trim().toLowerCase();
    if (clean.length < 2) return true;

    const hallucinations = [
      'subtítulos realizados por',
      'subtitulos realizados por',
      'amara.org',
      'gracias por ver',
      'suscríbete',
      'suscribete al canal',
      'transcripción por',
      'música',
      '[música]',
      '¡gracias!',
      'gracias.',
      '...',
      'you',
      'thank you',
      'mbc',
    ];

    for (const h of hallucinations) {
      if (clean === h || (clean.includes(h) && clean.length < 45)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Obtiene o renueva el token JWT de MediaSuite para acceso directo al motor Whisper sin fricción
   */
  private static async getMediaSuiteToken(): Promise<string> {
    if (this.cachedJwtToken && Date.now() < this.tokenExpiresAt) {
      return this.cachedJwtToken;
    }

    try {
      const res = await axios.post(
        config.whisper.authUrl,
        {
          username: config.whisper.adminUser,
          password: config.whisper.adminPass,
        },
        { timeout: 3000 }
      );
      if (res.data && res.data.token) {
        this.cachedJwtToken = res.data.token;
        this.tokenExpiresAt = Date.now() + 12 * 3600 * 1000;
        return this.cachedJwtToken!;
      }
    } catch (_) {}

    return config.whisper.apiKey;
  }

  /**
   * Normalizador fonético post-STT especializado para la planta de Tecopesca en Manta:
   * Corrige homófonos frecuentes en ambientes ruidosos (85-90 dB):
   * - "san gacho" / "sancacho" / "sangallo" -> "sangacho"
   * - "operaría" / "operar ya" -> "operaria"
   * - "bandeja" / "van deja" -> "bandeja"
   * - "16 .3" -> "16.3"
   */
  static applyIndustrialPhoneticCorrection(rawText: string): string {
    if (!rawText) return '';
    let corrected = rawText.trim();

    const replacements: Array<[RegExp, string]> = [
      [/\bsan\s*gacho\b|\bsancacho\b|\bsangallo\b|\bsangachos\b|\bsan\s*cacho\b/gi, 'sangacho'],
      [/\boperar[íi]a\b|\boperar\s+ya\b|\bopera\s+ria\b|\boperarias\b/gi, 'operaria'],
      [/\bvan\s+deja\b|\bbandejas\b/gi, 'bandeja'],
      [/\bel\s+homo\b|\bhomo\b/gi, 'lomo'],
      [/\blomos\b|\blo\s+mo\b/gi, 'lomo'],
      [/\bme\s+sa\b|\bmesas\b/gi, 'mesa'],
      [/\bki\s*los\b|\bquilos\b|\bquilo\b/gi, 'kilos'],
      [/\bgra\s*mos\b/gi, 'gramos'],
      [/\bauto\s*clave\b|\bauto\s*claves\b/gi, 'autoclave'],
      [/\bhis\s*tamina\b|\bistamina\b/gi, 'histamina'],
      [/(\d+)\s*[.,]\s*(\d+)/g, '$1.$2'],
    ];

    for (const [pattern, rep] of replacements) {
      corrected = corrected.replace(pattern, rep);
    }

    return corrected;
  }

  /**
   * Transcribe un buffer de audio (WAV/MP3/WEBM/OGG/MP4) con cascada de ultra-baja latencia
   */
  static async transcribeAudio(audioBuffer: Buffer, filename: string = 'pesaje_mesa.webm'): Promise<string> {
    if (!audioBuffer || audioBuffer.length < 300) {
      return '';
    }

    // NIVEL 0: MOTOR DE VOZ LOCAL/VPS (sherpa-onnx whisper-tiny) — sin nube ni MediaSuite
    const localText = await LocalVoiceService.transcribe(audioBuffer, filename);
    if (localText) {
      return this.applyIndustrialPhoneticCorrection(localText);
    }

    const ext = filename.split('.').pop()?.toLowerCase() || 'webm';
    const mimeMap: Record<string, string> = {
      webm: 'audio/webm',
      wav: 'audio/wav',
      mp3: 'audio/mpeg',
      ogg: 'audio/ogg',
      m4a: 'audio/mp4',
      mp4: 'audio/mp4',
    };
    const contentType = mimeMap[ext] || 'audio/webm';
    const safeFilename = filename.includes('.') ? filename : `dictado.${ext}`;

    // =========================================================================
    // NIVEL 1: GROQ WHISPER TURBO (~350ms - 800ms) - Ultra-baja latencia
    // =========================================================================
    if (config.whisper.groqApiKey) {
      try {
        const t0 = Date.now();
        const formData = new FormData();
        formData.append('file', audioBuffer, { filename: safeFilename, contentType });
        formData.append('model', 'whisper-large-v3-turbo');
        formData.append('language', 'es');
        formData.append('temperature', '0');
        formData.append('prompt', this.INDUSTRIAL_PROMPT);

        const response = await axios.post('https://api.groq.com/openai/v1/audio/transcriptions', formData, {
          headers: {
            ...formData.getHeaders(),
            Authorization: `Bearer ${config.whisper.groqApiKey}`,
          },
          timeout: 4500,
        });

        if (response.data && typeof response.data.text === 'string') {
          const raw = response.data.text.trim();
          if (this.isSilenceHallucination(raw)) {
            console.log(`[Groq STT] Silencio/ruido descartado en ${Date.now() - t0}ms: "${raw}"`);
            return '';
          }
          const text = this.applyIndustrialPhoneticCorrection(raw);
          console.log(`[Groq Whisper-Turbo] ⚡ (${Date.now() - t0}ms) -> "${text}"`);
          return text;
        }
      } catch (groqErr: any) {
        console.warn(`[Groq Whisper] Pasando a OpenAI STT: ${groqErr.message}`);
      }
    }

    // =========================================================================
    // NIVEL 2: OPENAI WHISPER (`gpt-4o-mini-transcribe` / `whisper-1`)
    // =========================================================================
    if (config.whisper.openaiApiKey) {
      try {
        const t0 = Date.now();
        const formData = new FormData();
        formData.append('file', audioBuffer, { filename: safeFilename, contentType });
        formData.append('model', 'whisper-1');
        formData.append('language', 'es');
        formData.append('temperature', '0');
        formData.append('prompt', this.INDUSTRIAL_PROMPT);

        const response = await axios.post('https://api.openai.com/v1/audio/transcriptions', formData, {
          headers: {
            ...formData.getHeaders(),
            Authorization: `Bearer ${config.whisper.openaiApiKey}`,
          },
          timeout: 6000,
        });

        if (response.data && typeof response.data.text === 'string') {
          const raw = response.data.text.trim();
          if (this.isSilenceHallucination(raw)) {
            return '';
          }
          const text = this.applyIndustrialPhoneticCorrection(raw);
          console.log(`[OpenAI Whisper-1] ✅ (${Date.now() - t0}ms) -> "${text}"`);
          return text;
        }
      } catch (oaiErr: any) {
        console.warn(`[OpenAI Whisper] Pasando a MediaSuite Micro-Engine: ${oaiErr.message}`);
      }
    }

    // =========================================================================
    // NIVEL 3: MEDIASUITE MICRO-ENGINE (media.weblifetech.com)
    // =========================================================================
    try {
      const token = await this.getMediaSuiteToken();
      const formData = new FormData();
      formData.append('file', audioBuffer, { filename: safeFilename, contentType });
      formData.append('language', 'es');
      formData.append('fast_mode', 'true');

      const response = await axios.post(config.whisper.microUrl, formData, {
        headers: {
          ...formData.getHeaders(),
          Authorization: `Bearer ${token}`,
        },
        timeout: 7000,
      });

      if (response.data && response.data.text) {
        const raw = String(response.data.text).trim();
        if (this.isSilenceHallucination(raw)) return '';
        const text = this.applyIndustrialPhoneticCorrection(raw);
        console.log(`[Whisper MediaSuite] ✅ Transcripción recibida: "${text}"`);
        return text;
      }
    } catch (microErr: any) {
      console.warn(`[Whisper MediaSuite] Error final STT: ${microErr.message}`);
    }

    return '';
  }

  static async transcribeFile(filePath: string): Promise<string> {
    const fileBuffer = fs.readFileSync(filePath);
    return this.transcribeAudio(fileBuffer, filePath.split('/').pop() || 'audio.wav');
  }
}
