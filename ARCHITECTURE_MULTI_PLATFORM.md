# ARQUITECTURA PESCA AI: MULTI-PLATAFORMA (PWA + NATIVA + VPS)

> **Diseño Unificado:** Un único núcleo operativo pesquero con despliegue universal:
> 1. **VPS Cloud / Servidor Planta:** Inferencia pesada (Whisper, Kokoro ef_dora, LLM y LEM C99).
> 2. **Web / PWA:** Acceso universal inmediato desde cualquier dispositivo (tablet, móvil, escritorio) con Service Worker, Web Audio y Web Speech API.
> 3. **Desktop Nativo (Mac, Windows, Linux):** Tauri / Electron empaquetando la UI ultraligera y comunicándose por WebSocket local o remoto.
> 4. **Mobile Nativo (Android, iOS):** React Native / Expo (`pescaai-mobile`) con acceso a hardware (Bluetooth balanzas, micrófono directo, cámara OCR de bandejas).

---

## 🎙️ Estrategia Híbrida de Inferencia de Voz (Zero-Lag)

| Entorno | Reconocimiento (STT) | Síntesis (TTS) | Latencia Típica |
| :--- | :--- | :--- | :--- |
| **Entorno de Desarrollo Local** | Cascada: Browser Speech (0ms) + Groq Whisper Turbo (<300ms) | Pre-calentamiento RAM (43 locuciones operativas en 0ms) + Kokoro en VPS | **15 ms - 400 ms** |
| **PWA / Kiosco en Navegador** | Web Speech API nativo + Fallback WebSocket al VPS | Audio Web API pre-cacheado + Kokoro VPS streaming | **0 ms - 250 ms** |
| **VPS Cloud Dedicado (Tecopesca)** | Whisper Server (GPU / CPU multihilo) | Kokoro-82M API (`media.weblifetech.com`) | **180 ms - 500 ms** |
| **Nativo Offline de Emergencia** | Whisper.cpp (`tiny` o `base` cuantizado) | Locuciones MP3 pre-grabadas en el instalable + Web Speech | **0 ms de red** |

---

## 📦 Matriz de Entregables por Plataforma
- **PWA Web:** `manifest.json`, Service Worker offline, instalación PWA de un clic en Chrome/Safari/Edge.
- **Mac / Windows / Linux:** Ejecutable empaquetado autónomo conectable al backend o auto-contenido.
- **Android / iOS:** `pescaai-mobile` con Expo para operadores en línea de deslomado.
- **VPS Cloud:** Node.js + SQLite WAL / MySQL Staging + WebSocket Server 24/7.
