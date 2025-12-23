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
 * Player information (with multiple soldiers like original Graphwar)
 */
export interface Player {
  id: string;
  name: string;
  team: 'red' | 'blue';
  color: string; // Player color (hex)
  soldiers: Soldier[]; // Multiple soldiers per player
  currentSoldierIndex: number; // Which soldier is currently active
  isAlive: boolean; // True if any soldier is alive
  // Legacy compatibility
  position: Point; // Position of current soldier
  health: number;
  maxHealth: number;
}

/**
 * Soldier (individual unit, player can have multiple)
 */
export interface Soldier {
  id: string;
  position: Point;
  isAlive: boolean;
  angle: number; // Firing angle for 2nd order ODE mode (radians)
  killPosition?: number; // Step position where this soldier was hit
}

/**
 * Obstacle on the game field (rectangular - legacy)
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
 * Terrain with circular obstacles (original Graphwar)
 */
export interface Terrain {
  circles: CircleObstacle[];
  explosions: { x: number; y: number; radius: number }[];
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
 * Visual effect for explosions
 */
export interface Explosion {
  id: string;
  position: Point;
  radius: number;
  maxRadius: number;
  opacity: number;
  color: string;
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
  timeLeft?: number;
  currentSoldierIndex?: number; // Which soldier of the current player is firing
}

/**
 * Game mode (matching original Graphwar)
 */
export type GameMode = 'normal' | 'first_order_ode' | 'second_order_ode';

/**
 * Complete game state
 */
export interface GameState {
  roomId: string;
  players: Player[];
  obstacles: Obstacle[];
  terrain: Terrain | null; // Circular obstacles terrain
  projectile: Projectile | null;
  turn: TurnState;
  gridConfig: GridConfig;
  gameMode: GameMode;
  winner: string | null; // Player ID or null
  winnerTeam: Player['team'] | null;
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
  projectileFired: { path: Point[]; playerId: string; functionString: string };
  playerHit: { playerId: string; damage: number };
  obstacleDamaged: { obstacle: Obstacle };
  obstacleDestroyed: { obstacleId: string };
  gameOver: { winnerId: string | null; winnerTeam: Player['team'] | null };
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

  // Game modes
  MODE_NORMAL: 'Hàm số (y)',
  MODE_ODE1: "ODE bậc 1 (y')",
  MODE_ODE2: "ODE bậc 2 (y'')",
  MODE_FIRST_ORDER: "ODE bậc 1 (y')",
  MODE_SECOND_ORDER: "ODE bậc 2 (y'')",

  // Buttons
  BTN_FIRE: 'Bắn',
  BTN_READY: 'Sẵn sàng',
  BTN_NEW_GAME: 'Ván mới',
  BTN_JOIN: 'Tham gia',
  BTN_CREATE_ROOM: 'Tạo phòng',
  BTN_ADD_SOLDIER: 'Thêm lính',
  BTN_REMOVE_SOLDIER: 'Bớt lính',
  BTN_SWITCH_TEAM: 'Đổi đội',

  // Labels
  LABEL_PLAYER: 'Người chơi',
  LABEL_TURN: 'Lượt',
  LABEL_HEALTH: 'Máu',
  LABEL_YOUR_TURN: 'Lượt của bạn!',
  LABEL_OPPONENT_TURN: 'Lượt đối thủ',
  LABEL_ROOM_ID: 'Mã phòng',
  LABEL_PLAYER_NAME: 'Tên người chơi',
  LABEL_SOLDIERS: 'Lính',
  LABEL_ANGLE: 'Góc bắn',
  LABEL_GAME_MODE: 'Chế độ chơi',

  // Input
  INPUT_PLACEHOLDER: 'Nhập hàm số của bạn (vd: sin(x))...',
  INPUT_PLACEHOLDER_ODE1: "Nhập y' = f(x,y) (vd: y' = -y/3)...",
  INPUT_PLACEHOLDER_ODE2: "Nhập y'' = f(x,y,y') (vd: y'' = -y)...",
  INPUT_EXAMPLE: 'Ví dụ: sin(x), x^2, 2*x + 1',
  INPUT_EXAMPLE_ODE1: "Ví dụ: y' = 3*sin(x)+2, y' = -y/3",
  INPUT_EXAMPLE_ODE2: "Ví dụ: y'' = -y, y'' = 4*sin(x)",

