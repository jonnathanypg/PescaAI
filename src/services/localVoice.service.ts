import axios from 'axios';
import { config } from '../config';

/**
 * Cliente del Motor de Voz LOCAL/VPS (sherpa-onnx: whisper-tiny STT + Piper ES TTS).
 * Mismo backend en local (`http://localhost:5005`) o en el VPS (`VOICE_ENGINE_URL`).
 * Si el motor no responde, devuelve null para que el llamador use el fallback en nube.
 */
export class LocalVoiceService {
  static get enabled(): boolean {
    return config.voice.localFirst && Boolean(config.voice.engineUrl);
  }

  static async transcribe(audioBuffer: Buffer, filename = 'dictado.webm'): Promise<string | null> {
    if (!this.enabled || !audioBuffer || audioBuffer.length < 300) return null;
    try {
      const res = await axios.post(`${config.voice.engineUrl}/stt`, audioBuffer, {
        headers: { 'Content-Type': 'application/octet-stream' },
        timeout: 45000,
        maxBodyLength: Infinity,
      });
      const text = String(res.data?.text || '').trim();
      if (text) {
        console.log(`[Voz Local sherpa] ⚡ (${res.data?.latency_ms ?? '?'}ms) -> "${text}"`);
        return text;
      }
    } catch (err: any) {
      console.warn(`[Voz Local sherpa] STT no disponible: ${err.message}`);
    }
    return null;
  }

  static async synthesize(text: string, speed = 1.0): Promise<Buffer | null> {
    if (!this.enabled || !text) return null;
    try {
      const res = await axios.post(
        `${config.voice.engineUrl}/tts`,
        { text, speed },
        { responseType: 'arraybuffer', timeout: 45000 }
      );
      const buf = Buffer.from(res.data);
      if (buf.length > 256) {
        console.log(`[Voz Local Piper] 🔊 (${res.headers['x-latency-ms'] ?? '?'}ms) ${buf.length} bytes`);
        return buf;
      }
    } catch (err: any) {
      console.warn(`[Voz Local Piper] TTS no disponible: ${err.message}`);
    }
    return null;
  }

  static async health(): Promise<any | null> {
    try {
      const res = await axios.get(`${config.voice.engineUrl}/health`, { timeout: 2500 });
      return res.data;
    } catch {
      return null;
    }
  }
}
