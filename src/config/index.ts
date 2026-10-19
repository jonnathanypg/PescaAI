import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '4000', 10),
  env: process.env.NODE_ENV || 'development',
  
  db: {
    type: (process.env.DB_TYPE || 'sqlite') as 'sqlite' | 'mysql',
    sqlitePath: process.env.SQLITE_DB_PATH || path.join(__dirname, '../../pescaai_data.db'),
    mysql: {
      host: process.env.MYSQL_HOST || 'localhost',
      port: parseInt(process.env.MYSQL_PORT || '3306', 10),
      user: process.env.MYSQL_USER || 'root',
      password: process.env.MYSQL_PASSWORD || '',
      database: process.env.MYSQL_DATABASE || 'tecopesca_staging',
      connectionLimit: 10,
    }
  },

  whisper: {
    url: process.env.MEDIA_WHISPER_URL || 'https://media.weblifetech.com/api/external/transcribe',
    microUrl: process.env.MEDIA_MICRO_STT_URL || 'https://media.weblifetech.com/api/micro/audio/transcribe',
    apiKey: process.env.MEDIA_API_KEY || '',
    authUrl: process.env.MEDIA_AUTH_URL || 'https://media.weblifetech.com/api/auth/login',
    adminUser: process.env.MEDIASUITE_USER || '',
    adminPass: process.env.MEDIASUITE_PASSWORD || '',
    groqApiKey: process.env.GROQ_API_KEY || '',
    openaiApiKey: process.env.OPENAI_API_KEY || '',
  },

  llm: {
    model: process.env.DEFAULT_LLM_MODEL || 'gpt-4o-mini',
    openaiApiKey: process.env.OPENAI_API_KEY || '',
    openrouterApiKey: process.env.OPENROUTER_API_KEY || '',
    groqApiKey: process.env.GROQ_API_KEY || '',
  },

  tts: {
    speakUrl: process.env.MEDIA_TTS_URL || 'https://media.weblifetech.com/api/tts/speak',
    externalUrl: process.env.MEDIA_EXTERNAL_TTS_URL || 'https://media.weblifetech.com/api/external/tts',
    voicesUrl: process.env.MEDIA_TTS_VOICES_URL || 'https://media.weblifetech.com/api/tts/voices',
    defaultVoice: process.env.KOKORO_DEFAULT_VOICE || 'ef_dora',
    fallbackVoice: process.env.EDGE_FALLBACK_VOICE || 'es-MX-DaliaNeural',
    defaultRate: process.env.TTS_RATE || '+8%',
  },

  lem: {
    apiUrl: process.env.LEM_API_URL || 'https://lem.weblifetech.com',
    apiKey: process.env.LEM_API_KEY || 'lem_sec_tecopesca',
    schema: process.env.LEM_SCHEMA || 'tecopesca_deslomado_v1',
    threshold: 0.20,
    workerBinPath: path.join(__dirname, '../../lib/lem_worker_bin'),
  },

  whatsapp: {
    sessionId: process.env.WHATSAPP_SESSION_ID || 'tecopesca_control_tower',
    authorizedDirectives: (process.env.AUTHORIZED_DIRECTIVE_NUMBERS || '')
      .split(',')
      .map(s => s.trim().replace(/\D/g, ''))
      .filter(Boolean),
    alertRecipients: (process.env.EMERGENCY_ALERT_NUMBERS || '')
      .split(',')
      .map(s => s.trim().replace(/\D/g, ''))
      .filter(Boolean),
  }
};
