// ============================================
// Game Types & Interfaces
// All UI-facing strings should be in Vietnamese
// Code conventions remain in English
// ============================================

/**
 * Represents a 2D point on the Cartesian grid
 */
export interface Point {
  x: number;
  y: number;
}

/**
 * Player information
 */
export interface Player {
  id: string;
  name: string;
  team: 'red' | 'blue';
  position: Point;
  health: number;
  maxHealth: number;
  isAlive: boolean;
}

/**
 * Obstacle on the game field
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
 * Projectile state during animation
 */
export interface Projectile {
  currentPosition: Point;
  path: Point[];
  pathIndex: number;
  isActive: boolean;
  owner: string; // Player ID
}

/**
 * Result of parsing a mathematical function
 */
export interface ParseResult {
  success: boolean;
  points: Point[];
  error?: string; // Vietnamese error message
}

/**
 * Game phase enumeration
 */
export type GamePhase = 
  | 'waiting'      // Chờ người chơi
  | 'ready'        // Sẵn sàng
  | 'input'        // Nhập hàm số
  | 'firing'       // Đang bắn
  | 'animating'    // Đang di chuyển
  | 'hit'          // Trúng đích
  | 'miss'         // Trượt
  | 'gameover';    // Kết thúc

/**
 * Turn information
 */
export interface TurnState {
  currentPlayerId: string;
  turnNumber: number;
  phase: GamePhase;
  lastFunction?: string;
}

/**
 * Complete game state
 */
export interface GameState {
  roomId: string;
  players: Player[];
  obstacles: Obstacle[];
  projectile: Projectile | null;
  turn: TurnState;
  gridConfig: GridConfig;
  winner: string | null; // Player ID or null
}

/**
 * Grid configuration
 */
export interface GridConfig {
  width: number;      // Canvas width in pixels
  height: number;     // Canvas height in pixels
  xMin: number;       // Minimum x value on grid
  xMax: number;       // Maximum x value on grid
  yMin: number;       // Minimum y value on grid
  yMax: number;       // Maximum y value on grid
  gridSpacing: number; // Grid line spacing
}

/**
 * Socket event payloads
 */
export interface SocketEvents {
  // Client -> Server
  joinRoom: { roomId: string; playerName: string };
  submitFunction: { roomId: string; playerId: string; functionString: string };
  playerReady: { roomId: string; playerId: string };

  // Server -> Client
  roomJoined: { gameState: GameState; playerId: string };
  gameStarted: { gameState: GameState };
  turnUpdate: { turn: TurnState };
  projectileFired: { path: Point[]; playerId: string };
  playerHit: { playerId: string; damage: number };
  obstacleDestroyed: { obstacleId: string };
  gameOver: { winnerId: string };
  error: { message: string }; // Vietnamese error message
}

/**
 * Vietnamese UI text constants
 */
export const UI_TEXT = {
  // Game phases
  PHASE_WAITING: 'Chờ người chơi...',
  PHASE_READY: 'Sẵn sàng!',
  PHASE_INPUT: 'Nhập hàm số',
  PHASE_FIRING: 'Đang bắn...',
  PHASE_ANIMATING: 'Đang di chuyển...',
  PHASE_HIT: 'Trúng đích!',
  PHASE_MISS: 'Trượt!',
  PHASE_GAMEOVER: 'Kết thúc trò chơi',

  // Buttons
  BTN_FIRE: 'Bắn',
  BTN_READY: 'Sẵn sàng',
  BTN_NEW_GAME: 'Ván mới',
  BTN_JOIN: 'Tham gia',
  BTN_CREATE_ROOM: 'Tạo phòng',

  // Labels
  LABEL_PLAYER: 'Người chơi',
  LABEL_TURN: 'Lượt',
  LABEL_HEALTH: 'Máu',
  LABEL_YOUR_TURN: 'Lượt của bạn!',
  LABEL_OPPONENT_TURN: 'Lượt đối thủ',
  LABEL_ROOM_ID: 'Mã phòng',
  LABEL_PLAYER_NAME: 'Tên người chơi',

  // Input
  INPUT_PLACEHOLDER: 'Nhập hàm số của bạn (vd: sin(x))...',
  INPUT_EXAMPLE: 'Ví dụ: sin(x), x^2, 2*x + 1',

  // Messages
  MSG_WAITING_OPPONENT: 'Đang chờ đối thủ tham gia...',
  MSG_GAME_STARTED: 'Trò chơi bắt đầu!',
  MSG_TURN_ENDED: 'Kết thúc lượt',
  MSG_YOU_WIN: 'Bạn thắng!',
  MSG_YOU_LOSE: 'Bạn thua!',
  MSG_PLAYER_HIT: 'đã bị trúng đạn!',
  MSG_OBSTACLE_DESTROYED: 'Chướng ngại vật bị phá hủy!',

  // Team names
  TEAM_RED: 'Đội Đỏ',
  TEAM_BLUE: 'Đội Xanh',

  // Tooltips
  TOOLTIP_FUNCTION_HELP: 'Sử dụng các hàm như sin(x), cos(x), tan(x), sqrt(x), abs(x), log(x), x^n',
} as const;

/**
 * Vietnamese error messages for math parsing
 */
export const MATH_ERRORS = {
  INVALID_SYNTAX: 'Cú pháp không hợp lệ',
  DIVISION_BY_ZERO: 'Lỗi chia cho 0',
  UNDEFINED_VARIABLE: 'Biến không xác định',
  UNKNOWN_FUNCTION: 'Hàm không được hỗ trợ',
  EMPTY_INPUT: 'Vui lòng nhập hàm số',
  INVALID_RESULT: 'Kết quả không hợp lệ',
  OUT_OF_RANGE: 'Giá trị vượt quá phạm vi cho phép',
  PARSE_ERROR: 'Không thể phân tích biểu thức',
  COMPLEX_NUMBER: 'Kết quả là số phức (không hỗ trợ)',
} as const;

/**
 * Default grid configuration
 */
export const DEFAULT_GRID_CONFIG: GridConfig = {
  width: 800,
  height: 600,
  xMin: -20,
  xMax: 20,
  yMin: -15,
  yMax: 15,
  gridSpacing: 1,
};

/**
 * Game constants
 */
export const GAME_CONSTANTS = {
  PLAYER_RADIUS: 15,
  PROJECTILE_RADIUS: 5,
  PROJECTILE_SPEED: 3, // Points per frame
  MAX_HEALTH: 100,
  HIT_DAMAGE: 50,
  ANIMATION_FPS: 60,
  PATH_RESOLUTION: 0.05, // X increment for path calculation
} as const;