  // Messages
  MSG_WAITING_OPPONENT: 'Đang chờ đối thủ tham gia...',
  MSG_GAME_STARTED: 'Trò chơi bắt đầu!',
  MSG_TURN_ENDED: 'Kết thúc lượt',
  MSG_YOU_WIN: 'Bạn thắng!',
  MSG_YOU_LOSE: 'Bạn thua!',
  MSG_PLAYER_HIT: 'đã bị trúng đạn!',
  MSG_SOLDIER_KILLED: 'Lính bị tiêu diệt!',
  MSG_OBSTACLE_DESTROYED: 'Chướng ngại vật bị phá hủy!',
  MSG_FUNCTION_EXPLODED: 'Hàm số phát nổ!',

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
 * Game modes (matching original Graphwar)
 */
export type GameMode = 'normal' | 'first_order_ode' | 'second_order_ode';

export const GAME_MODE_LABELS: Record<GameMode, string> = {
  normal: 'Hàm số (y)',
  first_order_ode: 'ODE bậc 1 (y\')',
  second_order_ode: 'ODE bậc 2 (y\'\')',
};

/**
 * Soldier (unit within a player - original has multiple soldiers per player)
 */
export interface Soldier {
  id: string;
  position: Point;
  isAlive: boolean;
  angle: number; // Firing angle for 2nd order ODE mode (radians)
}

/**
 * Circular obstacle for terrain (matching original)
 */
export interface CircleObstacle {
  x: number;
  y: number;
  radius: number;
}

/**
 * Default grid configuration
 * Matching original Graphwar: PLANE_LENGTH=770px, PLANE_HEIGHT=450px
 * Game coordinates: x from -25 to 25, y from -15 to 15 (PLANE_GAME_LENGTH=50)
 */
export const DEFAULT_GRID_CONFIG: GridConfig = {
  width: 924, // 770 * 1.2 for better resolution
  height: 540, // 450 * 1.2
  xMin: -25,
  xMax: 25,
  yMin: -15,
  yMax: 15,
  gridSpacing: 1,
};

/**
 * Game constants (matching original Graphwar values)
 */
export const GAME_CONSTANTS = {
  // Player/Soldier dimensions
  // IMPORTANT: All collision math uses GAME COORDINATES, not pixels.
  // With x range 50 units and plane width ~770px, 7px ~= 0.45 game units.
  SOLDIER_RADIUS: 0.45,
  PLAYER_RADIUS: 12, // Visual radius for rendering
  PROJECTILE_RADIUS: 4,
  
  // Projectile animation
  PROJECTILE_SPEED: 4, // Points per frame
  FUNCTION_VELOCITY: 1500, // Steps per second (original)
  
  // Health & Damage
  MAX_HEALTH: 100,
  HIT_DAMAGE: 100, // One hit kills a soldier (original behavior)
  OBSTACLE_HIT_DAMAGE: 40,
  
  // Turn timing
  TURN_TIME: 60, // seconds (original: 60000ms)
  NEXT_TURN_DELAY: 3000, // ms delay after hit before next turn
  
  // Function calculation
  FUNC_MAX_STEPS: 20000,
  STEP_SIZE: 0.01,
  PATH_RESOLUTION: 0.02,
  
  // Explosions
  // Explosion crater radius in GAME COORDINATES (roughly 12px in the original plane)
  EXPLOSION_RADIUS: 0.8,
  
  // Soldiers per player
  MAX_SOLDIERS_PER_PLAYER: 4,
  INITIAL_SOLDIERS: 2,
  
  // Max players
  MAX_PLAYERS: 10,
  
  // Animation
  ANIMATION_FPS: 60,
  
  // Terrain generation (circular obstacles)
  NUM_CIRCLES_MEAN: 15,
  NUM_CIRCLES_STD_DEV: 7,
  CIRCLE_MEAN_RADIUS: 2.5, // In game coordinates (~40px in 770px plane)
  CIRCLE_STD_DEV: 1.5,
} as const;
