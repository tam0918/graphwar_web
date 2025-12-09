/**
 * Socket.io Client
 * Handles real-time communication with the game server
 */

import { io, Socket } from 'socket.io-client';
import { useGameStore } from '@/stores';
import { Point, Player, TurnState, GameState } from '@/types';

const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:3001';

// Socket instance
let socket: Socket | null = null;

// Event types from server
interface ServerEvents {
  roomCreated: (data: { roomId: string; playerId: string; gameState: GameState }) => void;
  roomJoined: (data: { playerId: string; gameState: GameState }) => void;
  playerJoined: (data: { player: Player; gameState: GameState }) => void;
  gameStarted: (data: { gameState: GameState }) => void;
  turnUpdate: (data: { turn: TurnState }) => void;
  projectileFired: (data: { path: Point[]; playerId: string; functionString: string }) => void;
  playerHit: (data: { playerId: string; damage: number; newHealth: number }) => void;
  obstacleDamaged: (data: { obstacle: GameState['obstacles'][number] }) => void;
  obstacleDestroyed: (data: { obstacleId: string }) => void;
  turnEnded: (data: { turn: TurnState }) => void;
  gameOver: (data: { winnerId: string | null; winnerName: string; winnerTeam: Player['team'] | null }) => void;
  playerDisconnected: (data: { playerId: string; playerName: string }) => void;
  error: (data: { message: string }) => void;
}

/**
 * Initialize socket connection
 */
export function connectSocket(): Socket {
  if (socket?.connected) {
    return socket;
  }

  socket = io(SOCKET_URL, {
    transports: ['websocket', 'polling'],
    autoConnect: true,
  });

  const store = useGameStore.getState();

  // Connection events
  socket.on('connect', () => {
    console.log('[Socket] Connected to server');
    store.setConnected(true);
  });

  socket.on('disconnect', () => {
    console.log('[Socket] Disconnected from server');
    store.setConnected(false);
  });

  socket.on('connect_error', (error) => {
    console.error('[Socket] Connection error:', error);
    store.setConnected(false);
  });

  // Game events
  socket.on('roomCreated', ({ roomId, playerId, gameState }) => {
    console.log('[Socket] Room created:', roomId);
    store.setRoomId(roomId);
    store.setMyPlayerId(playerId);
    store.syncGameState(gameState);
  });

  socket.on('roomJoined', ({ playerId, gameState }) => {
    console.log('[Socket] Joined room');
    store.setMyPlayerId(playerId);
    store.syncGameState(gameState);
  });

  socket.on('playerJoined', ({ player, gameState }) => {
    console.log('[Socket] Player joined:', player.name);
    store.syncGameState(gameState);
  });

  socket.on('gameStarted', ({ gameState }) => {
    console.log('[Socket] Game started');
    store.syncGameState(gameState);
  });

  socket.on('projectileFired', ({ playerId, functionString }) => {
    console.log('[Socket] Projectile fired by:', playerId);
    // The actual firing is handled by the component using the function string
    store.setPhase('animating');
  });

  socket.on('playerHit', ({ playerId, damage, newHealth }) => {
    console.log('[Socket] Player hit:', playerId, 'damage:', damage);
    store.updatePlayer(playerId, { health: newHealth, isAlive: newHealth > 0 });
  });

  socket.on('obstacleDamaged', ({ obstacle }) => {
    console.log('[Socket] Obstacle damaged:', obstacle.id, 'health:', obstacle.health);
    const current = useGameStore.getState();
    store.syncGameState({
      obstacles: current.obstacles.map((o) => (o.id === obstacle.id ? obstacle : o)),
    });
  });

  socket.on('obstacleDestroyed', ({ obstacleId }) => {
    console.log('[Socket] Obstacle destroyed:', obstacleId);
    store.destroyObstacle(obstacleId);
  });

  socket.on('turnEnded', ({ turn }) => {
    console.log('[Socket] Turn ended, next player:', turn.currentPlayerId);
    store.syncGameState({ turn, projectile: null });
  });

  socket.on('gameOver', ({ winnerId, winnerName, winnerTeam }) => {
    console.log('[Socket] Game over, winner:', winnerName);
    store.endGame(winnerId, winnerTeam);
  });

  socket.on('playerDisconnected', ({ playerId, playerName }) => {
    console.log('[Socket] Player disconnected:', playerName);
    store.removePlayer(playerId);
  });

  socket.on('error', ({ message }) => {
    console.error('[Socket] Error:', message);
    // Could dispatch to a toast notification system
  });

  return socket;
}

/**
 * Disconnect socket
 */
export function disconnectSocket(): void {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}

/**
 * Get current socket instance
 */
export function getSocket(): Socket | null {
  return socket;
}

/**
 * Create a new game room
 */
export function createRoom(playerName: string): void {
  if (!socket?.connected) {
    console.error('[Socket] Not connected');
    return;
  }
  socket.emit('createRoom', { playerName });
}

/**
 * Join an existing room
 */
export function joinRoom(roomId: string, playerName: string): void {
  if (!socket?.connected) {
    console.error('[Socket] Not connected');
    return;
  }
  socket.emit('joinRoom', { roomId, playerName });
}

/**
 * Submit a function to fire
 */
export function submitFunction(roomId: string, playerId: string, functionString: string): void {
  if (!socket?.connected) {
    console.error('[Socket] Not connected');
    return;
  }
  socket.emit('submitFunction', { roomId, playerId, functionString });
}

/**
 * Report projectile hit
 */
export function reportHit(roomId: string, targetType: 'player' | 'obstacle', targetId: string): void {
  if (!socket?.connected) {
    console.error('[Socket] Not connected');
    return;
  }
  socket.emit('projectileHit', { roomId, targetType, targetId });
}

/**
 * Report projectile miss (out of bounds)
 */
export function reportMiss(roomId: string): void {
  if (!socket?.connected) {
    console.error('[Socket] Not connected');
    return;
  }
  socket.emit('projectileMiss', { roomId });
}

// Custom hook for socket state
export function useSocketConnection() {
  const isConnected = useGameStore((state) => state.isConnected);
  
  return {
    isConnected,
    connect: connectSocket,
    disconnect: disconnectSocket,
  };
}
