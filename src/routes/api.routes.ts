import { Router } from 'express';
import multer from 'multer';
import { WhisperService } from '../services/whisper.service';
import { KokoroTtsService } from '../services/kokoro.service';
import { PesajeProcessor } from '../services/pesaje.processor';
import { LemGuardianService } from '../services/lem.service';
import { WhatsappMonitoringService } from '../services/whatsapp.service';
import { DirectWhatsappManager } from '../services/direct_whatsapp.service';
import { getDatabase } from '../database';
import { config } from '../config';

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

/**
 * Autenticación y Login para Paneles (Admin, Directivo, Supervisor)
 */
router.post('/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Usuario y contraseña requeridos' });
    }

    const db = await getDatabase();
    const users = await db.query(
      'SELECT id, username, nombre, rol, telefono, activo FROM usuarios WHERE username = ? AND password = ? AND activo = 1',
      [username.trim().toLowerCase(), password]
    );

    if (users.length === 0) {
      return res.status(401).json({ error: 'Credenciales inválidas o usuario inactivo' });
    }

    const user = users[0];
    return res.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        nombre: user.nombre,
        rol: user.rol,
        telefono: user.telefono,
      },
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * Endpoint principal Push-to-Talk / Llamada en Tiempo Real:
 * Recibe el audio del dictado de planta, transcribe con Whisper (MediaSuite),
 * procesa con el Sistema Multi-Agente + LEM C99, y opcionalmente adjunta el audio TTS de Kokoro (`ef_dora`).
 */
