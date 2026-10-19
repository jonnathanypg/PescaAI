import { PesajeCandidate } from './lem.service';
import { WhisperService } from './whisper.service';

export class VoiceParserService {
  /**
   * Interpreta dictados naturales e industriales como:
   * - "Mesa 6, operaria 14, bandeja lomo 16 kilos 300 gramos"
   * - "Mesa seis operaria 14 lomo 15.8 kilos"
   * - "Mesa 6 sangacho operaria 15 12 kilos 400 gramos"
   * - "Parada de línea en mesa 6 por fallo de cinta transportadora 10 minutos"
   * - "Control HACCP autoclave 2 temperatura 118.5 grados cuba 4"
   * - "Histamina cuba 4 12 ppm"
   * - "Cuál es el resumen de producción / rendimiento de la mesa 6"
   */
  static parseVoiceCommand(text: string): PesajeCandidate {
    const corrected = WhisperService.applyIndustrialPhoneticCorrection(text);
    const raw = corrected.toLowerCase().trim();

    // 0. Detectar cambio de modo de confirmación por voz (Silencioso/Pitido vs Corto vs Completo)
    if (
      raw.includes('sin confirmación') ||
      raw.includes('sin confirmacion') ||
      raw.includes('solo pitido') ||
      raw.includes('modo silencioso') ||
      raw.includes('sin hablar') ||
      raw.includes('no hables')
    ) {
      return {
        mesa: 6,
        operariaId: '0',
        tipoProducto: 'lomo',
        pesoKg: 0,
        esCambioModoConfirmacion: true,
        nuevoModoConfirmacion: 'beep',
        rawText: text,
      };
    }

    if (
      raw.includes('solo dime confirmado') ||
      raw.includes('solo di confirmado') ||
      raw.includes('modo corto') ||
      raw.includes('confirmación corta') ||
      raw.includes('confirmacion corta') ||
      raw.includes('solo confirmado')
    ) {
      return {
        mesa: 6,
        operariaId: '0',
        tipoProducto: 'lomo',
        pesoKg: 0,
        esCambioModoConfirmacion: true,
        nuevoModoConfirmacion: 'short',
        rawText: text,
      };
    }

    if (
      raw.includes('confirmación completa') ||
      raw.includes('confirmacion completa') ||
      raw.includes('modo normal') ||
      raw.includes('repite todo')
    ) {
      return {
        mesa: 6,
        operariaId: '0',
        tipoProducto: 'lomo',
        pesoKg: 0,
        esCambioModoConfirmacion: true,
        nuevoModoConfirmacion: 'normal',
        rawText: text,
      };
    }

    // 1. Detectar si es Consulta Ejecutiva / Directiva Directa por Voz (sin pregunta de opinión/asesoría)
    const isAdvisoryQuestion =
      raw.includes('recomienda') ||
      raw.includes('opinas') ||
      raw.includes('por qué') ||
      raw.includes('porque') ||
      raw.includes('consejo') ||
      raw.includes('seco') ||
      raw.includes('observa');

    if (
      !isAdvisoryQuestion &&
      (raw.includes('resumen') ||
        raw.includes('reporte') ||
        raw.includes('cuánto') ||
        raw.includes('cuanto') ||
        raw.includes('balance') ||
        raw.includes('rendimiento') ||
        raw.includes('estado de planta') ||
        raw.startsWith('cómo va') ||
        raw.startsWith('como va'))
    ) {
      let tipoConsulta = 'RESUMEN_GENERAL';
      const opQuery = raw.match(/(?:operaria|operario|ficha)\s*(\d+|catorce|quince|dieciseis|diecisiete|dieciocho|diecinueve|veinte)/i);
      if (opQuery) {
        tipoConsulta = `OPERARIA_${this.normalizeNumber(opQuery[1])}`;
      } else if (raw.includes('parada') || raw.includes('incidencia')) {
        tipoConsulta = 'PARADAS_LINEA';
      } else if (raw.includes('haccp') || raw.includes('calidad') || raw.includes('autoclave')) {
        tipoConsulta = 'CALIDAD_HACCP';
      }

      return {
        mesa: 6,
        operariaId: '0',
        tipoProducto: 'lomo',
        pesoKg: 0,
        esConsultaDirectiva: true,
        tipoConsulta,
        rawText: text,
      };
    }

    // 1.5. Detectar si es Corrección del Último Pesaje ("perdón, corrige a 15.8 kilos", "no, eran 16.2 kilos")
    const isCorrection =
      raw.includes('corrig') ||
      raw.includes('corrección') ||
      raw.includes('correccion') ||
      raw.includes('equivoc') ||
      raw.includes('cambia el último') ||
      raw.includes('cambia el ultimo') ||
      raw.includes('modific') ||
      ((raw.startsWith('perdón') || raw.startsWith('perdon') || raw.startsWith('no,') || raw.startsWith('no eran')) &&
        (raw.includes('kilo') || raw.includes('kg') || /\d+[.,]\d+/.test(raw)));

    if (isCorrection) {
      let pesoKg = 0;
      const kiloGramoMatch = raw.match(
        /(\d+(?:[.,]\d+)?)\s*(?:kilos?|kg|k)\s*(?:con|y)?\s*(\d+)?\s*(?:gramos?|gr|g)?/i
      );
      if (kiloGramoMatch) {
        const kilos = parseFloat(kiloGramoMatch[1].replace(',', '.'));
        const gramos = kiloGramoMatch[2] ? parseFloat(kiloGramoMatch[2]) : 0;
        pesoKg = kilos + (gramos > 0 ? (gramos < 10 ? gramos / 10 : gramos / 1000) : 0);
      } else {
        const numMatch = raw.match(/(\d{1,2}(?:[.,]\d{1,3})?)/);
        if (numMatch) pesoKg = parseFloat(numMatch[1].replace(',', '.'));
      }

      let tipoProducto: 'lomo' | 'sangacho' | 'trozos' = 'lomo';
      if (raw.includes('sangacho') || raw.includes('negro')) tipoProducto = 'sangacho';
      else if (raw.includes('trozo')) tipoProducto = 'trozos';

      return {
        mesa: 6,
        operariaId: '14',
        tipoProducto,
        pesoKg: Number(pesoKg.toFixed(3)),
        esCorreccionPesaje: true,
        rawText: text,
      };
    }

    // 2. Detectar si es Control de Calidad HACCP / Cadena Térmica / Autoclave
    if (
      raw.includes('haccp') ||
      raw.includes('autoclave') ||
      raw.includes('temperatura') ||
      raw.includes('histamina') ||
      raw.includes('espina') ||
      raw.includes('esterilizacion') ||
      raw.includes('esterilización')
    ) {
      const mesaMatch = raw.match(/mesa\s*(\d+|seis|uno|dos|tres|cuatro|cinco)/i);
      const mesa = mesaMatch ? this.normalizeNumber(mesaMatch[1]) : 6;

      const cubaMatch = raw.match(/cuba\s*(\d+)/i);
      const loteCuba = cubaMatch ? `CUBA-0${cubaMatch[1]}` : 'CUBA-04';

      let parametroHaccp: 'TEMPERATURA_AUTOCLAVE' | 'TEMPERATURA_ESPINA' | 'HISTAMINA' | 'ORGANOLEPTICO' =
        'TEMPERATURA_AUTOCLAVE';
      let unidadHaccp = '°C';

      if (raw.includes('histamina')) {
        parametroHaccp = 'HISTAMINA';
        unidadHaccp = 'ppm';
      } else if (raw.includes('espina') || raw.includes('frío') || raw.includes('frio')) {
        parametroHaccp = 'TEMPERATURA_ESPINA';
        unidadHaccp = '°C';
      }

      // Extraer el valor numérico medido (ej. 118.5 grados o 12 ppm)
      const valMatch =
        raw.match(/(\d+(?:[.,]\d+)?)\s*(?:grados|°c|c\b|ppm|partes)/i) ||
        raw.match(/(?:temperatura|histamina|valor)\s*(?:de\s*)?(\d+(?:[.,]\d+)?)/i) ||
        raw.match(/\b(\d{2,3}(?:[.,]\d+)?)\b/);

      const valorHaccp = valMatch ? parseFloat(valMatch[1].replace(',', '.')) : 118.0;

      return {
        mesa,
        operariaId: '0',
        tipoProducto: 'lomo',
        pesoKg: 0,
        esHaccp: true,
        parametroHaccp,
        valorHaccp,
        unidadHaccp,
        loteCuba,
        rawText: text,
      };
    }

    // 3. Detectar si es Parada de Línea / Mantenimiento
    if (
      raw.includes('parada') ||
      raw.includes('paro') ||
      raw.includes('detenida') ||
      raw.includes('falla') ||
      raw.includes('fallo') ||
      raw.includes('atorada') ||
      raw.includes('mantenimiento')
    ) {
      const mesaMatch = raw.match(/mesa\s*(\d+|seis|uno|dos|tres|cuatro|cinco)/i);
      const mesa = mesaMatch ? this.normalizeNumber(mesaMatch[1]) : 6;

      const tiempoMatch = raw.match(/(\d+|cinco|diez|quince|veinte)\s*(min|minuto|minutos)/i);
      const tiempo = tiempoMatch ? this.normalizeNumber(tiempoMatch[1]) : 5;

      return {
        mesa,
        operariaId: '0',
        tipoProducto: 'lomo',
        pesoKg: 0,
        esParadaLinea: true,
        motivoParada: text,
        tiempoParadaMin: tiempo,
        rawText: text,
      };
    }

    // 4. Extraer Mesa (Pesaje de Deslomado)
    let mesa = 6;
    const mesaMatch = raw.match(/mesa\s*(\d+|seis|uno|dos|tres|cuatro|cinco|siete|ocho)/i);
    if (mesaMatch) {
      mesa = this.normalizeNumber(mesaMatch[1]);
    }

    // 5. Extraer Operaria
    let operariaId = '14';
    const opMatch = raw.match(
      /(?:operaria|operario|ficha|trabajadora|codigo|código)\s*(\d+|catorce|quince|dieciseis|dieciséis|diecisiete|dieciocho|diecinueve|veinte|veintiuno|veintidos|veintitres)/i
    );
    if (opMatch) {
      operariaId = String(this.normalizeNumber(opMatch[1]));
    } else {
      const generalNum = raw.match(/\b(1[4-9]|2[0-3]|99)\b/);
      if (generalNum) {
        operariaId = generalNum[1];
      }
    }

    // 6. Extraer Tipo de Producto (lomo vs sangacho vs trozos)
    let tipoProducto: 'lomo' | 'sangacho' | 'trozos' = 'lomo';
    if (raw.includes('sangacho') || raw.includes('negro') || raw.includes('oscuro')) {
      tipoProducto = 'sangacho';
    } else if (raw.includes('trozo') || raw.includes('picadillo') || raw.includes('flake')) {
      tipoProducto = 'trozos';
    }

    // 7. Extraer Peso en Kilos y Gramos
    let pesoKg = 0;

    // Patrón A: "16 kilos 300 gramos" o "16 kg 300 g" o "16 kilos con 300"
    const kiloGramoMatch = raw.match(
      /(\d+(?:[.,]\d+)?)\s*(?:kilos?|kg|k)\s*(?:con|y)?\s*(\d+)?\s*(?:gramos?|gr|g)?/i
    );
    if (kiloGramoMatch) {
      const kilos = parseFloat(kiloGramoMatch[1].replace(',', '.'));
      const gramos = kiloGramoMatch[2] ? parseFloat(kiloGramoMatch[2]) : 0;
      pesoKg = kilos + (gramos > 0 ? (gramos < 10 ? gramos / 10 : gramos / 1000) : 0);
    } else {
      // Patrón B: "16.3 kilos" o "16 punto 3"
      const decimalMatch = raw.match(/(\d+)\s*(?:punto|coma|\.)\s*(\d+)\s*(?:kilos?|kg)?/i);
      if (decimalMatch) {
        pesoKg = parseFloat(`${decimalMatch[1]}.${decimalMatch[2]}`);
      } else {
        // Patrón C: Solo número o palabra numérica antes de kilos ("40 kilos", "cuarenta kilos")
        const simpleMatch = raw.match(/(\d+(?:[.,]\d+)?)\s*(?:kilos?|kg)/i);
        if (simpleMatch) {
          pesoKg = parseFloat(simpleMatch[1].replace(',', '.'));
        } else {
          const wordKiloMatch = raw.match(
            /\b(uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|trece|catorce|quince|dieciseis|dieciséis|diecisiete|dieciocho|diecinueve|veinte|veintiuno|veintidos|veintitres|veinticuatro|veinticinco|treinta|cuarenta|cincuenta|sesenta|setenta|ochenta|noventa|cien)\s*(?:kilos?|kg)/i
          );
          if (wordKiloMatch) {
            pesoKg = this.normalizeNumber(wordKiloMatch[1]);
          }
        }
      }
    }

    // Patrón D: "peso 40", "pesó 18.5", "bandeja de 15"
    if (pesoKg === 0) {
      const pesoExplicitMatch = raw.match(/(?:peso|pesó|pesaje|bandeja(?:\s+de)?)\s*(\d+(?:[.,]\d+)?)/i);
      if (pesoExplicitMatch) {
        pesoKg = parseFloat(pesoExplicitMatch[1].replace(',', '.'));
      }
    }

    // Fallback: números directos finales plausibles (ej: "16.300")
    if (pesoKg === 0) {
      const fallbackNum = raw.match(/(\d{1,2})[.,](\d{1,3})/);
      if (fallbackNum) {
        pesoKg = parseFloat(`${fallbackNum[1]}.${fallbackNum[2]}`);
      }
    }

    return {
      mesa,
      operariaId,
      tipoProducto,
      pesoKg: Number(pesoKg.toFixed(3)),
      esParadaLinea: false,
      rawText: text,
    };
  }

  private static normalizeNumber(token: string): number {
    const clean = token
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim();
    const map: Record<string, number> = {
      uno: 1,
      dos: 2,
      tres: 3,
      cuatro: 4,
      cinco: 5,
      seis: 6,
      siete: 7,
      ocho: 8,
      nueve: 9,
      diez: 10,
      once: 11,
      doce: 12,
      trece: 13,
      catorce: 14,
      quince: 15,
      dieciseis: 16,
      diecisiete: 17,
      dieciocho: 18,
      diecinueve: 19,
      veinte: 20,
      veintiuno: 21,
      veintidos: 22,
      veintitres: 23,
      veinticuatro: 24,
      veinticinco: 25,
      treinta: 30,
      cuarenta: 40,
      cincuenta: 50,
      sesenta: 60,
      setenta: 70,
      ochenta: 80,
      noventa: 90,
      cien: 100,
    };
    return map[clean] || parseInt(clean, 10) || 0;
  }
}
