/**
 * Game Room Manager
 * Handles room creation, player management, and game state
 */

import { v4 as uuidv4 } from 'uuid';
import {
  GameRoom,
  GameState,
  Player,
  Soldier,
  Obstacle,
  Point,
  GridConfig,
  Terrain,
  CircleObstacle,
  GAME_CONSTANTS,
} from '../types.js';

class GameRoomManager {
  private rooms: Map<string, GameRoom> = new Map();

  private readonly playerColors = [
    '#FF6B6B', '#4ECDC4', '#FFE66D', '#95E1D3',
    '#F38181', '#AA96DA', '#FCBAD3', '#A8D8EA',
    '#FF9F43', '#6C5CE7',
  ];

  /**
   * Generate a random position within grid bounds
   */
  private randomPosition(gridConfig: GridConfig, team: 'red' | 'blue'): Point {
    const { xMin, xMax, yMin, yMax } = gridConfig;
    
    const xRange = team === 'red'
      ? { min: xMin + 2, max: xMin + (xMax - xMin) * 0.3 }
      : { min: xMax - (xMax - xMin) * 0.3, max: xMax - 2 };

    return {
      x: Math.round((xRange.min + Math.random() * (xRange.max - xRange.min)) * 100) / 100,
      y: Math.round((yMin + 2 + Math.random() * (yMax - yMin - 4)) * 100) / 100,
    };
  }

