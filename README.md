# 🐟 Tecopesca AI-OS — Plataforma Industrial Multi-Agente, Voz en Tiempo Real & Guardián LEM C99

Sistema Operativo Industrial Agéntico **Zero-UI / Realtime Call** para Captura de Datos por Voz en Planta, Control de Inocuidad HACCP y Torre de Control Ejecutiva por WhatsApp, diseñado para **Tecopesca C.A. (Grupo Corporativo Visión — Manta)** según la [Propuesta Técnica Confidencial](file:///Users/jonnathan/AI_LAB-WLT/POC-PescaAI/Propuesta_Prueba_de_Concepto_AI_OS_Tecopesca.pdf).

---

## 🏗️ Arquitectura de Grado Industrial (100% Determinista & Segura)

### 1. Interfaz Neuronal de Llamada en Tiempo Real (GPT-4o Modern Voice UI)
- **Orbe Neuronal de Partículas y Sinapsis (`Canvas 2D` + `Web Audio API`):**
  - 135 partículas distribuidas en 3 anillos concéntricos con filamentos sinápticos dinámicos que pulsan y se deforman en tiempo real siguiendo el espectro de frecuencias (`AnalyserNode` FFT de 256 bins) tanto del micrófono del supervisor como de la voz sintetizada del agente.
  - **Estados cromáticos deterministas:**
    - `LISTENING` (Cian Eléctrico): Captura activa de voz con supresión de ruido industrial.
    - `THINKING` (Ámbar / Púrpura): Evaluación en Silicio C99 LEM + enrutamiento Multi-Agente.
    - `SPEAKING` (Magenta / Violeta): Locución neural activa sincronizada con las ondas de audio de **Kokoro TTS (`ef_dora`)**.
    - `REJECTED` (Rojo Alerta): Bloqueo inmediato `fail-closed` ante violación de invariantes físicas o de seguridad.
- **Doble Modo de Operación en Planta:**
  - **Modo Llamada en Vivo Manos Libres (VAD Automático):** Detección automática de actividad de voz y silencios para operar con guantes húmedos sin tocar la pantalla.
  - **Modo Push-to-Talk (PTT):** Captura instantánea por presión o toque directo sobre la neurona.
- **Streaming WebSocket (`ws://localhost:4000/ws/voice`):** Comunicación full-duplex de ultra baja latencia para envío de chunks de audio y recepción inmediata de resultados + audio neural.

---

### 2. Voz a Texto (Whisper Neural STT) y Texto a Voz (Kokoro-82M `ef_dora`)
- **STT (Voz a Texto Adaptado a Manta):**
  - Integrado con el motor dedicado de **MediaSuite (`https://media.weblifetech.com/api/micro/audio/transcribe` y `/api/external/transcribe`)** en modo `fast_mode=true` (greedy decoding de baja latencia).
  - **Normalizador Fonético Industrial (`applyIndustrialPhoneticCorrection`):** Corrige automáticamente distorsiones acústicas por ruido de planta (85–90 dB) y jerga atunera manabita (*"san gacho" → "sangacho"*, *"operaría" → "operaria"*, *"van deja" → "bandeja"*, *"auto clave" → "autoclave"*).
- **TTS (Texto a Voz Neural con Kokoro-82M):**
  - Conectado a **`https://media.weblifetech.com/api/tts/speak`** utilizando la voz femenina latina en español **`ef_dora`** (`Dora - Kokoro ES Expresiva y Natural`).
  - **Caché Determinista L1 (RAM) + L2 (Disco `tts_cache/`):** Pre-calienta las locuciones operativas frecuentes de planta para entregar audio neural en **< 2 ms** en confirmaciones recurrentes.

---

### 3. Sistema Multi-Agente Especializado (`MultiAgentOrchestrator`)
El orquestador clasifica de forma 100% determinista cada comando y delega la ejecución a 4 sub-agentes especializados:
1. **`YieldDeslomadoAgent`:** Captura de pesaje de bandejas en mesa (`lomo`, `sangacho`, `trozos`), cálculo de rendimiento de biomasa y validación de asignación activa de operarias.
2. **`HaccpThermalQualityAgent`:** Registro y auditoría de puntos críticos de control HACCP (Temperatura de esterilización en autoclaves `115°C–122°C`, Temperatura en espina / cadena de frío, y partes por millón de Histamina `< 25 ppm`).
3. **`MaintenanceOEEAgent`:** Registro inmediato de paradas de línea, cálculo de impacto OEE y despacho automático de alertas críticas por WhatsApp en `< 5 segundos`.
4. **`ExecutiveControlTowerAgent`:** Consultas gerenciales por voz o WhatsApp en tiempo real con consolidación matemática verificada contra SQL.

---

### 4. Blindaje Integral LEM en 5 Capas (`liblemops` + `liblemv4` en Silicio C99)
Siguiendo exactamente el estándar de gobernanza de `aigovcorex` y `lemnis-sentinel`, el proyecto enlaza directamente los binarios estáticos C99 (`liblemops_macos.a` y `liblemv4_macos.a`) en el worker nativo [`lib/lem_worker.c`](file:///Users/jonnathan/AI_LAB-WLT/POC-PescaAI/lib/lem_worker.c):
1. **Capa 1 — `LEM Pre-Guard` (`lem_v4_pre_guard`):** Bloquea en `< 1 ms` ataques de Prompt Injection, SQL Injection (`DROP`, `UNION SELECT`), XSS, Path Traversal y desbordamientos antes de ejecutar cualquier lógica.
2. **Capa 2 — `LEM Tool-Guard` (`gov_action_guard_v1`):** Verifica permisos RBAC por rol (`supervisor`, `directivo`, `admin`), alcance de estación y completitud de parámetros antes de invocar cualquier herramienta de escritura.
3. **Capa 3 — `LEM Physical & Biological Guard` (`tecopesca_deslomado_v1` / `tecopesca_haccp_thermal_v1`):** Evalúa el vector de estado $z \in \mathbb{R}^{16}$ contra el tensor de calibración $S \in \mathbb{R}^{128}$ en C99 (~300 µs). Rechaza de forma `fail-closed` ($E \ge 0.20$) pesos fuera de rango biológico (`<= 0.5 kg` o `> 24.0 kg`), operarias no asignadas a la mesa, registros duplicados por idempotencia (< 8s) o desviaciones térmicas/histamina HACCP.
4. **Capa 4 — `LEM Post-Guard` (`lem_v4_post_guard`):** Enmascara datos sensibles (cédulas/teléfonos) en roles no privilegiados y bloquea patrones inseguros en la respuesta de salida.
5. **Capa 5 — `SQL Contingency Verification`:** Comprueba que toda cifra numérica emitida por los agentes coincida exactamente con el registro asentado en la base de datos SQL (Cero Alucinación Numérica) y firma cada transacción con un hash `SHA-256`.

---

## 🚀 Puesta en Marcha y Verificación

```bash
# 1. Compilar TypeScript y copiar activos web
npm run build

# 2. Ejecutar suite de simulación Multi-Agente + Silicio C99 LEM + Kokoro TTS
npm run test:sim

# 3. Iniciar servidor en producción/desarrollo (Puerto 4000)
npm run dev
```
