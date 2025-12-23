/**
 * Socket.io Event Handlers
 * Manages real-time communication between clients
 */

import { Server, Socket } from 'socket.io';
import { roomManager } from '../game/roomManager.js';
import {
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData,
  ERROR_MESSAGES,
  GAME_CONSTANTS,
} from '../types.js';

type GameSocket = Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;
type GameServer = Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

const roomTimers: Map<string, NodeJS.Timeout> = new Map();

export function setupSocketHandlers(io: GameServer): void {
  const startRoomTimer = (roomId: string) => {
    if (roomTimers.has(roomId)) {
      clearInterval(roomTimers.get(roomId)!);
    }

    const timer = setInterval(() => {
      const room = roomManager.getRoom(roomId);
      if (!room || room.state.turn.phase === 'gameover') {
        clearInterval(timer);
        roomTimers.delete(roomId);
        return;
      }

      // Only decrement if in input phase
      if (room.state.turn.phase === 'input' && room.state.turn.timeLeft !== undefined) {
        room.state.turn.timeLeft -= 1;

        if (room.state.turn.timeLeft <= 0) {
          const nextState = roomManager.nextTurn(roomId);
          if (nextState) {
            io.to(roomId).emit('turnEnded', { turn: nextState.turn });
          }
        } else {
          io.to(roomId).emit('turnUpdate', { turn: room.state.turn });
        }
      }
    }, 1000);

    roomTimers.set(roomId, timer);
  };

  io.on('connection', (socket: GameSocket) => {
    console.log(`[Socket] Client connected: ${socket.id}`);

    /**
     * Create a new game room
     */
    socket.on('createRoom', ({ playerName }) => {
      try {
        const { room, playerId } = roomManager.createRoom(playerName);
        
        // Join socket to room
        socket.join(room.id);
        socket.data.playerId = playerId;
        socket.data.roomId = room.id;
        roomManager.setPlayerSocket(room.id, playerId, socket.id);

        socket.emit('roomCreated', {
          roomId: room.id,
          playerId,
          gameState: room.state,
        });

        console.log(`[Socket] Room ${room.id} created by ${playerName}`);
      } catch (error) {
        console.error('[Socket] Error creating room:', error);
        socket.emit('error', { message: 'Lỗi tạo phòng' });
      }
    });

    /**
     * Join an existing room
     */
    socket.on('joinRoom', ({ roomId, playerName }) => {
      try {
        const result = roomManager.joinRoom(roomId, playerName);

        if (!result) {
          const room = roomManager.getRoom(roomId);
          if (!room) {
            socket.emit('error', { message: ERROR_MESSAGES.ROOM_NOT_FOUND });
          } else {
            socket.emit('error', { message: ERROR_MESSAGES.ROOM_FULL });
          }
          return;
        }

        const { room, playerId } = result;

        // Join socket to room
        socket.join(roomId);
        socket.data.playerId = playerId;
        socket.data.roomId = roomId;
        roomManager.setPlayerSocket(roomId, playerId, socket.id);

        // Notify the joining player
        socket.emit('roomJoined', {
          playerId,
          gameState: room.state,
        });

        // Notify other players in the room
        const newPlayer = room.state.players.find(p => p.id === playerId);
        if (newPlayer) {
          socket.to(roomId).emit('playerJoined', {
            player: newPlayer,
            gameState: room.state,
          });
        }

        // If room is full, start the game
        if (room.state.players.length >= GAME_CONSTANTS.MAX_PLAYERS) {
          const gameState = roomManager.startGame(roomId);
          if (gameState) {
            io.to(roomId).emit('gameStarted', { gameState });
            startRoomTimer(roomId);
          }
        }

        console.log(`[Socket] ${playerName} joined room ${roomId}`);
      } catch (error) {
        console.error('[Socket] Error joining room:', error);
        socket.emit('error', { message: 'Lỗi tham gia phòng' });
      }
    });

    /**
     * Player submits a function to fire
     */
    socket.on('submitFunction', ({ roomId, playerId, functionString, soldierIndex, firingAngle }) => {
      try {
        // Always trust server-side socket identity instead of client payload
        const actualPlayerId = socket.data.playerId;
        const actualRoomId = socket.data.roomId;

        if (!actualPlayerId || !actualRoomId || actualRoomId !== roomId) {
          socket.emit('error', { message: ERROR_MESSAGES.ROOM_NOT_FOUND });
          return;
        }

        const room = roomManager.getRoom(roomId);
        if (!room) {
          socket.emit('error', { message: ERROR_MESSAGES.ROOM_NOT_FOUND });
          return;
        }

        // Warn on mismatch (can happen if client cached a wrong id)
        if (playerId && playerId !== actualPlayerId) {
          console.warn(
            `[Socket] submitFunction playerId mismatch: payload=${playerId} socket=${actualPlayerId}`
          );
        }

        // Verify it's the player's turn
        if (room.state.turn.currentPlayerId !== actualPlayerId) {
          socket.emit('error', { message: ERROR_MESSAGES.NOT_YOUR_TURN });
          return;
        }

        // Persist soldier selection/angle for consistent simulation across clients
        if (typeof soldierIndex === 'number') {
          room.state.turn.currentSoldierIndex = soldierIndex;
        }
        if (typeof soldierIndex === 'number' && typeof firingAngle === 'number') {
          const shooter = room.state.players.find((p) => p.id === actualPlayerId);
          if (shooter?.soldiers?.[soldierIndex]) {
            shooter.soldiers[soldierIndex].angle = firingAngle;
          }
        }

        // Update phase
        room.state.turn.phase = 'firing';
        room.state.turn.lastFunction = functionString;

        // Broadcast to all players in the room
        // The actual path calculation happens on the client for responsiveness
        io.to(roomId).emit('projectileFired', {
          path: [], // Path will be calculated client-side
          playerId: actualPlayerId,
          functionString,
          soldierIndex: room.state.turn.currentSoldierIndex,
          firingAngle,
        });

        console.log(`[Socket] Player ${actualPlayerId} fired: ${functionString}`);
      } catch (error) {
        console.error('[Socket] Error submitting function:', error);
        socket.emit('error', { message: ERROR_MESSAGES.INVALID_FUNCTION });
      }
    });

    /**
     * Projectile hit a target
     */
    socket.on('projectileHit', (payload) => {
      try {
        const roomId = (payload as any).roomId as string;
        const room = roomManager.getRoom(roomId);
        if (!room) return;

        // Ignore once game over
        if (room.state.turn.phase === 'gameover') return;

        // Only accept hit reports from the player whose turn it is
        const actualPlayerId = socket.data.playerId;
        if (!actualPlayerId || room.state.turn.currentPlayerId !== actualPlayerId) {
          return;
        }

        const targetType = (payload as any).targetType as 'soldier' | 'obstacle' | 'terrain';

        if (targetType === 'soldier') {
          const targetPlayerId = (payload as any).targetPlayerId as string | undefined;
          const targetSoldierIndex = (payload as any).targetSoldierIndex as number | undefined;
          if (!targetPlayerId || typeof targetSoldierIndex !== 'number') return;

          const newState = roomManager.processSoldierHit(roomId, targetPlayerId, targetSoldierIndex);
          if (newState) {
            io.to(roomId).emit('soldierHit', { playerId: targetPlayerId, soldierIndex: targetSoldierIndex });

            if (newState.turn.phase === 'gameover') {
              const winner = newState.players.find((p) => p.id === newState.winner);
              io.to(roomId).emit('gameOver', {
                winnerId: newState.winner,
                winnerName: winner?.name ?? 'Hòa',
                winnerTeam: newState.winnerTeam,
              });
              return;
            }

            const nextState = roomManager.nextTurn(roomId);
            if (nextState) {
              io.to(roomId).emit('turnEnded', { turn: nextState.turn });
            }
          }
        } else if (targetType === 'terrain') {
          const x = (payload as any).x as number | undefined;
          const y = (payload as any).y as number | undefined;
          const radius = (payload as any).radius as number | undefined;
          if (typeof x !== 'number' || typeof y !== 'number') return;

          if (!room.state.terrain) {
            room.state.terrain = { circles: [], explosions: [] };
          }
          const finalRadius = typeof radius === 'number' ? radius : GAME_CONSTANTS.EXPLOSION_RADIUS;
          room.state.terrain.explosions.push({ x, y, radius: finalRadius });
          io.to(roomId).emit('terrainHit', { x, y, radius: finalRadius });

          const nextState = roomManager.nextTurn(roomId);
          if (nextState) {
            io.to(roomId).emit('turnEnded', { turn: nextState.turn });
          }
        } else if (targetType === 'obstacle') {
          // Damage obstacle
          const obstacleId = (payload as any).obstacleId as string | undefined;
          if (!obstacleId) return;
          const obstacle = room.state.obstacles.find(o => o.id === obstacleId);
          if (obstacle) {
            obstacle.health = Math.max(0, obstacle.health - GAME_CONSTANTS.OBSTACLE_HIT_DAMAGE);
            const shrinkFactor = 0.8;
            obstacle.width = Math.max(0.5, obstacle.width * shrinkFactor);
            obstacle.height = Math.max(0.5, obstacle.height * shrinkFactor);

            if (obstacle.health === 0) {
              obstacle.isDestroyed = true;
              io.to(roomId).emit('obstacleDestroyed', { obstacleId });
            } else {
              io.to(roomId).emit('obstacleDamaged', { obstacle });
            }
          }

          // Next turn
          const nextState = roomManager.nextTurn(roomId);
          if (nextState) {
            io.to(roomId).emit('turnEnded', { turn: nextState.turn });
          }
        }
      } catch (error) {
        console.error('[Socket] Error processing hit:', error);
      }
    });

    /**
     * Projectile missed (went out of bounds)
     */
    socket.on('projectileMiss', ({ roomId }) => {
      try {
        const room = roomManager.getRoom(roomId);
        if (room?.state.turn.phase === 'gameover') return;

        const nextState = roomManager.nextTurn(roomId);
        if (nextState) {
          io.to(roomId).emit('turnEnded', { turn: nextState.turn });
        }
      } catch (error) {
        console.error('[Socket] Error processing miss:', error);
      }
    });

    /**
     * Handle chat message
     */
    socket.on('sendChatMessage', ({ roomId, message }) => {
      try {
        const { playerId } = socket.data;
        if (!playerId) return;

        const room = roomManager.getRoom(roomId);
        if (!room) return;

        const player = room.state.players.find(p => p.id === playerId);
        if (!player) return;

        io.to(roomId).emit('chatMessage', {
          playerId,
          playerName: player.name,
          message: message.substring(0, 200), // Limit message length
          timestamp: Date.now(),
        });
      } catch (error) {
        console.error('[Socket] Error sending chat message:', error);
      }
    });

    /**
     * Handle disconnection
     */
    socket.on('disconnect', () => {
      const { roomId, playerId } = socket.data;
      
      if (roomId && playerId) {
        const room = roomManager.getRoom(roomId);
        const player = room?.state.players.find(p => p.id === playerId);
        const playerName = player?.name ?? 'Người chơi';

        roomManager.removePlayer(roomId, playerId);

        // Notify other players
        socket.to(roomId).emit('playerDisconnected', {
          playerId,
          playerName,
        });

        // If room is empty or game over, clear timer
        const updatedRoom = roomManager.getRoom(roomId);
        if (!updatedRoom || updatedRoom.state.players.length < 2) {
          if (roomTimers.has(roomId)) {
            clearInterval(roomTimers.get(roomId)!);
            roomTimers.delete(roomId);
          }
        }

        console.log(`[Socket] ${playerName} disconnected from room ${roomId}`);
      }

      console.log(`[Socket] Client disconnected: ${socket.id}`);
    });
  });

  // Cleanup old rooms periodically (every hour)
  setInterval(() => {
    roomManager.cleanupOldRooms();
  }, 3600000);
}
