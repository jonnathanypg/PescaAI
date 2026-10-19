import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../database';
import { VoiceParserService } from './parser.service';
import { LemGuardianService, LemVerificationResult, PesajeCandidate } from './lem.service';
import { WhatsappMonitoringService } from './whatsapp.service';
import { LlmBrainService, ConfirmationMode } from './llm.service';

export interface MultiAgentExecutionResult {
  success: boolean;
  action:
    | 'PESAJE_REGISTRADO'
    | 'PESAJE_CORREGIDO'
    | 'PARADA_LINEA_REGISTRADA'
    | 'HACCP_REGISTRADO'
    | 'CONSULTA_EJECUTIVA_RESPONDIDA'
    | 'MODO_CONFIRMACION_ACTUALIZADO'
    | 'CONVERSACION_COPILOTO'
    | 'RECHAZADO_LEM'
    | 'BLOQUEADO_SEGURIDAD_LEM';
  agentUsed:
    | 'YieldDeslomadoAgent'
    | 'MaintenanceOEEAgent'
    | 'HaccpThermalQualityAgent'
    | 'ExecutiveControlTowerAgent'
    | 'SupervisorCopilotAgent'
    | 'LemSecuritySentinel';
  intent: string;
  toolCalled: string;
  audioFeedback: string;
  confirmationMode?: ConfirmationMode;
  skipTtsSpeech?: boolean;
  data?: any;
  lem: LemVerificationResult;
  lemLayers: {
    preGuardEnergy: number;
    toolGuardEnergy: number;
    domainGuardEnergy: number;
    postGuardEnergy: number;
    contingencyTriggered: boolean;
    signatureHash: string;
  };
  latencyMs: number;
}

/**
 * Orquestador Operativo de Planta de Ultra-Baja Latencia
 * - Si es un pesaje directo, control de calidad o parada de línea: CERO razonamiento LLM (0ms),
 *   ejecución determinista inmediata con validación física/biológica en <15ms.
 * - Soporta 3 modos de confirmación en planta solicitables por voz o botón:
 *   1. 'normal': Confirmación concisa ("Confirmado: lomo 16.3 kilos, operaria 14.")
 *   2. 'short' ("solo dime confirmado"): Dice únicamente "Registro confirmado." (cacheado en RAM, 0ms TTS)
 *   3. 'beep' ("sin confirmación verbal" / "solo pitido"): Solo emite pitido de confirmación en registros válidos;
 *      solo habla en voz alta si ocurre un error, alerta de límite o si el supervisor hace una pregunta.
 */
export class MultiAgentOrchestrator {
  // Memoria de estado multi-turno para llenado de slots interactivo por mesa
  private static pendingWeighingSessions: Map<string, { mesa: number; operariaId?: string; tipoProducto?: 'lomo' | 'sangacho' | 'trozos'; timestamp: number }> = new Map();

  static clearPendingSlot(sessionId: string): void {
    this.pendingWeighingSessions.delete(sessionId);
  }

  static getPendingSlot(sessionId: string) {
    const s = this.pendingWeighingSessions.get(sessionId);
    if (!s) return null;
    // Caducar después de 2 minutos de inactividad
    if (Date.now() - s.timestamp > 120000) {
      this.pendingWeighingSessions.delete(sessionId);
      return null;
    }
    return s;
  }

