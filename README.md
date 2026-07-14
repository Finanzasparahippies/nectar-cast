# Néctar Cast 📡

Néctar Cast es una aplicación de escritorio multiplataforma e independiente diseñada para streamers y creadores de contenido que buscan transmitir simultáneamente a múltiples plataformas (multistreaming) como YouTube, Facebook, Twitch o Instagram. 

Está diseñada para ser **100% portable y local**, ejecutándose directamente en tu máquina sin servidores intermedios de pago. Logra duplicar la transmisión con **0% de consumo de CPU** en codificación mediante multiplexación directa de paquetes (*copy codec*).

---

## 🏗️ Arquitectura del Proyecto

Néctar Cast funciona como un monorepo distribuido en tres capas principales:

1. **Frontend (React + TS + Tailwind CSS v4):** Una interfaz de usuario moderna con estética *dark glassmorphism*. Muestra el estado del servidor, gestiona destinos de retransmisión, consolida la caja de chat unificada y ofrece controles de reproducción de voz.
2. **Backend (Tauri v2 + Rust):** Orquesta el ciclo de vida del motor de retransmisión, escanea y asigna puertos de manera dinámica para evitar colisiones, y empaqueta de forma hermética la app y los binarios asociados.
3. **Motor RTMP (Node-Media-Server + FFmpeg):** Escucha las conexiones de streaming de OBS, expone una API HTTP de control local (puerto `8001+`), y arranca subprocesos locales de FFmpeg que replican el video hacia las plataformas objetivo.

---

## ⚡ Requisitos Previos

Antes de compilar o ejecutar en modo de desarrollo, asegúrate de tener instalado:
* **Node.js (v18+)**
* **Rust & Cargo (v1.75+)**
* **Dependencias de desarrollo de WebKit/GTK** (para compilar en Linux/Fedora):
  ```bash
  sudo dnf install glib2-devel gtk3-devel webkit2gtk4.1-devel openssl-devel libappindicator-gtk3-devel librsvg2-devel
  ```

---

## 🚀 Inicio Rápido (Desarrollo)

### 1. Clonar e Instalar dependencias
Instala los módulos para el frontend y el motor de streaming:
```bash
# Entrar al directorio
cd nectar-cast

# Instalar dependencias del Frontend
npm install

# Instalar dependencias del Motor RTMP
cd rtmp-engine
npm install
cd ..
```

### 2. Descargar y Configurar Sidecars (Binarios)
El proyecto incluye un script automatizado para descargar el binario estático de FFmpeg de John Van Sickle y colocarlo en el directorio correspondiente para Tauri:
```bash
node scripts/setup-sidecars.cjs
```

### 3. Compilar el Motor de Streaming
Compila el código TypeScript del motor y empaquétalo en un binario autónomo portátil usando `pkg`:
```bash
cd rtmp-engine
npm run build && npm run package
cd ..
```

### 4. Lanzar la Aplicación en Desarrollo
Inicia la interfaz y compila el backend en Rust:
```bash
npm run tauri dev
```

---

## 🔌 Guía de Conexión de OBS Studio

Néctar Cast actúa como un servidor de transmisión local. Para conectarlo a tu OBS Studio:

1. Abre **OBS Studio**.
2. Ve a **Ajustes ➔ Emisión**.
3. En **Servicio**, selecciona **Personalizado**.
4. En **Servidor**, copia la dirección que te muestra la UI de Néctar Cast (por defecto: `rtmp://127.0.0.1:1935/live`).
5. En **Clave de retransmisión** (Stream Key), pon `test`.
6. Haz clic en **Aplicar** y **Aceptar**.
7. ¡Haz clic en **Iniciar Transmisión** en OBS!

Una vez que OBS esté transmitiendo localmente a Néctar Cast, el panel mostrará el stream entrante y habilitará los botones **Start** de tus plataformas agregadas.

---

## 💬 Chats en Vivo y TTS (Text-to-Speech)

Néctar Cast unifica los chats de YouTube, Facebook e Instagram en un solo feed visual interactivo:

* **Simulador de Chat:** Haz clic en **Simulate** en la columna de chat para iniciar una simulación de prueba con comentarios ficticios de diferentes redes.
* **Lector por Voz (TTS):** Haz clic en el ícono del altavoz (**Voz**) en la cabecera del chat. La aplicación utilizará la API nativa de síntesis de voz de tu sistema operativo para leer en voz alta los comentarios entrantes con voz nativa en español (`es-MX`) sin costo alguno y sin depender de servicios en la nube.
* **Integración Real:** Abre la configuración de chat (ícono de engranaje) y pega tus credenciales de API correspondientes (claves de API de YouTube, Tokens de Facebook Graph e Instagram). Las credenciales se almacenan localmente y de forma segura en el `localStorage` del cliente.

---

## ⚙️ Optimización de Transmisión (Bitrate)

Dado que Néctar Cast clona directamente el flujo original sin recodificar para ahorrar recursos, debes configurar tu OBS basándote en la **plataforma más restrictiva**:
* **YouTube:** Soporta hasta 9000 Kbps.
* **Instagram Live:** Limita las conexiones a un máximo aproximado de **3000-3500 Kbps**.
* **Recomendación:** Si transmites simultáneamente a YouTube e Instagram, configura la salida de video de tu OBS a **3500 Kbps**. Néctar Cast duplicará esta calidad de forma limpia y transparente a todas las plataformas.

---

## 🛠️ Empaquetado y Distribución

Para generar el instalador de producción optimizado para tu sistema operativo (.AppImage, .deb, .exe, etc.):
```bash
npm run tauri build
```
El instalador final se generará bajo `src-tauri/target/release/bundle/`.
