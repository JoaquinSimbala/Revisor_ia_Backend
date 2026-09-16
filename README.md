# Revisor IA - Backend Relay & Orquestador LLM

Servidor WebSocket stateless (Zero Storage en memoria RAM) para el sistema de asistencia en tiempo real **Revisor IA**.

## Características
- **Zero Storage**: Map en memoria RAM efímera. Destrucción de salas al desconectar.
- **WebSockets (Socket.io)**: Comunicación de baja latencia entre la laptop (CLI) y el móvil (Web App).
- **Google Gemini LLM**: Inferencia con Gemini 2.5 Flash con esquema JSON forzado (`explanation`, `replacement_code`, `compatibility_notes`).
- **GitHub Context**: Inspección del árbol de archivos del repositorio mediante REST API.

## Variables de Entorno (.env)
```env
PORT=3000
GEMINI_API_KEY=tu_clave_gemini
GITHUB_TOKEN=tu_token_opcional
```

## Despliegue en Render (Web Service)
- **Runtime**: Node
- **Build Command**: `npm install`
- **Start Command**: `npm start`
- **Environment Variables**:
  - `PORT`: `10000`
  - `GEMINI_API_KEY`: *(tu clave)*