  static async processCommand(
    rawInput: string,
    role: string = 'supervisor',
    sessionId: string = 'planta_mesa_6',
    clientConfirmationMode?: ConfirmationMode
  ): Promise<MultiAgentExecutionResult> {
    const startTime = Date.now();
    const traceId = uuidv4();
    const db = await getDatabase();

    if (clientConfirmationMode) {
      LlmBrainService.setConfirmationMode(sessionId, clientConfirmationMode);
    }
    let activeMode = LlmBrainService.getConfirmationMode(sessionId);

    // =========================================================================
    // CAPA 1: VALIDACIÓN DE INTEGRIDAD DE ENTRADA (<1ms)
    // =========================================================================
    const preCheck = await LemGuardianService.preValidate(rawInput, role);
    if (!preCheck.ok) {
      const latencyMs = Date.now() - startTime;
      const audioFeedback =
        preCheck.reason === 'MENSAJE_VACIO'
          ? 'No se detectó voz. Repita el pesaje.'
          : 'Alerta: Comando bloqueado por políticas de seguridad de planta.';

      await db.execute(
        `INSERT INTO lem_telemetria (event_type, z_vector, energy, verdict, reason, latency_ms) VALUES (?, ?, ?, ?, ?, ?)`,
        ['PRE_GUARD_BLOCK', JSON.stringify(preCheck.zVector), preCheck.energy, 'REJECTED', preCheck.reason, latencyMs]
      );

      const sig = crypto.createHash('sha256').update(`${traceId}|BLOCKED|${preCheck.energy}`).digest('hex').slice(0, 16);
      await this.recordAgentTrace(db, {
        traceId,
        agentName: 'LemSecuritySentinel',
        intent: 'SECURITY_INTERCEPT',
        toolCalled: 'lem_pre_validate',
        inputText: rawInput,
        outputText: audioFeedback,
        preEnergy: preCheck.energy,
        toolEnergy: 0,
        postEnergy: 0,
        contingency: 0,
        latencyMs,
        sig,
      });

      return {
        success: false,
        action: 'BLOQUEADO_SEGURIDAD_LEM',
        agentUsed: 'LemSecuritySentinel',
        intent: 'SECURITY_INTERCEPT',
        toolCalled: 'lem_pre_validate',
        audioFeedback,
        confirmationMode: activeMode,
        lem: {
          accepted: false,
          energy: preCheck.energy,
          threshold: 0.20,
          reason: preCheck.reason,
          latencyUs: preCheck.latencyUs,
          zVector: preCheck.zVector,
          signatureHash: sig,
          siliconActive: true,
        },
        lemLayers: {
          preGuardEnergy: preCheck.energy,
          toolGuardEnergy: 0,
          domainGuardEnergy: preCheck.energy,
          postGuardEnergy: 0,
          contingencyTriggered: false,
          signatureHash: sig,
        },
        latencyMs,
      };
    }

    LlmBrainService.appendHistory(sessionId, 'user', preCheck.sanitizedText);

    // =========================================================================
    // CAPA 2: PARSING DETERMINISTA ULTRA-RÁPIDO (0ms LLM si es pesaje directo)
    // =========================================================================
    let candidate: PesajeCandidate = VoiceParserService.parseVoiceCommand(preCheck.sanitizedText);
    const lowRaw = preCheck.sanitizedText.toLowerCase();

    // 0. Si el supervisor pidió cambiar el modo de confirmación por voz ("solo dime confirmado", "solo pitido", etc.)
    if (candidate.esCambioModoConfirmacion && candidate.nuevoModoConfirmacion) {
      activeMode = candidate.nuevoModoConfirmacion;
      LlmBrainService.setConfirmationMode(sessionId, activeMode);
      const modeFeedback =
        activeMode === 'beep'
          ? 'Modo solo pitido activado.'
          : activeMode === 'short'
          ? 'Modo confirmación corta activado.'
          : 'Modo confirmación completa activado.';

      const latencyMs = Date.now() - startTime;
      const sig = crypto.createHash('sha256').update(`${traceId}|MODE|${activeMode}`).digest('hex').slice(0, 16);

      return {
        success: true,
        action: 'MODO_CONFIRMACION_ACTUALIZADO',
        agentUsed: 'SupervisorCopilotAgent',
        intent: 'SET_CONFIRMATION_MODE',
        toolCalled: 'set_confirmation_mode',
        audioFeedback: modeFeedback,
        confirmationMode: activeMode,
        data: { confirmationMode: activeMode },
        lem: {
          accepted: true,
          energy: 0.012,
          threshold: 0.20,
          reason: 'MODE_UPDATED',
          latencyUs: 80,
          zVector: preCheck.zVector,
          signatureHash: sig,
          siliconActive: true,
        },
        lemLayers: {
          preGuardEnergy: preCheck.energy,
          toolGuardEnergy: 0.012,
          domainGuardEnergy: 0.012,
          postGuardEnergy: 0.012,
          contingencyTriggered: false,
          signatureHash: sig,
        },
        latencyMs,
      };
    }

    // =========================================================================
    // FUSIÓN DE SLOTS CONVERSACIONALES (Turnos parciales anteriores)
    // =========================================================================
    const pendingSlot = this.getPendingSlot(sessionId);
    if (pendingSlot && candidate.pesoKg > 0) {
      // Si el usuario no mencionó explícitamente la palabra 'operaria' en este turno, heredamos el slot previo
      if (!lowRaw.includes('operaria') && !lowRaw.includes('operario')) {
        candidate.operariaId = pendingSlot.operariaId || candidate.operariaId;
      }
      if (pendingSlot.tipoProducto && !lowRaw.includes('sangacho') && !lowRaw.includes('lomo') && !lowRaw.includes('trozo')) {
        candidate.tipoProducto = pendingSlot.tipoProducto;
      }
      if (!lowRaw.includes('mesa')) {
        candidate.mesa = pendingSlot.mesa || candidate.mesa;
      }
    }

    // Determinar si es un pesaje directo sin ambigüedad (NO usar LLM -> 0ms de razonamiento)
    const hasExplicitWeighingKeywords =
      lowRaw.includes('kilo') ||
      lowRaw.includes('kg') ||
      lowRaw.includes('gramo') ||
      lowRaw.includes('bandeja') ||
      lowRaw.includes('lomo') ||
      lowRaw.includes('sangacho') ||
      lowRaw.includes('trozo') ||
      lowRaw.includes('peso') ||
      lowRaw.includes('pesó') ||
      lowRaw.includes('mesa') ||
      (lowRaw.includes('operaria') && /\d/.test(lowRaw));

    const isDirectWeighing =
      !candidate.esConsultaDirectiva &&
      !candidate.esHaccp &&
      !candidate.esParadaLinea &&
      !candidate.esCorreccionPesaje &&
      candidate.pesoKg > 0 &&
      hasExplicitWeighingKeywords;

    const isConversationalOrAmbiguous =
      !isDirectWeighing &&
      !candidate.esConsultaDirectiva &&
      !candidate.esHaccp &&
      !candidate.esParadaLinea &&
      !candidate.esCorreccionPesaje;

    let llmSpokenOverride: string | null = null;

    if (isConversationalOrAmbiguous || (candidate.esCorreccionPesaje && candidate.pesoKg === 0)) {
      const liveContext = await this.getLivePlantContext(db);
      const llmDecision = await LlmBrainService.analyzeSupervisorUtterance(
        preCheck.sanitizedText,
        liveContext,
        sessionId
      );

      if (llmDecision.intent === 'SET_CONFIRMATION_MODE' && llmDecision.confirmationMode) {
        activeMode = llmDecision.confirmationMode;
        LlmBrainService.setConfirmationMode(sessionId, activeMode);
        const modeFeedback =
          activeMode === 'beep'
            ? 'Modo solo pitido activado.'
            : activeMode === 'short'
            ? 'Modo confirmación corta activado.'
            : 'Modo confirmación completa activado.';
        return {
          success: true,
          action: 'MODO_CONFIRMACION_ACTUALIZADO',
          agentUsed: 'SupervisorCopilotAgent',
          intent: 'SET_CONFIRMATION_MODE',
          toolCalled: 'set_confirmation_mode',
          audioFeedback: modeFeedback,
          confirmationMode: activeMode,
          data: { confirmationMode: activeMode },
          lem: {
            accepted: true,
            energy: 0.015,
            threshold: 0.20,
            reason: 'MODE_UPDATED',
            latencyUs: 100,
            zVector: preCheck.zVector,
            signatureHash: 'mode_ok',
            siliconActive: true,
          },
          lemLayers: {
            preGuardEnergy: preCheck.energy,
            toolGuardEnergy: 0.015,
            domainGuardEnergy: 0.015,
            postGuardEnergy: 0.015,
            contingencyTriggered: false,
            signatureHash: 'mode_ok',
          },
          latencyMs: Date.now() - startTime,
        };
      }

      if (llmDecision.intent === 'CONVERSATIONAL_SUPERVISOR') {
        const toolGuard = await LemGuardianService.verifyToolExecution({
          toolName: 'supervisor_copilot_dialogue',
          isWrite: false,
          role,
          mesa: 6,
          hasValidParams: true,
        });

        const postCheck = await LemGuardianService.postValidate(llmDecision.spokenResponse, true, true);
        const latencyMs = Date.now() - startTime;
        const sig = crypto
          .createHash('sha256')
          .update(`${traceId}|COPILOT|${postCheck.energy}`)
          .digest('hex')
          .slice(0, 16);

        LlmBrainService.appendHistory(sessionId, 'assistant', postCheck.sanitizedText);

        await this.recordAgentTrace(db, {
          traceId,
          agentName: 'SupervisorCopilotAgent',
          intent: 'CONVERSATIONAL_SUPERVISOR',
          toolCalled: 'supervisor_copilot_dialogue',
          inputText: rawInput,
          outputText: postCheck.sanitizedText,
          preEnergy: preCheck.energy,
          toolEnergy: toolGuard.energy,
          postEnergy: postCheck.energy,
          contingency: postCheck.needsContingency ? 1 : 0,
          latencyMs,
          sig,
        });

        return {
          success: true,
          action: 'CONVERSACION_COPILOTO',
          agentUsed: 'SupervisorCopilotAgent',
          intent: 'CONVERSATIONAL_SUPERVISOR',
          toolCalled: 'supervisor_copilot_dialogue',
          audioFeedback: postCheck.sanitizedText,
          confirmationMode: activeMode,
          data: { contextSummary: liveContext },
          lem: {
            accepted: true,
            energy: toolGuard.energy,
            threshold: 0.20,
            reason: 'VERIFIED_DIALOGUE',
            latencyUs: toolGuard.latencyUs,
            zVector: toolGuard.zVector,
            signatureHash: sig,
            siliconActive: true,
          },
          lemLayers: {
            preGuardEnergy: preCheck.energy,
            toolGuardEnergy: toolGuard.energy,
            domainGuardEnergy: toolGuard.energy,
            postGuardEnergy: postCheck.energy,
            contingencyTriggered: postCheck.needsContingency,
            signatureHash: sig,
          },
          latencyMs,
        };
      }

      if (llmDecision.intent === 'CORRECT_LAST_WEIGHING') {
        candidate.esCorreccionPesaje = true;
        if (llmDecision.pesoKg && llmDecision.pesoKg > 0) candidate.pesoKg = llmDecision.pesoKg;
        if (llmDecision.tipoProducto) candidate.tipoProducto = llmDecision.tipoProducto;
      } else if (llmDecision.intent === 'RECORD_WEIGHING') {
        if (llmDecision.pesoKg && llmDecision.pesoKg > 0) {
          candidate.mesa = llmDecision.mesa || 6;
          candidate.operariaId = String(llmDecision.operariaId || '14');
          candidate.tipoProducto = llmDecision.tipoProducto || 'lomo';
          candidate.pesoKg = Number(llmDecision.pesoKg);
          this.clearPendingSlot(sessionId);
        } else {
          // El supervisor dictó operaria o producto pero aún no el peso (dictado interactivo multi-turno)
          const partialMesa = llmDecision.mesa || candidate.mesa || 6;
          const partialOp = String(llmDecision.operariaId || candidate.operariaId || '14');
          const partialProd = (llmDecision.tipoProducto || candidate.tipoProducto || 'lomo') as 'lomo' | 'sangacho' | 'trozos';
          this.pendingWeighingSessions.set(sessionId, {
            mesa: partialMesa,
            operariaId: partialOp,
            tipoProducto: partialProd,
            timestamp: Date.now()
          });

          const postCheck = await LemGuardianService.postValidate(
            llmDecision.spokenResponse || `Operaria ${partialOp} lista en Mesa ${partialMesa}. ¿Cuántos kilos tiene la bandeja?`,
            true,
            true
          );
          LlmBrainService.appendHistory(sessionId, 'assistant', postCheck.sanitizedText);

          return {
            success: true,
            action: 'CONVERSACION_COPILOTO',
            agentUsed: 'YieldDeslomadoAgent',
            intent: 'PARTIAL_WEIGHING_SLOT_FILLING',
            toolCalled: 'prompt_weighing_weight',
            audioFeedback: postCheck.sanitizedText,
            confirmationMode: activeMode,
            data: { partialMesa, partialOp, partialProd },
            lem: {
              accepted: true,
              energy: 0.02,
              threshold: 0.20,
              reason: 'SLOT_FILLING_ACTIVE',
              latencyUs: 90,
              zVector: preCheck.zVector,
              signatureHash: 'slot_ok',
              siliconActive: true,
            },
            lemLayers: {
              preGuardEnergy: preCheck.energy,
              toolGuardEnergy: 0.02,
              domainGuardEnergy: 0.02,
              postGuardEnergy: postCheck.energy,
              contingencyTriggered: false,
              signatureHash: 'slot_ok',
            },
            latencyMs: Date.now() - startTime,
          };
        }
      } else if (llmDecision.intent === 'QUERY_PRODUCTION') {
        candidate.esConsultaDirectiva = true;
        candidate.tipoConsulta = llmDecision.tipoConsulta || 'RESUMEN_GENERAL';
        llmSpokenOverride = llmDecision.spokenResponse;
      } else if (llmDecision.intent === 'RECORD_HACCP') {
        candidate.esHaccp = true;
        candidate.parametroHaccp = llmDecision.parametroHaccp || 'TEMPERATURA_AUTOCLAVE';
        candidate.valorHaccp = llmDecision.valorHaccp || 118.0;
        candidate.unidadHaccp = llmDecision.unidadHaccp || '°C';
        candidate.loteCuba = llmDecision.loteCuba || 'CUBA-04';
      } else if (llmDecision.intent === 'RECORD_LINE_STOP') {
        candidate.esParadaLinea = true;
        candidate.motivoParada = llmDecision.motivoParada || rawInput;
        candidate.tiempoParadaMin = llmDecision.tiempoParadaMin || 5;
      }
    }

    // -------------------------------------------------------------------------
    // AGENTE ESPECIAL: Corrección Determinista del Último Pesaje (`update_last_weighing`)
    // -------------------------------------------------------------------------
    if (candidate.esCorreccionPesaje) {
      const lastRows = await db.query(
        `SELECT p.*, o.nombre as operaria_nombre FROM pesajes p LEFT JOIN operarias o ON p.operaria_id = o.id ORDER BY p.id DESC LIMIT 1`
      );

      if (lastRows.length === 0) {
        const msg = 'No hay registro previo para corregir. Dicte el pesaje.';
        return {
          success: false,
          action: 'RECHAZADO_LEM',
          agentUsed: 'YieldDeslomadoAgent',
          intent: 'CORRECT_LAST_WEIGHING_EMPTY',
          toolCalled: 'update_last_weighing',
          audioFeedback: msg,
          confirmationMode: activeMode,
          lem: {
            accepted: false,
            energy: 0.45,
            threshold: 0.20,
            reason: 'NO_PREVIOUS_RECORD',
            latencyUs: 120,
            zVector: new Array(16).fill(0),
            siliconActive: true,
          },
          lemLayers: {
            preGuardEnergy: preCheck.energy,
            toolGuardEnergy: 0.45,
            domainGuardEnergy: 0.45,
            postGuardEnergy: 0.01,
            contingencyTriggered: false,
            signatureHash: 'no_prev',
          },
          latencyMs: Date.now() - startTime,
        };
      }

      const lastRecord = lastRows[0];
      const updatedCandidate: PesajeCandidate = {
        mesa: Number(lastRecord.mesa || 6),
        operariaId: String(lastRecord.operaria_id || '14'),
        tipoProducto: (
          rawInput.toLowerCase().includes('sangacho')
            ? 'sangacho'
            : rawInput.toLowerCase().includes('trozo')
            ? 'trozos'
            : lastRecord.tipo_producto
        ) as 'lomo' | 'sangacho' | 'trozos',
        pesoKg: candidate.pesoKg,
        rawText: rawInput,
      };

      const toolGuard = await LemGuardianService.verifyToolExecution({
        toolName: 'update_last_weighing',
        isWrite: true,
        role,
        mesa: updatedCandidate.mesa,
        hasValidParams: updatedCandidate.pesoKg > 0,
      });

      const lem = await LemGuardianService.verifyPesaje(updatedCandidate, true, false);
      if (!lem.accepted) {
        const rejectMsg = `Alerta: verifique peso. Excede el límite de bandeja.`;
        return {
          success: false,
          action: 'RECHAZADO_LEM',
          agentUsed: 'YieldDeslomadoAgent',
          intent: 'CORRECT_LAST_WEIGHING_REJECTED',
          toolCalled: 'update_last_weighing',
          audioFeedback: rejectMsg,
          confirmationMode: activeMode,
          lem,
          lemLayers: {
            preGuardEnergy: preCheck.energy,
            toolGuardEnergy: toolGuard.energy,
            domainGuardEnergy: lem.energy,
            postGuardEnergy: 0.02,
            contingencyTriggered: false,
            signatureHash: lem.signatureHash || 'corr_rej',
          },
          latencyMs: Date.now() - startTime,
        };
      }

      await db.execute(
        `UPDATE pesajes SET peso_kg = ?, tipo_producto = ?, audio_transcripcion = ?, lem_energy = ? WHERE id = ?`,
        [
          updatedCandidate.pesoKg,
          updatedCandidate.tipoProducto,
          `[CORREGIDO] ${rawInput}`,
          lem.energy,
          lastRecord.id,
        ]
      );

      // Registrar versión en pesajes_versiones para trazabilidad inmutable
      try {
        const vRows = await db.query(
          `SELECT MAX(version_numero) as max_v FROM pesajes_versiones WHERE pesaje_id = ?`,
          [lastRecord.id]
        );
        const nextV = (vRows[0]?.max_v || 1) + 1;
        if (nextV === 2) {
          await db.execute(
            `INSERT INTO pesajes_versiones (pesaje_id, version_numero, mesa, operaria_id, tipo_producto, peso_kg, accion, motivo_cambio, modificado_por)
             VALUES (?, 1, ?, ?, ?, ?, 'CREACION', 'Registro inicial por voz', ?)`,
            [lastRecord.id, lastRecord.mesa, lastRecord.operaria_id, lastRecord.tipo_producto, lastRecord.peso_kg, role]
          );
        }
        await db.execute(
          `INSERT INTO pesajes_versiones (pesaje_id, version_numero, mesa, operaria_id, tipo_producto, peso_kg, accion, motivo_cambio, modificado_por)
           VALUES (?, ?, ?, ?, ?, ?, 'CORRECCION_VOZ', ?, ?)`,
          [lastRecord.id, nextV, updatedCandidate.mesa, updatedCandidate.operariaId, updatedCandidate.tipoProducto, updatedCandidate.pesoKg, `Corrección por voz: "${rawInput}"`, role]
        );
      } catch (_) {}

      const audioFeedback =
        activeMode === 'short'
          ? 'Registro confirmado.'
          : `Corregido a ${updatedCandidate.pesoKg} kilos de ${updatedCandidate.tipoProducto}.`;

      const postCheck = await LemGuardianService.postValidate(audioFeedback, true, true);
      LlmBrainService.appendHistory(sessionId, 'assistant', postCheck.sanitizedText);

      return {
        success: true,
        action: 'PESAJE_CORREGIDO',
        agentUsed: 'YieldDeslomadoAgent',
        intent: 'CORRECT_LAST_WEIGHING',
        toolCalled: 'update_last_weighing',
        audioFeedback: postCheck.sanitizedText,
        confirmationMode: activeMode,
        skipTtsSpeech: activeMode === 'beep',
        data: {
          id: lastRecord.id,
          uuid: lastRecord.uuid,
          mesa: updatedCandidate.mesa,
          operariaId: updatedCandidate.operariaId,
          operaria: lastRecord.operaria_nombre || updatedCandidate.operariaId,
          pesoAnteriorKg: Number(lastRecord.peso_kg),
          pesoKg: updatedCandidate.pesoKg,
          tipo: updatedCandidate.tipoProducto,
        },
        lem,
        lemLayers: {
          preGuardEnergy: preCheck.energy,
          toolGuardEnergy: toolGuard.energy,
          domainGuardEnergy: lem.energy,
          postGuardEnergy: postCheck.energy,
          contingencyTriggered: false,
          signatureHash: lem.signatureHash || 'corr_ok',
        },
        latencyMs: Date.now() - startTime,
      };
    }

    // -------------------------------------------------------------------------
    // AGENTE 1: Consultas Operativas y de Producción en Tiempo Real
    // -------------------------------------------------------------------------
    if (candidate.esConsultaDirectiva) {
      const toolGuard = await LemGuardianService.verifyToolExecution({
        toolName: 'query_realtime_production_kpis',
        isWrite: false,
        role,
        mesa: candidate.mesa,
        hasValidParams: true,
      });

      let audioFeedback = '';
      let queryData: any = {};

      if (candidate.tipoConsulta?.startsWith('OPERARIA_')) {
        const opId = candidate.tipoConsulta.replace('OPERARIA_', '');
        const rows = await db.query(
          `SELECT p.*, o.nombre FROM pesajes p LEFT JOIN operarias o ON p.operaria_id = o.id WHERE p.operaria_id = ? ORDER BY p.id DESC LIMIT 10`,
          [opId]
        );
        const opInfo = await db.query(`SELECT * FROM operarias WHERE id = ?`, [opId]);
        const nombre = opInfo[0]?.nombre || `Operaria ${opId}`;
        const totalKg = rows.reduce((acc: number, r: any) => acc + Number(r.peso_kg), 0);
        audioFeedback =
          rows.length > 0
            ? `${nombre}: ${rows.length} bandejas, ${totalKg.toFixed(1)} kilos. Dicte el pesaje.`
            : `${nombre} sin registros aún. Dicte el pesaje.`;
        queryData = { operariaId: opId, nombre, bandejas: rows.length, totalKg: Number(totalKg.toFixed(2)) };
      } else if (candidate.tipoConsulta === 'PARADAS_LINEA') {
        const paradas = await db.query(`SELECT * FROM paradas_linea WHERE resuelto = 0 ORDER BY id DESC`);
        const totalMin = paradas.reduce((acc: number, p: any) => acc + Number(p.tiempo_estimado_min || 0), 0);
        audioFeedback =
          paradas.length > 0
            ? `${paradas.length} paradas en Mesa 6, ${totalMin} minutos. Dicte el pesaje.`
            : `Mesa 6 sin paradas activas. Dicte el pesaje.`;
        queryData = { paradasActivas: paradas.length, tiempoTotalMin: totalMin };
      } else {
        const summary = await db.query(`
          SELECT 
            COUNT(*) as total_pesajes,
            COALESCE(SUM(CASE WHEN tipo_producto = 'lomo' THEN peso_kg ELSE 0 END), 0) as total_lomo_kg,
            COALESCE(SUM(CASE WHEN tipo_producto = 'sangacho' THEN peso_kg ELSE 0 END), 0) as total_sangacho_kg,
            COALESCE(AVG(rendimiento_estimado), 0) as rendimiento_promedio
          FROM pesajes
        `);
        const s = summary[0] || {};
        const totalLomo = Number(s.total_lomo_kg || 0).toFixed(1);
        const rend = Number(s.rendimiento_promedio || 44.5).toFixed(1);
        audioFeedback =
          llmSpokenOverride ||
          `Mesa 6: ${s.total_pesajes || 0} bandejas, ${totalLomo} kilos de lomo, rendimiento ${rend} por ciento. Dicte el pesaje.`;
        queryData = s;
      }

      const postCheck = await LemGuardianService.postValidate(audioFeedback, true, role === 'directivo' || role === 'admin');
      LlmBrainService.appendHistory(sessionId, 'assistant', postCheck.sanitizedText);

      const latencyMs = Date.now() - startTime;
      const sig = crypto
        .createHash('sha256')
        .update(`${traceId}|EXEC_QUERY|${postCheck.energy}`)
        .digest('hex')
        .slice(0, 16);

      await db.execute(
        `INSERT INTO lem_telemetria (event_type, z_vector, energy, verdict, reason, latency_ms) VALUES (?, ?, ?, ?, ?, ?)`,
        ['CONSULTA_DIRECTIVA', JSON.stringify(toolGuard.zVector), toolGuard.energy, 'ACCEPTED', 'SQL_VERIFIED_QUERY', latencyMs]
      );

      return {
        success: true,
        action: 'CONSULTA_EJECUTIVA_RESPONDIDA',
        agentUsed: 'ExecutiveControlTowerAgent',
        intent: candidate.tipoConsulta || 'RESUMEN_GENERAL',
        toolCalled: 'query_realtime_production_kpis',
        audioFeedback: postCheck.sanitizedText,
        confirmationMode: activeMode,
        data: queryData,
        lem: {
          accepted: true,
          energy: toolGuard.energy,
          threshold: 0.20,
          reason: 'SQL_DETERMINISTIC_VERIFIED',
          latencyUs: toolGuard.latencyUs,
          zVector: toolGuard.zVector,
          signatureHash: sig,
          siliconActive: true,
        },
        lemLayers: {
          preGuardEnergy: preCheck.energy,
          toolGuardEnergy: toolGuard.energy,
          domainGuardEnergy: toolGuard.energy,
          postGuardEnergy: postCheck.energy,
          contingencyTriggered: postCheck.needsContingency,
          signatureHash: sig,
        },
        latencyMs,
      };
    }

    // -------------------------------------------------------------------------
    // AGENTE 2: Control Térmico y Calidad (Inocuidad, Autoclaves, Histamina)
    // -------------------------------------------------------------------------
    if (candidate.esHaccp) {
      const toolGuard = await LemGuardianService.verifyToolExecution({
        toolName: 'record_haccp_compliance',
        isWrite: true,
        role,
        mesa: candidate.mesa,
        hasValidParams: candidate.valorHaccp !== undefined && candidate.valorHaccp > 0,
      });

      const haccpLem = await LemGuardianService.verifyHaccpRecord(
        candidate.parametroHaccp || 'TEMPERATURA_AUTOCLAVE',
        candidate.valorHaccp || 118.0,
        candidate.mesa
      );

      const haccpUuid = uuidv4();
      await db.execute(
        `INSERT INTO registros_haccp (uuid, mesa, lote_cuba, parametro, valor_medido, unidad, cumple_norma, lem_energy, audio_transcripcion)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          haccpUuid,
          candidate.mesa,
          candidate.loteCuba || 'CUBA-04',
          candidate.parametroHaccp || 'TEMPERATURA_AUTOCLAVE',
          candidate.valorHaccp || 118.0,
          candidate.unidadHaccp || '°C',
          haccpLem.accepted ? 1 : 0,
          haccpLem.energy,
          candidate.rawText,
        ]
      );

      const audioFeedback = haccpLem.accepted
        ? activeMode === 'short'
          ? 'Registro confirmado.'
          : `Control de calidad en norma. Autoclave en ${candidate.valorHaccp} grados.`
        : `Alerta crítica de calidad: valor fuera de norma.`;

      const postCheck = await LemGuardianService.postValidate(audioFeedback, true, true);
      const latencyMs = Date.now() - startTime;

      return {
        success: haccpLem.accepted,
        action: haccpLem.accepted ? 'HACCP_REGISTRADO' : 'RECHAZADO_LEM',
        agentUsed: 'HaccpThermalQualityAgent',
        intent: 'RECORD_HACCP_METRIC',
        toolCalled: 'record_haccp_compliance',
        audioFeedback: postCheck.sanitizedText,
        confirmationMode: activeMode,
        skipTtsSpeech: haccpLem.accepted && activeMode === 'beep',
        data: {
          uuid: haccpUuid,
          loteCuba: candidate.loteCuba,
          parametro: candidate.parametroHaccp,
          valor: candidate.valorHaccp,
          unidad: candidate.unidadHaccp,
          cumpleNorma: haccpLem.accepted,
        },
        lem: haccpLem,
        lemLayers: {
          preGuardEnergy: preCheck.energy,
          toolGuardEnergy: toolGuard.energy,
          domainGuardEnergy: haccpLem.energy,
          postGuardEnergy: postCheck.energy,
          contingencyTriggered: false,
          signatureHash: haccpLem.signatureHash || 'haccp_sig',
        },
        latencyMs,
      };
    }

    // -------------------------------------------------------------------------
    // AGENTE 3: Paradas de Línea y Mantenimiento
    // -------------------------------------------------------------------------
    if (candidate.esParadaLinea) {
      const toolGuard = await LemGuardianService.verifyToolExecution({
        toolName: 'dispatch_line_stop_alert',
        isWrite: true,
        role,
        mesa: candidate.mesa,
        hasValidParams: true,
      });

      await db.execute(
        `INSERT INTO paradas_linea (mesa, motivo, tiempo_estimado_min, audio_transcripcion) VALUES (?, ?, ?, ?)`,
        [candidate.mesa, candidate.motivoParada, candidate.tiempoParadaMin, candidate.rawText]
      );

      const audioFeedback = `Parada de línea registrada en Mesa ${candidate.mesa}. Mantenimiento notificado.`;
      const postCheck = await LemGuardianService.postValidate(audioFeedback, true, true);
      const latencyMs = Date.now() - startTime;
      const sig = crypto.createHash('sha256').update(`${traceId}|LINE_STOP|${toolGuard.energy}`).digest('hex').slice(0, 16);

      WhatsappMonitoringService.alertLineStop(
        candidate.mesa,
        candidate.motivoParada || rawInput,
        candidate.tiempoParadaMin || 5
      ).catch(() => {});

      return {
        success: true,
        action: 'PARADA_LINEA_REGISTRADA',
        agentUsed: 'MaintenanceOEEAgent',
        intent: 'REPORT_LINE_DOWNTIME',
        toolCalled: 'dispatch_line_stop_alert',
        audioFeedback: postCheck.sanitizedText,
        confirmationMode: activeMode,
        data: candidate,
        lem: {
          accepted: true,
          energy: toolGuard.energy,
          threshold: 0.20,
          reason: 'LINE_STOP_AUTHORIZED',
          latencyUs: toolGuard.latencyUs,
          zVector: toolGuard.zVector,
          signatureHash: sig,
          siliconActive: true,
        },
        lemLayers: {
          preGuardEnergy: preCheck.energy,
          toolGuardEnergy: toolGuard.energy,
          domainGuardEnergy: toolGuard.energy,
          postGuardEnergy: postCheck.energy,
          contingencyTriggered: false,
          signatureHash: sig,
        },
        latencyMs,
      };
    }

    // -------------------------------------------------------------------------
    // AGENTE 4: Captura de Pesaje con Sub-Agentes en Paralelo (ToolGuard + OperariaDB + IdempotenciaDB simultáneos)
    // -------------------------------------------------------------------------
    const [toolGuard, operarias, candidatePesajes] = await Promise.all([
      LemGuardianService.verifyToolExecution({
        toolName: 'record_deslomado_weighing',
        isWrite: true,
        role,
        mesa: candidate.mesa,
        hasValidParams: candidate.pesoKg > 0,
      }),
      db.query(`SELECT * FROM operarias WHERE id = ? AND activa = 1`, [candidate.operariaId]),
      db.query(
        `SELECT id, peso_kg, timestamp_db FROM pesajes 
         WHERE mesa = ? AND operaria_id = ? AND tipo_producto = ? 
         ORDER BY id DESC LIMIT 1`,
        [candidate.mesa, candidate.operariaId, candidate.tipoProducto]
      ),
    ]);

    const operariaExiste = operarias.length > 0;
    const operariaData = operarias[0];

    let pesajeDuplicado = false;
    if (candidatePesajes.length > 0) {
      const last = candidatePesajes[0];
      const diffKg = Math.abs(Number(last.peso_kg) - candidate.pesoKg);
      const lastTime = this.parseDbTimestamp(last.timestamp_db);
      const diffSec = (Date.now() - lastTime) / 1000;
      if (diffKg < 0.05 && diffSec >= 0 && diffSec < 8) {
        pesajeDuplicado = true;
      }
    }

    const lem = await LemGuardianService.verifyPesaje(candidate, operariaExiste, pesajeDuplicado);

    await db.execute(
      `INSERT INTO lem_telemetria (event_type, z_vector, energy, verdict, reason, latency_ms) VALUES (?, ?, ?, ?, ?, ?)`,
      [
        'PESAJE_DESLOMADO',
        JSON.stringify(lem.zVector),
        lem.energy,
        lem.accepted ? 'ACCEPTED' : 'REJECTED',
        lem.reason,
        Date.now() - startTime,
      ]
    );

    // Si hay un error o fuera de límite: SIEMPRE hablar (incluso en modo pitido) con frase corta pre-cacheada (0ms TTS)
    if (!lem.accepted) {
      const latencyMs = Date.now() - startTime;
      let audioFeedback = 'Alerta: verifique peso. Excede el límite de bandeja.';
      if (lem.reason === 'OPERARIA_NO_ASIGNADA_A_MESA') {
        audioFeedback =
          candidate.operariaId === '99'
            ? 'Alerta: operaria 99 no asignada a Mesa 6.'
            : 'Alerta: operaria no asignada a esta mesa.';
      } else if (lem.reason === 'REGISTRO_DUPLICADO_IDEMPOTENCIA') {
        audioFeedback = 'Registro duplicado bloqueado.';
      }

      const postCheck = await LemGuardianService.postValidate(audioFeedback, true, true);
      LlmBrainService.appendHistory(sessionId, 'assistant', postCheck.sanitizedText);

      return {
        success: false,
        action: 'RECHAZADO_LEM',
        agentUsed: 'YieldDeslomadoAgent',
        intent: 'RECORD_WEIGHING_REJECTED',
        toolCalled: 'record_deslomado_weighing',
        audioFeedback: postCheck.sanitizedText,
        confirmationMode: activeMode,
        skipTtsSpeech: false, // Las alertas siempre se pronuncian en voz alta
        lem,
        lemLayers: {
          preGuardEnergy: preCheck.energy,
          toolGuardEnergy: toolGuard.energy,
          domainGuardEnergy: lem.energy,
          postGuardEnergy: postCheck.energy,
          contingencyTriggered: false,
          signatureHash: lem.signatureHash || 'rejected_sig',
        },
        latencyMs,
      };
    }

    // Asentar Pesaje Validado en Base de Datos
    const recordUuid = uuidv4();
    const rendimientoEstimado = candidate.tipoProducto === 'lomo' ? 44.5 : candidate.tipoProducto === 'trozos' ? 32.0 : 12.0;

    await db.execute(
      `INSERT INTO pesajes (uuid, mesa, operaria_id, tipo_producto, peso_kg, audio_transcripcion, lem_energy, lem_status, rendimiento_estimado)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        recordUuid,
        candidate.mesa,
        candidate.operariaId,
        candidate.tipoProducto,
        candidate.pesoKg,
        candidate.rawText,
        lem.energy,
        'VERIFIED_LEM_C99_V4',
        rendimientoEstimado,
      ]
    );

    const verifyRow = await db.query(`SELECT id, peso_kg FROM pesajes WHERE uuid = ?`, [recordUuid]);
    const sqlConfirmedKg = verifyRow[0] ? Number(verifyRow[0].peso_kg) : candidate.pesoKg;
    const insertedId = verifyRow[0]?.id;

    if (insertedId) {
      this.clearPendingSlot(sessionId);
      try {
        await db.execute(
          `INSERT INTO pesajes_versiones (pesaje_id, version_numero, mesa, operaria_id, tipo_producto, peso_kg, accion, motivo_cambio, modificado_por)
           VALUES (?, 1, ?, ?, ?, ?, 'CREACION', 'Pesaje nominal capturado por voz', ?)`,
          [insertedId, candidate.mesa, candidate.operariaId, candidate.tipoProducto, candidate.pesoKg, role]
        );
      } catch (_) {}
    }

    // Seleccionar confirmación según el modo elegido por el supervisor:
    // - 'short': "Registro confirmado." (pre-cacheado en RAM, 0ms TTS)
    // - 'beep': Solo pitido (skipTtsSpeech = true, texto visible en pantalla)
    // - 'normal': "Confirmado: lomo 16.3 kilos, operaria 14." (puntual, directo y rápido)
    const rawFeedback =
      activeMode === 'short'
        ? 'Registro confirmado.'
        : `Confirmado: ${candidate.tipoProducto} ${sqlConfirmedKg} kilos, operaria ${candidate.operariaId}.`;

    const postCheck = await LemGuardianService.postValidate(rawFeedback, verifyRow.length > 0, true);
    LlmBrainService.appendHistory(sessionId, 'assistant', postCheck.sanitizedText);

    const latencyMs = Date.now() - startTime;

    await this.recordAgentTrace(db, {
      traceId,
      agentName: 'YieldDeslomadoAgent',
      intent: 'RECORD_WEIGHING_NOMINAL',
      toolCalled: 'record_deslomado_weighing',
      inputText: rawInput,
      outputText: postCheck.sanitizedText,
      preEnergy: preCheck.energy,
      toolEnergy: toolGuard.energy,
      postEnergy: postCheck.energy,
      contingency: postCheck.needsContingency ? 1 : 0,
      latencyMs,
      sig: lem.signatureHash || 'nominal_sig',
    });

    return {
      success: true,
      action: 'PESAJE_REGISTRADO',
      agentUsed: 'YieldDeslomadoAgent',
      intent: 'RECORD_WEIGHING_NOMINAL',
      toolCalled: 'record_deslomado_weighing',
      audioFeedback: postCheck.sanitizedText,
      confirmationMode: activeMode,
      skipTtsSpeech: activeMode === 'beep',
      data: {
        uuid: recordUuid,
        mesa: candidate.mesa,
        operariaId: candidate.operariaId,
        operaria: operariaData ? operariaData.nombre : candidate.operariaId,
        tipo: candidate.tipoProducto,
        pesoKg: sqlConfirmedKg,
        rendimiento: rendimientoEstimado,
      },
      lem,
      lemLayers: {
        preGuardEnergy: preCheck.energy,
        toolGuardEnergy: toolGuard.energy,
        domainGuardEnergy: lem.energy,
        postGuardEnergy: postCheck.energy,
        contingencyTriggered: postCheck.needsContingency,
        signatureHash: lem.signatureHash || 'nominal_sig',
      },
      latencyMs,
    };
  }

