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

export function setupSocketHandlers(io: GameServer): void {
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
    socket.on('submitFunction', ({ roomId, playerId, functionString }) => {
      try {
        const room = roomManager.getRoom(roomId);
        if (!room) {
          socket.emit('error', { message: ERROR_MESSAGES.ROOM_NOT_FOUND });
          return;
        }

        // Verify it's the player's turn
        if (room.state.turn.currentPlayerId !== playerId) {
          socket.emit('error', { message: ERROR_MESSAGES.NOT_YOUR_TURN });
          return;
        }

        // Update phase
        room.state.turn.phase = 'firing';
        room.state.turn.lastFunction = functionString;

        // Broadcast to all players in the room
        // The actual path calculation happens on the client for responsiveness
        io.to(roomId).emit('projectileFired', {
          path: [], // Path will be calculated client-side
          playerId,
          functionString,
        });

        console.log(`[Socket] Player ${playerId} fired: ${functionString}`);
      } catch (error) {
        console.error('[Socket] Error submitting function:', error);
        socket.emit('error', { message: ERROR_MESSAGES.INVALID_FUNCTION });
      }
    });

    /**
     * Projectile hit a target
     */
    socket.on('projectileHit', ({ roomId, targetType, targetId }) => {
      try {
        const room = roomManager.getRoom(roomId);
        if (!room) return;

        if (targetType === 'player') {
          // Process player damage
          const damage = GAME_CONSTANTS.HIT_DAMAGE;
          const newState = roomManager.processPlayerHit(roomId, targetId, damage);
          
          if (newState) {
            const hitPlayer = newState.players.find(p => p.id === targetId);
            
            io.to(roomId).emit('playerHit', {
              playerId: targetId,
              damage,
              newHealth: hitPlayer?.health ?? 0,
            });

            // Check for game over
            if (newState.winner) {
              const winner = newState.players.find(p => p.id === newState.winner);
              io.to(roomId).emit('gameOver', {
                winnerId: newState.winner,
                winnerName: winner?.name ?? 'Không xác định',
              });
            } else {
              // Next turn
              const nextState = roomManager.nextTurn(roomId);
              if (nextState) {
                io.to(roomId).emit('turnEnded', { turn: nextState.turn });
              }
            }
          }
        } else if (targetType === 'obstacle') {
          // Destroy obstacle
          const obstacle = room.state.obstacles.find(o => o.id === targetId);
          if (obstacle) {
            obstacle.isDestroyed = true;
            io.to(roomId).emit('obstacleDestroyed', { obstacleId: targetId });
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
        const nextState = roomManager.nextTurn(roomId);
        if (nextState) {
          io.to(roomId).emit('turnEnded', { turn: nextState.turn });
        }
      } catch (error) {
        console.error('[Socket] Error processing miss:', error);
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
