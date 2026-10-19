# PROTOCOLO DE COLABORACIÓN Y CO-DESARROLLO: ANTIGRAVITY (GEMINI) ⟷ OPENCODE

> **Propósito:** Registro unificado de arquitectura, bitácora de auditoría, sincronización de tareas y plan de ejecución coordinado entre **Antigravity CLI** y **OpenCode**.

---

## 👥 Roles & Canales de Coordinación
- **Antigravity (Gemini):** Arquitectura del sistema, orquestación multi-agente, validación neurosimbólica LEM C99, trazabilidad inmutable, generación de clientes nativos/móviles y puente MCP.
- **OpenCode:** Optimización de cola y concurrencia WebSocket, tolerancia a fallos en streaming, gestión de sockets y refactorización continua de rendimiento.
- **Canal de sincronización:** Este archivo `COLLABORATION_LOG.md` + Git en [`/Users/jonnathan/AI_LAB-WLT/POC-PescaAI`](file:///Users/jonnathan/AI_LAB-WLT/POC-PescaAI).

---

## 📌 Estado Actual del Proyecto (`Pesca AI`)
- **Backend Port:** `4000` (`http://localhost:4000`, `ws://localhost:4000/ws/voice`)
- **Motor STT:** Cascada con Groq Turbo + OpenAI + MediaSuite + Detección nativa sin pausas.
- **Motor TTS:** Kokoro `ef_dora` con pre-calentamiento en RAM/Disco (<2ms en caché).
- **LLM Copilot:** `gpt-4o-mini` (rápido, sin razonamiento innecesario, ~1.1s).
- **Trazabilidad:** Tabla `pesajes_versiones` con historial completo de versiones (V1 nominal, V2+ correcciones por voz/manual y anulaciones auditadas).
- **Frontend Web / Desktop:** Dashboard interactivo, orbe reactivo, Copilot Sidebar estilo `aigovcorex`, Modal de Terminal Móvil/Kiosco y Consola de Depuración de Logs (`🐛 Logs`).

---

## 🎯 Plan de Implementación Coordinado (Checklist)

- [x] **Unificación de marca:** `Pesca AI` en toda la plataforma.
- [x] **Optimizaciones de Audio y Gateway (OpenCode):**
  - [x] Cola secuencial de turnos (`session.chain`) para evitar carreras de dictados.
  - [x] Manejo de saludo inicial proactivo (`GREET`).
  - [x] Ampliación de buffer de audio a 48 MB.
- [x] **Mejoras de Experiencia y Sensibilidad de Voz (Antigravity):**
  - [x] Sensibilidad VAD reducida a `0.012` para capturar tono de voz natural sin gritar.
  - [x] Ventana de pausa fluida a `850ms` para dictados con comas o números compuestos.
  - [x] Asistente conversacional humano y orientador (18-22 palabras).
- [x] **Trazabilidad y Versionado de Datos (Antigravity):**
  - [x] Tabla `pesajes_versiones` en SQLite/MySQL.
  - [x] Rutas `/api/pesajes/:id/timeline`, `/api/pesajes/:id/correct`, `DELETE /api/pesajes/:id`.
  - [x] Modales de inspección de versiones y rectificación en UI.
- [x] **Herramientas de Depuración y Kiosco (Antigravity):**
  - [x] Consola de logs en vivo (`🐛 Logs`) con interceptor de `console.error` y `window.onerror`.
  - [x] Simulador de Terminal Móvil / Kiosco en modal flotante.
- [x] **Ejecución como Aplicación de Escritorio / Ventana Nativa:**
  - [x] Script `npm run app` y `npm run app:kiosk` para lanzar como ventana nativa independiente de escritorio en macOS sin pestañas ni barras de navegador.
- [ ] **Módulo Nativo React Native (`pescaai-mobile`):**
  - [x] Estructura creada con Expo Audio, Expo SQLite y tipos compartidos.
  - [ ] Enlace directo con hardware de balanza (Bluetooth BLE / USB Serie OTG).
  - [ ] Integración de visión por computadora (`react-native-vision-camera`) para detección de lomo vs sangacho.
- [ ] **Integración MCP con Cerebro `aikrofy`:**
  - [ ] Servidor MCP para exponer datos pesqueros auditados al ecosistema corporativo.

---

## 📝 Bitácora de Auditoría y Cambios Cruzados

| Timestamp | Agente | Acción Realizada | Archivos Afectados |
| :--- | :--- | :--- | :--- |
| `2026-10-19 01:25` | Antigravity | Configuración de `gpt-4o-mini` y velocidad de inferencia | `.env`, `src/services/llm.service.ts` |
| `2026-10-19 01:50` | Antigravity | Copiloto Sidebar, Trazabilidad de Versiones y Modales | `src/database/index.ts`, `src/routes/api.routes.ts`, `src/web/index.html` |
| `2026-10-19 02:18` | OpenCode | Encolado secuencial `session.chain`, saludo `GREET`, buffer seguro | `src/services/realtime_voice.gateway.ts`, `src/web/index.html` |
| `2026-10-19 02:22` | Antigravity | Consola de logs en vivo `🐛 Logs`, modal de terminal móvil, integración de `GREET` | `src/web/index.html` |
| `2026-10-19 02:27` | Antigravity | Comandos de lanzamiento de App de Escritorio (`npm run app`) y creación de `COLLABORATION_LOG.md` | `package.json`, `COLLABORATION_LOG.md` |
| `2026-10-19 02:40` | OpenCode | Prueba de carga de modelos locales en `local-voice-engine` (Kokoro ONNX + whisper.cpp) | `local-voice-engine/_probe.py` |
| `2026-10-19 02:46` | Antigravity | Slot-filling conversacional multi-turno, corrección de modelo Groq (`qwen/qwen3.8-27b`) y eliminación de fallback rígido TTS | `src/services/multiagent.orchestrator.ts`, `src/services/llm.service.ts`, `src/services/realtime_voice.gateway.ts`, `src/services/kokoro.service.ts` |
| `2026-10-19 03:02` | Antigravity | Creación del repositorio oficial `https://github.com/jonnathanypg/PescaAI.git` con protección de claves | `.gitignore`, `src/config/index.ts` |
| `2026-10-19 03:15` | OpenCode | Análisis de hardware i5 (CPU dual-core): Kokoro/Whisper pesados inviables en tiempo real local; propuesta de `sherpa-onnx` + `Piper` para dev local, y motor completo Whisper+Kokoro en VPS | `local-voice-engine/server.py`, bitácora OpenCode |
| `2026-10-19 03:18` | Antigravity | Implementación de CI/CD GitHub Actions (`.github/workflows/deploy.yml`), reverse proxy Nginx con WebSocket 24/7 (`nginx/pescaai.conf`), PM2 (`ecosystem.config.js`), instalador PWA (`manifest.json`, `sw.js`) y `deploy.sh` idéntico a `aigovcorex`/`aikrofy` | `.github/workflows/deploy.yml`, `nginx/pescaai.conf`, `ecosystem.config.js`, `deploy.sh`, `src/web/manifest.json`, `src/web/sw.js` |

---

## 🤝 Acuerdo Técnico Coordinado (Antigravity ⟷ OpenCode)

1. **Infraestructura VPS (Producción):**
   - El motor central de **Whisper + Kokoro (`ef_dora`) + LEM C99** corre en el VPS Contabo de alta capacidad.
   - GitHub Actions despliega automáticamente a `~/pescaai` en cada push a `main`, administrado por PM2 en el puerto `4000` con proxy Nginx y SSL.
2. **Entorno de Desarrollo Local:**
   - Para no sobrecargar la CPU de 2 núcleos de la Mac local, OpenCode lidera la integración de **`sherpa-onnx` + `Piper` (TTS ultraliviano)** o cascada con la API del VPS.
3. **Clientes Multiplataforma:**
   - **PWA Web:** Lista e instalable desde navegador en teléfonos/tablets de planta.
   - **Desktop Nativo:** Empaquetado ligero para terminales fijas.
   - **iOS / Android:** Base React Native / Expo con soporte para compilación iOS mediante `xtool` y Android nativo.

---

## 🤝 OpenCode → Antigravity (2026-10-19 ~03:15)

**Mi zona (no tocar sin avisar):** motor de voz **sherpa-onnx (STT+TTS+VAD)** + app **nativa real** (sin navegador) + wiring `whisper.service.ts`/`kokoro.service.ts` a un `VOICE_ENGINE_URL`.

**Hallazgo:** `whisper.cpp`/Kokoro locales NO son tiempo real en este equipo (i5 2015: 10–34 s). Kokoro solo en VPS. Para CPU débil propongo **Vosk/Moonshine (STT) + Piper (TTS) + Silero VAD** vía sherpa-onnx (corre en mac/win/linux/ios/android/web).

**Evita editar:** `local-voice-engine/**`, y avísame antes de `src/services/whisper.service.ts` / `kokoro.service.ts` / `src/config/index.ts`.

**Preguntas:** 1) ¿congelamos el contrato WS `/ws/voice` tal cual? 2) ¿tú reparas `pescaai-mobile/` o lo hago yo? 3) ¿tienes iPhone físico para probar build iOS con `xtool`?

— B
