/**
 * Shared types between frontend and backend
 * Mirror of frontend types for consistency
 * Updated to support original Graphwar mechanics
 */

export interface Point {
  x: number;
  y: number;
}

/**
 * Soldier (individual unit, player can have multiple)
 */
export interface Soldier {
  id: string;
  position: Point;
  isAlive: boolean;
  angle: number; // Firing angle for 2nd order ODE mode (radians)
}

export interface Player {
  id: string;
  name: string;
  team: 'red' | 'blue';
  color: string; // Player color (hex)
  soldiers: Soldier[]; // Multiple soldiers per player
  currentSoldierIndex: number;
  isAlive: boolean;
  // Legacy compatibility
  position: Point;
  health: number;
  maxHealth: number;
}

/**
 * Rectangular obstacle (legacy)
 */
export interface Obstacle {
  id: string;
  position: Point;
  width: number;
  height: number;
  health: number;
  isDestroyed: boolean;
}

/**
 * Circular obstacle for terrain (original Graphwar style)
 */
export interface CircleObstacle {
  x: number;
  y: number;
  radius: number;
}

/**
 * Terrain with circular obstacles
 */
export interface Terrain {
  circles: CircleObstacle[];
  explosions: { x: number; y: number; radius: number }[];
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

export type GameMode = 'normal' | 'first_order_ode' | 'second_order_ode';

export interface TurnState {
  currentPlayerId: string;
  turnNumber: number;
  phase: GamePhase;
  lastFunction?: string;
  timeLeft?: number;
  currentSoldierIndex?: number;
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
  terrain: Terrain | null;
  projectile: Projectile | null;
  turn: TurnState;
  gridConfig: GridConfig;
  gameMode: GameMode;
  winner: string | null;
  winnerTeam: Player['team'] | null;
}

export interface GameRoom {
  id: string;
  state: GameState;
  playerSockets: Map<string, string>; // playerId -> socketId
  createdAt: Date;
}

// Socket event types
export interface ClientToServerEvents {
  createRoom: (data: { playerName: string; gameMode?: GameMode }) => void;
  joinRoom: (data: { roomId: string; playerName: string }) => void;
  playerReady: (data: { roomId: string; playerId: string }) => void;
  submitFunction: (data: { roomId: string; playerId: string; functionString: string; soldierIndex?: number; firingAngle?: number }) => void;
  setSoldierAngle: (data: { roomId: string; playerId: string; soldierIndex: number; angle: number }) => void;
  projectileHit: (data: 
    | { roomId: string; targetType: 'soldier'; targetPlayerId: string; targetSoldierIndex: number }
    | { roomId: string; targetType: 'obstacle'; obstacleId: string }
    | { roomId: string; targetType: 'terrain'; x: number; y: number; radius?: number }
  ) => void;
  projectileMiss: (data: { roomId: string }) => void;
  sendChatMessage: (data: { roomId: string; message: string }) => void;
  setGameMode: (data: { roomId: string; gameMode: GameMode }) => void;
  disconnect: () => void;
}

export interface ServerToClientEvents {
  roomCreated: (data: { roomId: string; playerId: string; gameState: GameState }) => void;
  roomJoined: (data: { playerId: string; gameState: GameState }) => void;
  playerJoined: (data: { player: Player; gameState: GameState }) => void;
  gameStarted: (data: { gameState: GameState }) => void;
  turnUpdate: (data: { turn: TurnState }) => void;
  gameModeChanged: (data: { gameMode: GameMode }) => void;
  projectileFired: (data: { path: Point[]; playerId: string; functionString: string; soldierIndex?: number; firingAngle?: number }) => void;
  soldierHit: (data: { playerId: string; soldierIndex: number }) => void;
  playerHit: (data: { playerId: string; damage: number; newHealth: number }) => void;
  terrainHit: (data: { x: number; y: number; radius: number }) => void;
  obstacleDamaged: (data: { obstacle: Obstacle }) => void;
  obstacleDestroyed: (data: { obstacleId: string }) => void;
  turnEnded: (data: { turn: TurnState }) => void;
  gameOver: (data: { winnerId: string | null; winnerName: string; winnerTeam: Player['team'] | null }) => void;
  playerDisconnected: (data: { playerId: string; playerName: string }) => void;
  chatMessage: (data: { playerId: string; playerName: string; message: string; timestamp: number }) => void;
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

// Game constants (matching original Graphwar)
export const GAME_CONSTANTS = {
  // Plane dimensions from original Graphwar
  PLANE_LENGTH: 770,           // pixels
  PLANE_HEIGHT: 450,           // pixels
  PLANE_GAME_LENGTH: 50,       // game units (-25 to 25)
  
  // Game boundaries
  X_MIN: -25,
  X_MAX: 25,
  Y_MIN: -15,
  Y_MAX: 15,
  
  // Soldier & Gameplay
  SOLDIER_RADIUS: 0.7,         // grid units (approximately 7 pixels in original)
  INITIAL_SOLDIERS: 2,
  MAX_SOLDIERS_PER_PLAYER: 4,

  // Explosions (game coordinates)
  EXPLOSION_RADIUS: 0.8,
  
  // Terrain generation (circular obstacles)
  NUM_CIRCLES_MEAN: 15,
  NUM_CIRCLES_STD_DEV: 7,
  CIRCLE_MEAN_RADIUS: 2.5,
  CIRCLE_STD_DEV: 1.5,
  
  // Function evaluation
  FUNC_MAX_STEPS: 20000,
  FUNC_STEP_SIZE: 0.025,
  
  // Timing
  TURN_TIME: 60,               // seconds
  
  // Legacy compatibility
  MAX_PLAYERS: 2,
  MAX_HEALTH: 100,
  HIT_DAMAGE: 50,
  OBSTACLE_HIT_DAMAGE: 40,
  PROJECTILE_SPEED: 3,
  
  // Default grid config (matching original dimensions)
  DEFAULT_GRID: {
    width: 924,                 // 770 * 1.2 for higher resolution
    height: 540,                // 450 * 1.2
    xMin: -25,
    xMax: 25,
    yMin: -15,
    yMax: 15,
    gridSpacing: 1,
  } as GridConfig,
} as const;