router.post('/pesaje/voice', upload.single('audio'), async (req, res) => {
  const totalStart = Date.now();
  try {
    let transcription = req.body.transcription;
    const role = req.body.role || 'supervisor';
    const includeTts = req.body.include_tts !== 'false';
    const voice = req.body.voice || config.tts.defaultVoice;

    if (req.file && req.file.size > 100) {
      console.log(`[API /pesaje/voice] Recibido audio de ${req.file.size} bytes (${req.file.mimetype})`);
      try {
        transcription = await WhisperService.transcribeAudio(
          req.file.buffer,
          req.file.originalname || 'dictado.webm'
        );
      } catch (whisperErr: any) {
        console.warn(`[API] Advertencia STT: ${whisperErr.message}`);
      }
    }

    if ((!transcription || transcription.trim().length < 2) && req.body.browser_transcript) {
      transcription = WhisperService.applyIndustrialPhoneticCorrection(String(req.body.browser_transcript));
    }

    if (!transcription || transcription.trim().length < 2) {
      return res.status(200).json({
        success: false,
        noSpeechDetected: true,
        error: 'No se detectó voz clara en el segmento de audio.',
      });
    }

    console.log(`[API /pesaje/voice] Dictado procesado: "${transcription}"`);
    const result = await PesajeProcessor.processVoiceTranscription(
      transcription,
      role,
      req.body.session_id || 'http_planta_mesa_6',
      req.body.confirmation_mode
    );

    let ttsBase64: string | null = null;
    let ttsLatencyMs = 0;
    let ttsCached = false;

    if (includeTts && !result.skipTtsSpeech && result.audioFeedback) {
      try {
        const ttsRes = await KokoroTtsService.synthesize(result.audioFeedback, voice);
        ttsBase64 = ttsRes.audioBuffer.toString('base64');
        ttsLatencyMs = ttsRes.latencyMs;
        ttsCached = ttsRes.cached;
      } catch (ttsErr: any) {
        console.warn(`[API /pesaje/voice] Advertencia síntesis: ${ttsErr.message}`);
      }
    }

    return res.status(result.success ? 200 : 422).json({
      ...result,
      transcription,
      tts: ttsBase64
        ? {
            audioBase64: ttsBase64,
            contentType: 'audio/mpeg',
            voice,
            cached: ttsCached,
            latencyMs: ttsLatencyMs,
          }
        : null,
      totalPipelineMs: Date.now() - totalStart,
    });
  } catch (err: any) {
    console.error('[API /pesaje/voice Error]:', err);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * Entrada directa por texto o voz pre-transcrita
 */
router.post('/pesaje/text', async (req, res) => {
  const totalStart = Date.now();
  try {
    const {
      text,
      role = 'supervisor',
      include_tts = true,
      voice = config.tts.defaultVoice,
      session_id = 'http_planta_mesa_6',
      confirmation_mode,
    } = req.body;
    if (!text) return res.status(400).json({ error: 'Campo "text" obligatorio' });

    const result = await PesajeProcessor.processVoiceTranscription(text, role, session_id, confirmation_mode);

    let ttsBase64: string | null = null;
    let ttsLatencyMs = 0;
    let ttsCached = false;

    if (include_tts && !result.skipTtsSpeech && result.audioFeedback) {
      try {
        const ttsRes = await KokoroTtsService.synthesize(result.audioFeedback, voice);
        ttsBase64 = ttsRes.audioBuffer.toString('base64');
        ttsLatencyMs = ttsRes.latencyMs;
        ttsCached = ttsRes.cached;
      } catch (ttsErr: any) {
        console.warn(`[API /pesaje/text] Advertencia síntesis: ${ttsErr.message}`);
      }
    }

    return res.status(result.success ? 200 : 422).json({
      ...result,
      transcription: text,
      tts: ttsBase64
        ? {
            audioBase64: ttsBase64,
            contentType: 'audio/mpeg',
            voice,
            cached: ttsCached,
            latencyMs: ttsLatencyMs,
          }
        : null,
      totalPipelineMs: Date.now() - totalStart,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * Endpoint dedicado de Síntesis Neural Kokoro (`ef_dora` Latina en Español)
 */
router.post('/tts/speak', async (req, res) => {
  try {
    const { text, voice = config.tts.defaultVoice, rate = config.tts.defaultRate } = req.body;
    if (!text) {
      return res.status(400).json({ error: 'Campo "text" requerido para síntesis Kokoro TTS' });
    }

    const ttsRes = await KokoroTtsService.synthesize(text, voice, rate);
    res.setHeader('Content-Type', ttsRes.contentType);
    res.setHeader('X-Kokoro-Voice', ttsRes.voice);
    res.setHeader('X-Kokoro-Cached', String(ttsRes.cached));
    res.setHeader('X-Kokoro-Latency-Ms', String(ttsRes.latencyMs));
    return res.send(ttsRes.audioBuffer);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

router.get('/tts/voices', async (req, res) => {
  const voices = await KokoroTtsService.getAvailableVoices();
  return res.json(voices);
});

/**
 * Endpoints de Verificación Directa LEM C99 (Proxy Seguro estilo aigovcorex/api/lem.py)
 */
router.get('/lem/status', (req, res) => {
  const status = LemGuardianService.getSiliconStatus();
  return res.json({
    status: 'ok',
    engine: 'LEM-Ops + LEM-V4 Native C99 Silicon',
    threshold: config.lem.threshold,
    schema: config.lem.schema,
    ...status,
  });
});

router.post('/lem/verify', async (req, res) => {
  try {
    const { state, schema = config.lem.schema, engine = 'dual' } = req.body;
    if (!Array.isArray(state) || state.length !== 16) {
      return res.status(400).json({ accepted: false, reason: 'bad_dimension_expected_16' });
    }
    const result = await LemGuardianService.evaluateInSilicon(state, schema, engine);
    return res.json({
      ...result,
      threshold: config.lem.threshold,
      schema,
    });
  } catch (err: any) {
    return res.status(500).json({ accepted: false, error: err.message });
  }
});

/**
 * Consulta de estadísticas en tiempo real para el Dashboard de Planta y Torre Ejecutiva
 */
router.get('/stats', async (req, res) => {
  try {
    const db = await getDatabase();
    const pesajes = await db.query(`
      SELECT p.*, o.nombre as operaria_nombre 
      FROM pesajes p 
      LEFT JOIN operarias o ON p.operaria_id = o.id 
      ORDER BY p.id DESC LIMIT 30
    `);

    const summary = await db.query(`
      SELECT 
        COUNT(*) as total_pesajes,
        COALESCE(SUM(CASE WHEN tipo_producto = 'lomo' THEN peso_kg ELSE 0 END), 0) as total_lomo_kg,
        COALESCE(SUM(CASE WHEN tipo_producto = 'sangacho' THEN peso_kg ELSE 0 END), 0) as total_sangacho_kg,
        COALESCE(SUM(CASE WHEN tipo_producto = 'trozos' THEN peso_kg ELSE 0 END), 0) as total_trozos_kg,
        COALESCE(AVG(rendimiento_estimado), 0) as rendimiento_promedio
      FROM pesajes
    `);

    const paradas = await db.query(`
      SELECT * FROM paradas_linea ORDER BY id DESC LIMIT 10
    `);

    const haccp = await db.query(`
      SELECT * FROM registros_haccp ORDER BY id DESC LIMIT 10
    `);

    const lemLog = await db.query(`
      SELECT * FROM lem_telemetria ORDER BY id DESC LIMIT 20
    `);

    const agentTraces = await db.query(`
      SELECT * FROM agent_traces ORDER BY id DESC LIMIT 20
    `);

    const operariasStats = await db.query(`
      SELECT 
        o.id, o.nombre, o.mesa_asignada,
        COUNT(p.id) as bandejas,
        COALESCE(SUM(p.peso_kg), 0) as total_kg
      FROM operarias o
      LEFT JOIN pesajes p ON o.id = p.operaria_id
      GROUP BY o.id, o.nombre, o.mesa_asignada
      ORDER BY total_kg DESC
    `);

    return res.json({
      summary: summary[0],
      pesajes,
      paradas,
      haccp,
      lemTelemetria: lemLog,
      agentTraces,
      operariasStats,
      lemSilicon: LemGuardianService.getSiliconStatus(),
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * TRAZABILIDAD Y LÍNEA DE TIEMPO DE REGISTROS (Auditoría Inmutable)
 */
router.get('/pesajes/:id/timeline', async (req, res) => {
  try {
    const db = await getDatabase();
    const pesajeId = parseInt(req.params.id, 10);
    const versiones = await db.query(
      `SELECT * FROM pesajes_versiones WHERE pesaje_id = ? ORDER BY version_numero ASC`,
      [pesajeId]
    );

    const pesajeActual = await db.query(`SELECT * FROM pesajes WHERE id = ?`, [pesajeId]);

    return res.json({
      success: true,
      pesajeId,
      actual: pesajeActual[0] || null,
      timeline: versiones,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/pesajes/:id/correct', async (req, res) => {
  try {
    const db = await getDatabase();
    const pesajeId = parseInt(req.params.id, 10);
    const { peso_kg, operaria_id, tipo_producto, motivo, modificado_por = 'SUPERVISOR' } = req.body;

    const existing = await db.query(`SELECT * FROM pesajes WHERE id = ?`, [pesajeId]);
    if (existing.length === 0) {
      return res.status(404).json({ error: 'Pesaje no encontrado' });
    }

    const current = existing[0];
    const prevVersions = await db.query(
      `SELECT MAX(version_numero) as max_v FROM pesajes_versiones WHERE pesaje_id = ?`,
      [pesajeId]
    );
    const nextVersion = (prevVersions[0]?.max_v || 1) + 1;

    // Si es la primera corrección y no existía versión 1 en pesajes_versiones, guardamos la base histórica
    if (nextVersion === 2) {
      await db.execute(
        `INSERT INTO pesajes_versiones (pesaje_id, version_numero, mesa, operaria_id, tipo_producto, peso_kg, accion, motivo_cambio, modificado_por)
         VALUES (?, 1, ?, ?, ?, ?, 'CREACION', 'Registro inicial capturado por voz', ?)`,
        [pesajeId, current.mesa, current.operaria_id, current.tipo_producto, current.peso_kg, current.origen_captura]
      );
    }

    const newPeso = peso_kg !== undefined ? parseFloat(peso_kg) : current.peso_kg;
    const newOperaria = operaria_id || current.operaria_id;
    const newTipo = tipo_producto || current.tipo_producto;

    // Actualizar registro en tabla principal
    await db.execute(
      `UPDATE pesajes SET peso_kg = ?, operaria_id = ?, tipo_producto = ? WHERE id = ?`,
      [newPeso, newOperaria, newTipo, pesajeId]
    );

    // Asentar nueva versión en la línea de tiempo inmutable
    await db.execute(
      `INSERT INTO pesajes_versiones (pesaje_id, version_numero, mesa, operaria_id, tipo_producto, peso_kg, accion, motivo_cambio, modificado_por)
       VALUES (?, ?, ?, ?, ?, ?, 'CORRECCION_MANUAL', ?, ?)`,
      [pesajeId, nextVersion, current.mesa, newOperaria, newTipo, newPeso, motivo || 'Corrección manual autorizada por supervisor', modificado_por]
    );

    return res.json({
      success: true,
      message: `Pesaje #${pesajeId} actualizado a Versión ${nextVersion}`,
      version: nextVersion,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

router.delete('/pesajes/:id', async (req, res) => {
  try {
    const db = await getDatabase();
    const pesajeId = parseInt(req.params.id, 10);
    const { motivo = 'Anulado por supervisor', modificado_por = 'SUPERVISOR' } = req.body || {};

    const existing = await db.query(`SELECT * FROM pesajes WHERE id = ?`, [pesajeId]);
    if (existing.length === 0) {
      return res.status(404).json({ error: 'Pesaje no encontrado' });
    }

    const current = existing[0];
    const prevVersions = await db.query(
      `SELECT MAX(version_numero) as max_v FROM pesajes_versiones WHERE pesaje_id = ?`,
      [pesajeId]
    );
    const nextVersion = (prevVersions[0]?.max_v || 1) + 1;

    // Asentar en la línea de tiempo el motivo de anulación
    await db.execute(
      `INSERT INTO pesajes_versiones (pesaje_id, version_numero, mesa, operaria_id, tipo_producto, peso_kg, accion, motivo_cambio, modificado_por)
       VALUES (?, ?, ?, ?, ?, ?, 'ANULACION', ?, ?)`,
      [pesajeId, nextVersion, current.mesa, current.operaria_id, current.tipo_producto, current.peso_kg, motivo, modificado_por]
    );

    // Eliminar de la tabla activa de pesajes
    await db.execute(`DELETE FROM pesajes WHERE id = ?`, [pesajeId]);

    return res.json({
      success: true,
      message: `Pesaje #${pesajeId} anulado y registrado en la bitácora de trazabilidad.`,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * Endpoints del Panel de Administración para Vincular WhatsApp vía QR
 */
router.get('/whatsapp/status', (req, res) => {
  const status = DirectWhatsappManager.getStatus();
  return res.json(status);
});

router.post('/whatsapp/start', async (req, res) => {
  const force = req.body?.force === true;
  const status = await DirectWhatsappManager.startSession(force);
  return res.json(status);
});

router.post('/whatsapp/cancel-qr', async (req, res) => {
  const status = await DirectWhatsappManager.cancelQrSession();
  return res.json(status);
});

router.post('/whatsapp/disconnect', async (req, res) => {
  await DirectWhatsappManager.disconnectSession();
  return res.json({ status: 'disconnected', message: 'Sesión cerrada correctamente' });
});

router.post('/whatsapp/send-test', async (req, res) => {
  try {
    const { phone, message } = req.body;
    if (!phone || !message) return res.status(400).json({ error: 'phone y message requeridos' });

    const sent = await DirectWhatsappManager.sendMessage(phone, message);
    return res.json({ success: sent });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/whatsapp/webhook', async (req, res) => {
  try {
    const { sender, message } = req.body;
    console.log(`[Webhook WhatsApp] De: ${sender} -> "${message}"`);
    const reply = await WhatsappMonitoringService.handleIncomingMessage(sender, message || '');
    return res.json({ reply });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

export default router;
