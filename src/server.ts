import express from 'express';
import http from 'http';
import cors from 'cors';
import path from 'path';
import { config } from './config';
import apiRoutes from './routes/api.routes';
import { getDatabase } from './database';
import { WhatsappMonitoringService } from './services/whatsapp.service';
import { RealtimeVoiceGateway } from './services/realtime_voice.gateway';
import { KokoroTtsService } from './services/kokoro.service';
import { LemGuardianService } from './services/lem.service';

const app = express();
const server = http.createServer(app);

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Servir frontend Zero-UI y Dashboard
app.use(express.static(path.join(__dirname, 'web')));

// Rutas de API
app.use('/api', apiRoutes);

// Ruta raíz
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'web', 'index.html'));
});

// Levantar servidor y servicios
async function bootstrap() {
  try {
    console.log(`[Bootstrap] Inicializando Pesca AI...`);

    // 1. Inicializar Base de Datos (SQLite WAL o MySQL)
    await getDatabase();

    // 2. Inicializar Motor C99 Nativo LEM (liblemops + liblemv4)
    LemGuardianService.initSiliconWorker();

    // 3. Adjuntar Gateway WebSocket de Voz en Tiempo Real
    RealtimeVoiceGateway.attach(server);

    // 4. Pre-calentar caché de voz Kokoro TTS (`ef_dora` femenina latina en español) en segundo plano
    KokoroTtsService.warmupCommonPhrases().catch((err) => {
      console.warn(`[Bootstrap] Kokoro TTS warmup diferido: ${err.message}`);
    });

    // 5. Inicializar Torre de Control WhatsApp (Bajo demanda si no hay sesión previa)
    WhatsappMonitoringService.init().catch((err) => {
      console.warn(`[Bootstrap] WhatsApp inicializado en modo adaptativo: ${err.message}`);
    });

    // 6. Iniciar Servidor HTTP + WS
    server.listen(config.port, () => {
      const silicon = LemGuardianService.getSiliconStatus();
      console.log(`=====================================================================`);
      console.log(`🚀 PESCA AI — SISTEMA OPERATIVO PESQUERO END-TO-END (PUERTO: ${config.port})`);
      console.log(`📡 URL Terminal Operativa: http://localhost:${config.port}`);
      console.log(`⚡ WebSocket Realtime:     ws://localhost:${config.port}/ws/voice`);
      console.log(`🛡️ Guardián C99:           ${silicon.opsVersion} & ${silicon.v4Version}`);
      console.log(`🗣️ Voz Latina Natural:     '${config.tts.defaultVoice}' (${config.tts.speakUrl})`);
      console.log(`🎙️ STT Engine:             ${config.whisper.microUrl}`);
      console.log(`📱 Alertas WhatsApp:       Bajo Demanda (QR on-demand)`);
      console.log(`💾 Base de Datos:          ${config.db.type.toUpperCase()} (Modo Determinista)`);
      console.log(`=====================================================================`);
    });
  } catch (error) {
    console.error(`[Bootstrap Error]:`, error);
    process.exit(1);
  }
}

bootstrap();
