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
