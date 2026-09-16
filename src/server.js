/**
 * Server: Servidor HTTP + WebSockets (Socket.io) totalmente Stateless.
 * Orquestador en memoria RAM entre Laptop (CLI) y Móvil (Web App).
 */
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import fs from 'fs';
import { roomManager } from './roomManager.js';
import { githubService } from './githubService.js';
import { llmService } from './llmService.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  },
  pingTimeout: 60000, // Tolerancia a redes móviles y minimizado de pestañas
  pingInterval: 25000
});

const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Servir la Web App móvil solo si existe localmente (en producción el frontend está desacoplado)
const webPath = path.resolve(__dirname, '../../web');
if (fs.existsSync(webPath)) {
  app.use(express.static(webPath));
}

// Endpoint de estado y diagnóstico
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    activeRooms: roomManager.rooms.size,
    stateless: true,
    uptime: process.uptime()
  });
});

// Manejo de conexiones WebSocket
io.on('connection', (socket) => {
  console.log(`[Socket] Nueva conexión entrante: ${socket.id}`);

  /**
   * 1. El Frontend Móvil solicita crear una sala efímera
   */
  socket.on('create_room', ({ githubRepo = '' }, callback) => {
    try {
      const roomId = roomManager.createRoom(socket.id, githubRepo);
      socket.join(roomId);

      console.log(`[Room] Sala creada: ${roomId} para socket móvil ${socket.id} (Repo: ${githubRepo || 'N/A'})`);

      const response = {
        success: true,
        roomId,
        githubRepo
      };

      if (typeof callback === 'function') callback(response);
      socket.emit('room_created', response);
    } catch (err) {
      console.error('[Room] Error creando sala:', err);
      if (typeof callback === 'function') callback({ success: false, error: err.message });
    }
  });

  /**
   * 1.1 Reconexión móvil transparente al volver de segundo plano / pestaña minimizada
   */
  socket.on('rejoin_mobile', ({ roomId }, callback) => {
    try {
      const result = roomManager.rejoinMobile(roomId, socket.id);
      if (!result.success) {
        if (typeof callback === 'function') callback({ success: false, error: result.error });
        return;
      }

      socket.join(roomId.toUpperCase());
      console.log(`[Room] Móvil ${socket.id} reconectado con éxito a la sala ${roomId}`);

      const resp = {
        success: true,
        roomId: roomId.toUpperCase(),
        hasCli: !!result.session.cliSocketId
      };

      if (typeof callback === 'function') callback(resp);
      socket.emit('rejoined_success', resp);
    } catch (err) {
      console.error('[Room] Error en rejoin_mobile:', err);
      if (typeof callback === 'function') callback({ success: false, error: err.message });
    }
  });

  /**
   * 1.2 Desconexión explícita solicitada por el usuario (Botón [✕ Desconectar])
   */
  socket.on('close_session', ({ roomId }) => {
    console.log(`[Room] Sesión ${roomId} finalizada manualmente por el usuario desde el móvil.`);
    const session = roomManager.destroyRoom(roomId);

    if (session && session.cliSocketId) {
      io.to(session.cliSocketId).emit('peer_disconnected', {
        role: 'mobile',
        message: 'La sesión fue cerrada manualmente por el usuario desde el móvil.'
      });
    }
  });

  /**
   * 2. El CLI en la laptop solicita unirse a una sala existente
   */
  socket.on('join_room', ({ roomId }, callback) => {
    try {
      const result = roomManager.joinRoom(roomId, socket.id);
      if (!result.success) {
        console.warn(`[Room] Intento fallido de unión a sala ${roomId} desde CLI ${socket.id}`);
        const errResp = { success: false, error: result.error };
        if (typeof callback === 'function') callback(errResp);
        socket.emit('join_error', errResp);
        return;
      }

      socket.join(roomId.toUpperCase());
      console.log(`[Room] CLI ${socket.id} enlazado con éxito a la sala ${roomId}`);

      const successResp = {
        success: true,
        roomId: roomId.toUpperCase(),
        githubRepo: result.session.githubRepo
      };

      if (typeof callback === 'function') callback(successResp);
      socket.emit('room_joined', successResp);

      // Notificar al móvil que el CLI se conectó
      if (result.session.mobileSocketId) {
        io.to(result.session.mobileSocketId).emit('cli_connected', {
          cliSocketId: socket.id,
          timestamp: Date.now()
        });
      }
    } catch (err) {
      console.error('[Room] Error en join_room:', err);
      if (typeof callback === 'function') callback({ success: false, error: err.message });
    }
  });

  /**
   * 3. El CLI transmite un diff detectado
   */
  socket.on('cli_event_diff', async (payload) => {
    const { roomId, filePath, language, deletedCode, surroundingContext } = payload;
    const session = roomManager.getRoom(roomId);

    if (!session) {
      console.warn(`[Diff] Evento recibido para sala inexistente: ${roomId}`);
      return;
    }

    console.log(`[Diff] Recibido cambio en ${filePath} (${(deletedCode || '').length} chars) para sala ${roomId}`);

    // Notificar inmediatamente al móvil que el análisis está en curso
    if (session.mobileSocketId) {
      io.to(session.mobileSocketId).emit('status_update', {
        status: 'analyzing',
        message: `Analizando cambios en ${filePath}...`,
        filePath,
        timestamp: Date.now()
      });
    }

    try {
      // Obtener contexto complementario de GitHub si está vinculado
      let githubContext = null;
      if (session.githubRepo) {
        githubContext = await githubService.getRepoContext(session.githubRepo, filePath);
      }

      // Llamada al Orquestador LLM (Gemini)
      const analysis = await llmService.analyzeCodeChange({
        filePath,
        language,
        deletedCode,
        surroundingContext,
        githubContext
      });

      // Transmitir resultado estructurado al celular
      if (session.mobileSocketId) {
        io.to(session.mobileSocketId).emit('analysis_result', {
          filePath,
          language,
          deletedCode,
          surroundingContext,
          explanation: analysis.explanation,
          replacement_code: analysis.replacement_code,
          compatibility_notes: analysis.compatibility_notes,
          timestamp: Date.now()
        });
      }

      // Confirmar al CLI que fue procesado
      socket.emit('diff_processed', { filePath, success: true });
    } catch (err) {
      console.error('[Diff] Error procesando análisis:', err);
      if (session.mobileSocketId) {
        io.to(session.mobileSocketId).emit('analysis_error', {
          filePath,
          error: err.message
        });
      }
    }
  });

  /**
   * 4. Desconexión transitoria (Zero Storage con tolerancia a minimizado)
   */
  socket.on('disconnect', () => {
    console.log(`[Socket] Desconexión de socket: ${socket.id}`);
    const result = roomManager.handleDisconnect(socket.id);

    if (result && result.role === 'cli') {
      // Si fue el CLI quien se desconectó, avisar al móvil
      if (result.affectedPeerSocketId) {
        io.to(result.affectedPeerSocketId).emit('peer_disconnected', {
          role: 'cli',
          message: 'El CLI local se ha desconectado. Esperando reconexión...'
        });
      }
    }
  });
});

server.listen(PORT, () => {
  console.log('================================================================');
  console.log(`  COMPANION STATELESS RELAY (Backend Orquestador)`);
  console.log(`  • Servidor HTTP & WebSockets: http://localhost:${PORT}`);
  console.log(`  • Frontend Móvil listo en:   http://localhost:${PORT}`);
  console.log(`  • Zero Storage:              Activo (Map en memoria RAM)`);
  console.log(`  • Gemini LLM Mode:           ${process.env.GEMINI_API_KEY ? 'API Conectada' : 'Simulación inteligente activa'}`);
  console.log('================================================================');
});
