/**
 * Shared types between frontend and backend
 * Mirror of frontend types for consistency
 */

export interface Point {
  x: number;
  y: number;
}

export interface Player {
  id: string;
  name: string;
  team: 'red' | 'blue';
  position: Point;
  health: number;
  maxHealth: number;
  isAlive: boolean;
}

export interface Obstacle {
  id: string;
  position: Point;
  width: number;
  height: number;
  health: number;
  isDestroyed: boolean;
}

export interface Projectile {
  currentPosition: Point;
  path: Point[];
  pathIndex: number;
  isActive: boolean;
  owner: string;
}

export type GamePhase = 
  | 'waiting'
  | 'ready'
  | 'input'
  | 'firing'
  | 'animating'
  | 'hit'
  | 'miss'
  | 'gameover';

export interface TurnState {
  currentPlayerId: string;
  turnNumber: number;
  phase: GamePhase;
  lastFunction?: string;
}

export interface GridConfig {
  width: number;
  height: number;
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  gridSpacing: number;
}

export interface GameState {
  roomId: string;
  players: Player[];
  obstacles: Obstacle[];
  projectile: Projectile | null;
  turn: TurnState;
  gridConfig: GridConfig;
  winner: string | null;
}

export interface GameRoom {
  id: string;
  state: GameState;
  playerSockets: Map<string, string>; // playerId -> socketId
  createdAt: Date;
}

// Socket event types
export interface ClientToServerEvents {
  createRoom: (data: { playerName: string }) => void;
  joinRoom: (data: { roomId: string; playerName: string }) => void;
  playerReady: (data: { roomId: string; playerId: string }) => void;
  submitFunction: (data: { roomId: string; playerId: string; functionString: string }) => void;
  projectileHit: (data: { roomId: string; targetType: 'player' | 'obstacle'; targetId: string }) => void;
  projectileMiss: (data: { roomId: string }) => void;
  disconnect: () => void;
}

export interface ServerToClientEvents {
  roomCreated: (data: { roomId: string; playerId: string; gameState: GameState }) => void;
  roomJoined: (data: { playerId: string; gameState: GameState }) => void;
  playerJoined: (data: { player: Player; gameState: GameState }) => void;
  gameStarted: (data: { gameState: GameState }) => void;
  turnUpdate: (data: { turn: TurnState }) => void;
  projectileFired: (data: { path: Point[]; playerId: string; functionString: string }) => void;
  playerHit: (data: { playerId: string; damage: number; newHealth: number }) => void;
  obstacleDestroyed: (data: { obstacleId: string }) => void;
  turnEnded: (data: { turn: TurnState }) => void;
  gameOver: (data: { winnerId: string; winnerName: string }) => void;
  playerDisconnected: (data: { playerId: string; playerName: string }) => void;
  error: (data: { message: string }) => void;
}

export interface InterServerEvents {
  ping: () => void;
}

export interface SocketData {
  playerId: string;
  roomId: string;
}

// Vietnamese error messages
export const ERROR_MESSAGES = {
  ROOM_NOT_FOUND: 'Không tìm thấy phòng',
  ROOM_FULL: 'Phòng đã đầy',
  NOT_YOUR_TURN: 'Chưa đến lượt của bạn',
  INVALID_FUNCTION: 'Hàm số không hợp lệ',
  GAME_NOT_STARTED: 'Trò chơi chưa bắt đầu',
  PLAYER_NOT_FOUND: 'Không tìm thấy người chơi',
  ALREADY_IN_ROOM: 'Bạn đã ở trong phòng khác',
} as const;

// Game constants
export const GAME_CONSTANTS = {
  MAX_PLAYERS: 2,
  MAX_HEALTH: 100,
  HIT_DAMAGE: 50,
  DEFAULT_GRID: {
    width: 800,
    height: 600,
    xMin: -20,
    xMax: 20,
    yMin: -15,
    yMax: 15,
    gridSpacing: 1,
  } as GridConfig,
} as const;
