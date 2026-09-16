/**
 * RoomManager: Gestor de sesiones efímeras en memoria RAM (Zero Storage).
 * No persiste nada en disco ni bases de datos.
 * Incluye tolerancia a minimizado móvil y reconexión transparente.
 */

class RoomManager {
  constructor() {
    /** @type {Map<string, { roomId: string, githubRepo: string, mobileSocketId: string|null, cliSocketId: string|null, createdAt: number, expireTimer?: any }>} */
    this.rooms = new Map();
    /** @type {Map<string, string>} Mapeo inverso de socketId -> roomId */
    this.socketToRoom = new Map();
  }

  generateRoomCode(length = 4) {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
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

  createRoom(mobileSocketId, githubRepo = '') {
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
   * Permite al móvil reconectarse a su sala tras volver de segundo plano/minimizado.
   */
  rejoinMobile(roomId, newSocketId) {
    const normalizedRoom = roomId.trim().toUpperCase();
    const session = this.rooms.get(normalizedRoom);

    if (!session) {
      return { success: false, error: 'Sala no encontrada' };
    }

    // Cancelar temporizador de expiración por inactividad si existía
    if (session.expireTimer) {
      clearTimeout(session.expireTimer);
      session.expireTimer = null;
    }

    // Actualizar mapeos
    if (session.mobileSocketId) {
      this.socketToRoom.delete(session.mobileSocketId);
    }
    session.mobileSocketId = newSocketId;
    this.socketToRoom.set(newSocketId, normalizedRoom);

    return { success: true, session };
  }

  getRoom(roomId) {
    return this.rooms.get(roomId?.trim().toUpperCase()) || null;
  }

  getRoomBySocket(socketId) {
    const roomId = this.socketToRoom.get(socketId);
    if (!roomId) return null;
    return this.rooms.get(roomId) || null;
  }

  /**
   * Desconexión transitoria: NO destruye la sala de inmediato para tolerar
   * que el usuario minimice la app o bloquee la pantalla del celular.
   */
  handleDisconnect(socketId) {
    const roomId = this.socketToRoom.get(socketId);
    if (!roomId) return null;

    this.socketToRoom.delete(socketId);
    const session = this.rooms.get(roomId);
    if (!session) return null;

    let role = 'mobile';
    let affectedPeerSocketId = null;

    if (session.mobileSocketId === socketId) {
      role = 'mobile';
      session.mobileSocketId = null;
      affectedPeerSocketId = session.cliSocketId;

      // Dar una ventana de gracia de 15 minutos para reconexión móvil
      if (session.expireTimer) clearTimeout(session.expireTimer);
      session.expireTimer = setTimeout(() => {
        console.log(`[Room] Expirando sala ${roomId} por inactividad prolongada.`);
        this.destroyRoom(roomId);
      }, 15 * 60 * 1000);

    } else if (session.cliSocketId === socketId) {
      role = 'cli';
      session.cliSocketId = null;
      affectedPeerSocketId = session.mobileSocketId;
    }

    return { roomId, affectedPeerSocketId, role };
  }

  /**
   * Cierre explícito (cuando el usuario pulsa el botón '✕ Desconectar').
   */
  destroyRoom(roomId) {
    const normalizedRoom = roomId.trim().toUpperCase();
    const session = this.rooms.get(normalizedRoom);
    if (!session) return null;

    if (session.expireTimer) clearTimeout(session.expireTimer);
    if (session.mobileSocketId) this.socketToRoom.delete(session.mobileSocketId);
    if (session.cliSocketId) this.socketToRoom.delete(session.cliSocketId);

    this.rooms.delete(normalizedRoom);
    return session;
  }
}

export const roomManager = new RoomManager();
