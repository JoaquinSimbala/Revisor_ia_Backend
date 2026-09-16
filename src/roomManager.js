/**
 * RoomManager: Gestor de sesiones efímeras en memoria RAM (Zero Storage).
 * No persiste nada en disco ni bases de datos.
 */

class RoomManager {
  constructor() {
    /** @type {Map<string, { roomId: string, githubRepo: string, mobileSocketId: string|null, cliSocketId: string|null, createdAt: number }>} */
    this.rooms = new Map();
    /** @type {Map<string, string>} Mapeo inverso de socketId -> roomId para desconexiones ultrarrápidas */
    this.socketToRoom = new Map();
  }

  /**
   * Genera un código de sala alfanumérico único de 4 a 6 caracteres.
   * @param {number} length 
   * @returns {string}
   */
  generateRoomCode(length = 4) {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Excluye 0, O, 1, I para evitar ambigüedades
    let code = '';
    let attempts = 0;
    do {
      code = '';
      for (let i = 0; i < length; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      attempts++;
      if (attempts > 50) length++;
    } while (this.rooms.has(code));

    return code;
  }

  /**
   * Crea una nueva sala efímera asociada a un cliente móvil.
   * @param {string} mobileSocketId 
   * @param {string} githubRepo 
   * @returns {string} roomId
   */
  createRoom(mobileSocketId, githubRepo = '') {
    // Si el socket ya tenía una sala previa, la cerramos
    this.cleanupSocket(mobileSocketId);

    const roomId = this.generateRoomCode(4);
    const session = {
      roomId,
      githubRepo: githubRepo.trim(),
      mobileSocketId,
      cliSocketId: null,
      createdAt: Date.now()
    };

    this.rooms.set(roomId, session);
    this.socketToRoom.set(mobileSocketId, roomId);

    return roomId;
  }

  /**
   * Une un CLI Watcher a una sala existente.
   * @param {string} roomId 
   * @param {string} cliSocketId 
   * @returns {{ success: boolean, error?: string, session?: object }}
   */
  joinRoom(roomId, cliSocketId) {
    const normalizedRoom = roomId.trim().toUpperCase();
    const session = this.rooms.get(normalizedRoom);

    if (!session) {
      return { success: false, error: 'Sala no encontrada o expirada' };
    }

    session.cliSocketId = cliSocketId;
    this.socketToRoom.set(cliSocketId, normalizedRoom);

    return { success: true, session };
  }

  /**
   * Obtiene la sesión por ID de sala.
   * @param {string} roomId 
   */
  getRoom(roomId) {
    return this.rooms.get(roomId?.trim().toUpperCase()) || null;
  }

  /**
   * Obtiene la sesión asociada a cualquier socket (móvil o CLI).
   * @param {string} socketId 
   */
  getRoomBySocket(socketId) {
    const roomId = this.socketToRoom.get(socketId);
    if (!roomId) return null;
    return this.rooms.get(roomId) || null;
  }

  /**
   * Elimina un socket y destruye la sala asociada en RAM.
   * @param {string} socketId 
   * @returns {{ roomId: string, affectedPeerSocketId: string|null, role: 'mobile'|'cli' }|null}
   */
  cleanupSocket(socketId) {
    const roomId = this.socketToRoom.get(socketId);
    if (!roomId) return null;

    this.socketToRoom.delete(socketId);
    const session = this.rooms.get(roomId);

    if (!session) return null;

    let role = 'mobile';
    let affectedPeerSocketId = null;

    if (session.mobileSocketId === socketId) {
      role = 'mobile';
      affectedPeerSocketId = session.cliSocketId;
    } else if (session.cliSocketId === socketId) {
      role = 'cli';
      affectedPeerSocketId = session.mobileSocketId;
    }

    // Al ser stateless, destruimos la sala completamente si el móvil se desconecta
    // O limpiamos la referencia del CLI si solo fue el CLI
    if (role === 'mobile') {
      if (session.cliSocketId) {
        this.socketToRoom.delete(session.cliSocketId);
      }
      this.rooms.delete(roomId);
    } else {
      session.cliSocketId = null;
    }

    return { roomId, affectedPeerSocketId, role };
  }
}

export const roomManager = new RoomManager();