  private generateSoldierId(): string {
    return `soldier-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }

  private randomSoldierPosition(gridConfig: GridConfig, team: 'red' | 'blue'): Point {
    const { xMin, xMax, yMin, yMax } = gridConfig;
    const xRange = team === 'red'
      ? { min: xMin + 1, max: -1 }
      : { min: 1, max: xMax - 1 };

    return {
      x: Math.round((xRange.min + Math.random() * (xRange.max - xRange.min)) * 100) / 100,
      y: Math.round((yMin + 2 + Math.random() * (yMax - yMin - 4)) * 100) / 100,
    };
  }

  private createInitialSoldiers(gridConfig: GridConfig, team: 'red' | 'blue'): Soldier[] {
    const soldiers: Soldier[] = [];
    for (let i = 0; i < GAME_CONSTANTS.INITIAL_SOLDIERS; i++) {
      soldiers.push({
        id: this.generateSoldierId(),
        position: this.randomSoldierPosition(gridConfig, team),
        isAlive: true,
        angle: 0,
      });
    }
    return soldiers;
  }

  private randomGaussian(mean: number, stdDev: number): number {
    const u1 = Math.random();
    const u2 = Math.random();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return mean + stdDev * z;
  }

  private generateTerrain(gridConfig: GridConfig): Terrain {
    const { xMin, xMax, yMin, yMax } = gridConfig;
    const circles: CircleObstacle[] = [];

    const numCircles = Math.max(
      1,
      Math.round(this.randomGaussian(GAME_CONSTANTS.NUM_CIRCLES_MEAN, GAME_CONSTANTS.NUM_CIRCLES_STD_DEV))
    );

    for (let i = 0; i < numCircles; i++) {
      const x = xMin + Math.random() * (xMax - xMin);
      const y = yMin + Math.random() * (yMax - yMin);
      let radius = this.randomGaussian(GAME_CONSTANTS.CIRCLE_MEAN_RADIUS, GAME_CONSTANTS.CIRCLE_STD_DEV);
      radius = Math.max(0.5, radius);
      circles.push({ x, y, radius });
    }

    return { circles, explosions: [] };
  }

  /**
   * Generate random obstacles
   */
  private generateObstacles(gridConfig: GridConfig, count: number = 3): Obstacle[] {
    const obstacles: Obstacle[] = [];
    const { xMin, xMax, yMin, yMax } = gridConfig;

    const obstacleCount = count + Math.floor(Math.random() * 3); // add variation

    for (let i = 0; i < obstacleCount; i++) {
      const sizeFactor = 0.5 + Math.random() * 1.5;
      const posX = xMin + (xMax - xMin) * (0.1 + Math.random() * 0.8); // spread 10%-90%
      const posY = yMin + (yMax - yMin) * (0.1 + Math.random() * 0.8);

      obstacles.push({
        id: `obstacle-${i}`,
        position: {
          x: Math.round(posX * 100) / 100,
          y: Math.round(posY * 100) / 100,
        },
        width: Math.round((1.2 + Math.random() * 2.8) * sizeFactor * 100) / 100,
        height: Math.round((1.2 + Math.random() * 2.8) * sizeFactor * 100) / 100,
        health: 80 + Math.floor(Math.random() * 60),
        isDestroyed: false,
      });
    }

    return obstacles;
  }

  /**
   * Generate a unique room ID (6 characters)
   */
  private generateRoomId(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let result = '';
    for (let i = 0; i < 6; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  /**
   * Create a new game room
   */
  createRoom(playerName: string): { room: GameRoom; playerId: string } {
    const roomId = this.generateRoomId();
    const playerId = uuidv4();
    const gridConfig = GAME_CONSTANTS.DEFAULT_GRID;

    const soldiers = this.createInitialSoldiers(gridConfig, 'red');
    const player: Player = {
      id: playerId,
      name: playerName,
      team: 'red',
      color: this.playerColors[0],
      soldiers,
      currentSoldierIndex: 0,
      position: soldiers[0]?.position ?? this.randomPosition(gridConfig, 'red'),
      health: GAME_CONSTANTS.MAX_HEALTH,
      maxHealth: GAME_CONSTANTS.MAX_HEALTH,
      isAlive: true,
    };

    const gameState: GameState = {
      roomId,
      players: [player],
      obstacles: [],
      terrain: null,
      projectile: null,
      turn: {
        currentPlayerId: '',
        turnNumber: 0,
        phase: 'waiting',
      },
      gridConfig,
      gameMode: 'normal',
      winner: null,
      winnerTeam: null,
    };

    const room: GameRoom = {
      id: roomId,
      state: gameState,
      playerSockets: new Map(),
      createdAt: new Date(),
    };

    this.rooms.set(roomId, room);
    console.log(`[Room] Created room ${roomId} by ${playerName}`);

    return { room, playerId };
  }

  /**
   * Join an existing room
   */
  joinRoom(roomId: string, playerName: string): { room: GameRoom; playerId: string } | null {
    const room = this.rooms.get(roomId);
    if (!room) return null;

    if (room.state.players.length >= GAME_CONSTANTS.MAX_PLAYERS) {
      return null;
    }

    const playerId = uuidv4();
    const soldiers = this.createInitialSoldiers(room.state.gridConfig, 'blue');
    const player: Player = {
      id: playerId,
      name: playerName,
      team: 'blue',
      color: this.playerColors[1],
      soldiers,
      currentSoldierIndex: 0,
      position: soldiers[0]?.position ?? this.randomPosition(room.state.gridConfig, 'blue'),
      health: GAME_CONSTANTS.MAX_HEALTH,
      maxHealth: GAME_CONSTANTS.MAX_HEALTH,
      isAlive: true,
    };

    room.state.players.push(player);
    console.log(`[Room] ${playerName} joined room ${roomId}`);

    return { room, playerId };
  }

  /**
   * Get a room by ID
   */
  getRoom(roomId: string): GameRoom | undefined {
    return this.rooms.get(roomId);
  }

  /**
   * Start the game in a room
   */
  startGame(roomId: string): GameState | null {
    const room = this.rooms.get(roomId);
    if (!room || room.state.players.length < 2) return null;

    // Generate circular terrain (original Graphwar style)
    room.state.terrain = this.generateTerrain(room.state.gridConfig);
    room.state.obstacles = [];

    // Reset win state
    room.state.winner = null;
    room.state.winnerTeam = null;

    // Set first turn
    // Ensure each player has soldiers/colors (in case of older rooms)
    room.state.players = room.state.players.map((p, idx) => {
      const team = (idx % 2 === 0 ? 'red' : 'blue') as Player['team'];
      const soldiers = p.soldiers?.length ? p.soldiers : this.createInitialSoldiers(room.state.gridConfig, team);
      return {
        ...p,
        team,
        color: p.color || this.playerColors[idx % this.playerColors.length],
        soldiers,
        currentSoldierIndex: 0,
        position: soldiers[0]?.position ?? p.position,
        health: GAME_CONSTANTS.MAX_HEALTH,
        maxHealth: GAME_CONSTANTS.MAX_HEALTH,
        isAlive: soldiers.some((s) => s.isAlive),
      };
    });

    const firstPlayer = room.state.players[0];
    const firstSoldierIndex = firstPlayer.soldiers.findIndex((s) => s.isAlive);

    room.state.turn = {
      currentPlayerId: firstPlayer.id,
      turnNumber: 1,
      phase: 'input',
      timeLeft: GAME_CONSTANTS.TURN_TIME,
      currentSoldierIndex: firstSoldierIndex >= 0 ? firstSoldierIndex : 0,
    };

    console.log(`[Room] Game started in room ${roomId}`);
    return room.state;
  }

  processSoldierHit(roomId: string, targetPlayerId: string, targetSoldierIndex: number): GameState | null {
    const room = this.rooms.get(roomId);
    if (!room) return null;

    const player = room.state.players.find((p) => p.id === targetPlayerId);
    if (!player || !player.soldiers || !player.soldiers[targetSoldierIndex]) return null;

    player.soldiers = player.soldiers.map((s, i) => (i === targetSoldierIndex ? { ...s, isAlive: false } : s));
    player.isAlive = player.soldiers.some((s) => s.isAlive);
    const firstAliveIndex = player.soldiers.findIndex((s) => s.isAlive);
    player.currentSoldierIndex = firstAliveIndex >= 0 ? firstAliveIndex : 0;
    player.position = player.soldiers[player.currentSoldierIndex]?.position ?? player.position;

    const alivePlayers = room.state.players.filter((p) => p.isAlive);
    const aliveTeams = new Set(alivePlayers.map((p) => p.team));
    if (aliveTeams.size <= 1) {
      room.state.winner = alivePlayers[0]?.id ?? null;
      room.state.winnerTeam = alivePlayers[0]?.team ?? null;
      room.state.turn.phase = 'gameover';
    }

    return room.state;
  }

  /**
   * Process player hit
   */
  processPlayerHit(roomId: string, playerId: string, damage: number): GameState | null {
    const room = this.rooms.get(roomId);
    if (!room) return null;

    const player = room.state.players.find(p => p.id === playerId);
    if (!player) return null;

    player.health = Math.max(0, player.health - damage);
    player.isAlive = player.health > 0;

    // Check for winner (by team, not just player count)
    const alivePlayers = room.state.players.filter(p => p.isAlive);
    const aliveTeams = new Set(alivePlayers.map(p => p.team));

    if (aliveTeams.size <= 1) {
      room.state.winner = alivePlayers[0]?.id ?? null;
      room.state.winnerTeam = alivePlayers[0]?.team ?? null;
      room.state.turn.phase = 'gameover';
    }

    return room.state;
  }

  /**
   * Advance to next turn
   */
  nextTurn(roomId: string): GameState | null {
    const room = this.rooms.get(roomId);
    if (!room) return null;

    // Do not advance turns once the game is over
    if (room.state.turn.phase === 'gameover') {
      return room.state;
    }

    const alivePlayers = room.state.players.filter(p => p.isAlive);
    if (alivePlayers.length < 2) return room.state;

    const currentIndex = alivePlayers.findIndex(
      p => p.id === room.state.turn.currentPlayerId
    );
    const nextIndex = (currentIndex + 1) % alivePlayers.length;

    const nextPlayer = alivePlayers[nextIndex];
    const nextSoldierIndex = nextPlayer.soldiers?.findIndex((s) => s.isAlive) ?? 0;

    room.state.turn = {
      currentPlayerId: nextPlayer.id,
      turnNumber: room.state.turn.turnNumber + 1,
      phase: 'input',
      timeLeft: GAME_CONSTANTS.TURN_TIME,
      currentSoldierIndex: nextSoldierIndex >= 0 ? nextSoldierIndex : 0,
    };

    room.state.projectile = null;

    return room.state;
  }

  /**
   * Remove a player from a room
   */
  removePlayer(roomId: string, playerId: string): GameRoom | null {
    const room = this.rooms.get(roomId);
    if (!room) return null;

    room.state.players = room.state.players.filter(p => p.id !== playerId);
    room.playerSockets.delete(playerId);

    // If room is empty, delete it
    if (room.state.players.length === 0) {
      this.rooms.delete(roomId);
      console.log(`[Room] Deleted empty room ${roomId}`);
      return null;
    }

    return room;
  }

  /**
   * Associate a socket ID with a player
   */
  setPlayerSocket(roomId: string, playerId: string, socketId: string): void {
    const room = this.rooms.get(roomId);
    if (room) {
      room.playerSockets.set(playerId, socketId);
    }
  }

  /**
   * Get player ID by socket ID
   */
  getPlayerBySocket(roomId: string, socketId: string): string | undefined {
    const room = this.rooms.get(roomId);
    if (!room) return undefined;

    for (const [playerId, sid] of room.playerSockets.entries()) {
      if (sid === socketId) return playerId;
    }
    return undefined;
  }

  /**
   * Clean up old rooms (call periodically)
   */
  cleanupOldRooms(maxAgeMs: number = 3600000): void {
    const now = new Date();
    for (const [roomId, room] of this.rooms.entries()) {
      const age = now.getTime() - room.createdAt.getTime();
      if (age > maxAgeMs) {
        this.rooms.delete(roomId);
        console.log(`[Room] Cleaned up old room ${roomId}`);
      }
    }
  }
}

export const roomManager = new GameRoomManager();