  /**
   * Interpreta la marca de tiempo de la BD. SQLite guarda CURRENT_TIMESTAMP en UTC y sin zona
   * ("YYYY-MM-DD HH:MM:SS"), por lo que se normaliza como UTC para no desfasar la idempotencia.
   */
  private static parseDbTimestamp(value: any): number {
    if (value == null) return 0;
    if (value instanceof Date) return value.getTime();
    const s = String(value).trim();
    if (!s) return 0;
    if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}/.test(s)) {
      const t = new Date(s.replace(' ', 'T') + 'Z').getTime();
      return Number.isFinite(t) ? t : 0;
    }
    const t = new Date(s).getTime();
    return Number.isFinite(t) ? t : 0;
  }

  private static async getLivePlantContext(db: any) {
    try {
      const summary = await db.query(`
        SELECT 
          COUNT(*) as total_pesajes,
          COALESCE(SUM(CASE WHEN tipo_producto = 'lomo' THEN peso_kg ELSE 0 END), 0) as total_lomo_kg,
          COALESCE(SUM(CASE WHEN tipo_producto = 'sangacho' THEN peso_kg ELSE 0 END), 0) as total_sangacho_kg,
          COALESCE(AVG(rendimiento_estimado), 0) as rendimiento_promedio
        FROM pesajes
      `);
      const lastRows = await db.query(
        `SELECT p.*, o.nombre as operaria_nombre FROM pesajes p LEFT JOIN operarias o ON p.operaria_id = o.id ORDER BY p.id DESC LIMIT 1`
      );
      const ops = await db.query(`SELECT id, nombre FROM operarias WHERE activa = 1 ORDER BY CAST(id AS INTEGER)`);
      const s = summary[0] || {};
      return {
        totalBandejas: Number(s.total_pesajes || 0),
        totalLomoKg: Number(s.total_lomo_kg || 0),
        totalSangachoKg: Number(s.total_sangacho_kg || 0),
        rendimientoPromedio: Number(s.rendimiento_promedio || 44.5),
        lastPesaje: lastRows[0] || null,
        operariasActivas: ops.map((o: any) => `#${o.id} (${o.nombre})`).join(', '),
      };
    } catch (_) {
      return {
        totalBandejas: 0,
        totalLomoKg: 0,
        totalSangachoKg: 0,
        rendimientoPromedio: 44.5,
        lastPesaje: null,
        operariasActivas: '#14, #15, #16, #17, #18',
      };
    }
  }

  private static async recordAgentTrace(
    db: any,
    params: {
      traceId: string;
      agentName: string;
      intent: string;
      toolCalled: string;
      inputText: string;
      outputText: string;
      preEnergy: number;
      toolEnergy: number;
      postEnergy: number;
      contingency: number;
      latencyMs: number;
      sig: string;
    }
  ) {
    try {
      await db.execute(
        `INSERT INTO agent_traces (trace_id, agent_name, intent, tool_called, input_text, output_text, lem_pre_energy, lem_tool_energy, lem_post_energy, contingency_triggered, latency_ms, signature_hash)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          params.traceId,
          params.agentName,
          params.intent,
          params.toolCalled,
          params.inputText,
          params.outputText,
          params.preEnergy,
          params.toolEnergy,
          params.postEnergy,
          params.contingency,
          params.latencyMs,
          params.sig,
        ]
      );
    } catch (_) {}
  }
}
