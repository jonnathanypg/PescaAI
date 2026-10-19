#!/bin/bash
set -e

# ══════════════════════════════════════════════════════════════
# 🐟 Pesca AI OS — Script Maestro de Despliegue en VPS (Producción)
# Con PM2, Nginx Reverse Proxy, WebSockets 24/7 y Guardián C99 LEM
# ══════════════════════════════════════════════════════════════

echo "══════════════════════════════════════════════════════════════"
echo "🚀 INICIANDO DESPLIEGUE EN PRODUCCIÓN: PESCA AI"
echo "Sistema Operativo Pesquero y de Operaciones Industriales"
echo "══════════════════════════════════════════════════════════════"

export PATH=$PATH:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin
export NVM_DIR="$HOME/.nvm"

set +e
if [ -s "$NVM_DIR/nvm.sh" ]; then
    . "$NVM_DIR/nvm.sh"
fi

if [ -f "$HOME/.bashrc" ]; then
    source "$HOME/.bashrc"
fi

if [ -n "$(type -t nvm)" ]; then
    nvm use default 2>/dev/null || nvm use 20 2>/dev/null || nvm use 18 2>/dev/null || true
fi
set -e

echo "🟢 Node: $(node -v 2>/dev/null || echo 'No detectado')"
echo "🟢 NPM:  $(npm -v 2>/dev/null || echo 'No detectado')"

if ! command -v pm2 &> /dev/null; then
    echo "⚙️ Instalando PM2 globalmente..."
    npm install -g pm2
fi

ROOT_DIR="$(pwd)"

# 1. Compilación del Worker C99 de LEM Guardian
echo ""
echo "🛡️ Compilando Worker Nativo C99 LEM en Linux..."
mkdir -p "$ROOT_DIR/lib"
if [ -f "$ROOT_DIR/lib/lem_worker.c" ]; then
    gcc -O3 -std=c99 "$ROOT_DIR/lib/lem_worker.c" -o "$ROOT_DIR/lib/lem_worker_bin" -lm || echo "⚠️ Fallback determinista en TS activo"
fi

# 2. Instalación de dependencias y Build de TypeScript
echo ""
echo "📦 Instalando dependencias de Node.js..."
npm install --production=false

echo "⚙️ Compilando TypeScript a dist/..."
npm run build

# 3. Configuración Nginx para Dominio y WebSockets
echo ""
echo "🌐 Configurando Nginx Reverse Proxy..."
if [ -d "/etc/nginx/sites-available" ]; then
    cp "$ROOT_DIR/nginx/pescaai.conf" /etc/nginx/sites-available/pescaai.conf
    ln -sf /etc/nginx/sites-available/pescaai.conf /etc/nginx/sites-enabled/pescaai.conf
    nginx -t && systemctl reload nginx || echo "⚠️ Verifique la recarga de Nginx manualmente"
fi

# 4. Orquestación y Recarga con PM2
echo ""
echo "🔄 Orquestando servicios con PM2 Ecosystem..."
pm2 reload ecosystem.config.js --update-env 2>/dev/null || pm2 start ecosystem.config.js
pm2 save

echo ""
echo "📊 Estado de los procesos:"
pm2 status | grep -E "pescaai|App name|id" || pm2 status

# 5. Verificación de Salud
echo ""
echo "🔍 Verificando salud del servidor..."
sleep 2
STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:4000/api/stats || echo "000")
if [ "$STATUS" -eq 200 ]; then
    echo "✅ Pesca AI activo y respondiendo en el puerto 4000"
else
    echo "⚠️ Código de respuesta HTTP: $STATUS. Verifique con: pm2 logs pescaai-server"
fi

echo ""
echo "══════════════════════════════════════════════════════════════"
echo "✅ ¡DESPLIEGUE DE PESCA AI COMPLETADO CON ÉXITO!"
echo "══════════════════════════════════════════════════════════════"
