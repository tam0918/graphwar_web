/**
 * Game State Store (Zustand)
 * Manages all game state including players, projectiles, and turn logic
 * Updated to match original Graphwar with multiple soldiers per player
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import {
  GameState,
  Player,
  Soldier,
  Obstacle,
  Projectile,
  TurnState,
  GamePhase,
  GameMode,
  Point,
  GridConfig,
  Terrain,
  DEFAULT_GRID_CONFIG,
  GAME_CONSTANTS,
} from '@/types';
import { generateTrajectory, generateTerrain } from '@/lib/math';

// Player colors (matching original Graphwar colors)
const PLAYER_COLORS = [
  '#FF6B6B', '#4ECDC4', '#FFE66D', '#95E1D3',
  '#F38181', '#AA96DA', '#FCBAD3', '#A8D8EA',
  '#FF9F43', '#6C5CE7',
];

interface GameStore extends GameState {
  // Connection state
  myPlayerId: string | null;
  isConnected: boolean;

  // Actions
  setMyPlayerId: (id: string) => void;
  setConnected: (connected: boolean) => void;
  setRoomId: (roomId: string) => void;
  setGameMode: (mode: GameMode) => void;

  // Player actions
  addPlayer: (player: Player) => void;
  removePlayer: (playerId: string) => void;
  updatePlayer: (playerId: string, updates: Partial<Player>) => void;
  damagePlayer: (playerId: string, damage: number) => void;
  damageObstacle: (obstacleId: string, damage: number) => void;
  
  // Soldier actions
  addSoldier: (playerId: string) => void;
  removeSoldier: (playerId: string) => void;
  killSoldier: (playerId: string, soldierIndex: number) => void;
  setSoldierAngle: (playerId: string, soldierIndex: number, angle: number) => void;

  // Turn actions
  setPhase: (phase: GamePhase) => void;
  nextTurn: () => void;
  setCurrentPlayer: (playerId: string) => void;

  // Projectile actions
  fireProjectile: (functionString: string) => boolean;
  fireProjectileForPlayer: (playerId: string, functionString: string) => boolean;
  clearProjectile: () => void;

  // Obstacle actions
  addObstacle: (obstacle: Obstacle) => void;
  destroyObstacle: (obstacleId: string) => void;
  
  // Terrain actions
  addTerrainExplosion: (x: number, y: number, radius: number) => void;

  // Game flow
  startGame: () => void;
  endGame: (winnerId: string | null, winnerTeam?: Player['team'] | null) => void;
  resetGame: () => void;

  // State sync (for multiplayer)
  syncGameState: (state: Partial<GameState>) => void;

  // Utility
  getCurrentPlayer: () => Player | undefined;
  getCurrentSoldier: () => Soldier | undefined;
  isMyTurn: () => boolean;
}

// Ensure we never keep duplicate player IDs
function upsertPlayers(existing: Player[], incoming: Player[]): Player[] {
  const map = new Map<string, Player>();
  for (const p of existing) {
    map.set(p.id, p);
  }
  for (const p of incoming) {
    map.set(p.id, { ...map.get(p.id), ...p });
  }
  return Array.from(map.values());
}

// Generate unique soldier ID
function generateSoldierId(): string {
  return `soldier-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

// Generate random position within grid bounds for a soldier
function randomSoldierPosition(gridConfig: GridConfig, team: 'red' | 'blue'): Point {
  const { xMin, xMax, yMin, yMax } = gridConfig;
  
  // Red team on left half (x < 0), Blue team on right half (x > 0)
  // This matches original Graphwar where TEAM1 is left, TEAM2 is right
  const xRange = team === 'red'
    ? { min: xMin + 1, max: -1 } // Left half
    : { min: 1, max: xMax - 1 }; // Right half

  return {
    x: xRange.min + Math.random() * (xRange.max - xRange.min),
    y: yMin + 2 + Math.random() * (yMax - yMin - 4),
  };
}

// Create initial soldiers for a player
function createInitialSoldiers(gridConfig: GridConfig, team: 'red' | 'blue', count: number = GAME_CONSTANTS.INITIAL_SOLDIERS): Soldier[] {
  const soldiers: Soldier[] = [];
  for (let i = 0; i < count; i++) {
    soldiers.push({
      id: generateSoldierId(),
      position: randomSoldierPosition(gridConfig, team),
      isAlive: true,
      angle: 0,
    });
  }
  return soldiers;
}

// Generate random obstacles
function generateObstacles(gridConfig: GridConfig, count: number = 4): Obstacle[] {
  const obstacles: Obstacle[] = [];
  const { xMin, xMax, yMin, yMax } = gridConfig;

  const obstacleCount = count + Math.floor(Math.random() * 4); // 4-7 obstacles

  for (let i = 0; i < obstacleCount; i++) {
    const sizeFactor = 0.5 + Math.random() * 1.5;
    const health = 80 + Math.floor(Math.random() * 60);

    obstacles.push({
      id: `obstacle-${i}`,
      position: {
        x: xMin + (xMax - xMin) * (0.1 + Math.random() * 0.8),
        y: yMin + (yMax - yMin) * (0.1 + Math.random() * 0.8),
      },
      width: (1.2 + Math.random() * 2.8) * sizeFactor,
      height: (1.2 + Math.random() * 2.8) * sizeFactor,
      health,
      isDestroyed: false,
    });
  }

  return obstacles;
}

// Initial state
const initialState: Omit<GameStore, 
  | 'setMyPlayerId' | 'setConnected' | 'setRoomId' | 'setGameMode'
  | 'addPlayer' | 'removePlayer' | 'updatePlayer' | 'damagePlayer' | 'damageObstacle'
  | 'addSoldier' | 'removeSoldier' | 'killSoldier' | 'setSoldierAngle'
  | 'setPhase' | 'nextTurn' | 'setCurrentPlayer'
  | 'fireProjectile' | 'fireProjectileForPlayer' | 'clearProjectile'
  | 'addObstacle' | 'destroyObstacle' | 'addTerrainExplosion'
  | 'startGame' | 'endGame' | 'resetGame'
  | 'syncGameState' | 'getCurrentPlayer' | 'getCurrentSoldier' | 'isMyTurn'
> = {
  roomId: '',
  players: [],
  obstacles: [],
  terrain: null,
  projectile: null,
  turn: {
    currentPlayerId: '',
    turnNumber: 0,
    phase: 'waiting',
    currentSoldierIndex: 0,
  },
  gameMode: 'normal',
  gridConfig: DEFAULT_GRID_CONFIG,
  winner: null,
  winnerTeam: null,
  myPlayerId: null,
  isConnected: false,
};

export const useGameStore = create<GameStore>()(
  devtools(
    (set, get) => ({
      ...initialState,

      // Connection actions
      setMyPlayerId: (id) => set({ myPlayerId: id }),
      setConnected: (connected) => set({ isConnected: connected }),
      setRoomId: (roomId) => set({ roomId }),
      setGameMode: (mode) => set({ gameMode: mode }),

      // Player actions
      addPlayer: (player) => set((state) => ({
        players: upsertPlayers(state.players, [player]),
      })),

      removePlayer: (playerId) => set((state) => ({
        players: state.players.filter((p) => p.id !== playerId),
      })),

      updatePlayer: (playerId, updates) => set((state) => ({
        players: state.players.map((p) =>
          p.id === playerId ? { ...p, ...updates } : p
        ),
      })),

      // Soldier actions
      addSoldier: (playerId) => set((state) => {
        const player = state.players.find(p => p.id === playerId);
        if (!player || player.soldiers.length >= GAME_CONSTANTS.MAX_SOLDIERS_PER_PLAYER) return state;
        
        const newSoldier: Soldier = {
          id: generateSoldierId(),
          position: randomSoldierPosition(state.gridConfig, player.team),
          isAlive: true,
          angle: 0,
        };
        
        return {
          players: state.players.map(p =>
            p.id === playerId
              ? { ...p, soldiers: [...p.soldiers, newSoldier] }
              : p
          ),
        };
      }),

      removeSoldier: (playerId) => set((state) => {
        const player = state.players.find(p => p.id === playerId);
        if (!player || player.soldiers.length <= 1) return state;
        
        return {
          players: state.players.map(p =>
            p.id === playerId
              ? { ...p, soldiers: p.soldiers.slice(0, -1) }
              : p
          ),
        };
      }),

      killSoldier: (playerId, soldierIndex) => set((state) => {
        const players = state.players.map((p) => {
          if (p.id !== playerId) return p;
          
          const soldiers = p.soldiers.map((s, i) =>
            i === soldierIndex ? { ...s, isAlive: false } : s
          );
          
          // Check if player has any alive soldiers
          const hasAliveSoldiers = soldiers.some(s => s.isAlive);
          
          return {
            ...p,
            soldiers,
            isAlive: hasAliveSoldiers,
          };
        });

        // Check for winner by remaining teams
        const alivePlayers = players.filter((p) => p.isAlive);
        const aliveTeams = new Set(alivePlayers.map((p) => p.team));
        const winner = aliveTeams.size <= 1 ? (alivePlayers[0]?.id ?? null) : null;
        const winnerTeam = aliveTeams.size <= 1 ? (alivePlayers[0]?.team ?? null) : null;

        return {
          players,
          winner,
          winnerTeam,
          turn: winner ? { ...state.turn, phase: 'gameover' } : state.turn,
        };
      }),

      setSoldierAngle: (playerId, soldierIndex, angle) => set((state) => ({
        players: state.players.map((p) =>
          p.id === playerId
            ? {
                ...p,
                soldiers: p.soldiers.map((s, i) =>
                  i === soldierIndex ? { ...s, angle } : s
                ),
              }
            : p
        ),
      })),

      damagePlayer: (playerId, damage) => set((state) => {
        const players = state.players.map((p) => {
          if (p.id !== playerId) return p;
          
          const newHealth = Math.max(0, p.health - damage);
          const isAlive = newHealth > 0 && p.soldiers.some(s => s.isAlive);
          return {
            ...p,
            health: newHealth,
            isAlive,
          };
        });

        // Check for winner by remaining teams
        const alivePlayers = players.filter((p) => p.isAlive);
        const aliveTeams = new Set(alivePlayers.map((p) => p.team));
        const winner = aliveTeams.size <= 1 ? (alivePlayers[0]?.id ?? null) : null;
        const winnerTeam = aliveTeams.size <= 1 ? (alivePlayers[0]?.team ?? null) : null;

        return {
          players,
          winner,
          winnerTeam,
          turn: winner ? { ...state.turn, phase: 'gameover' } : state.turn,
        };
      }),

      damageObstacle: (obstacleId, damage) => set((state) => {
        const obstacles = state.obstacles.map((o) => {
          if (o.id !== obstacleId) return o;

          const newHealth = Math.max(0, o.health - damage);
          const healthRatio = Math.max(0.1, newHealth / 100);

          return {
            ...o,
            health: newHealth,
            width: Math.max(0.5, o.width * healthRatio),
            height: Math.max(0.5, o.height * healthRatio),
            isDestroyed: newHealth === 0,
          };
        });

        return { obstacles };
      }),

      // Turn actions
      setPhase: (phase) => set((state) => ({
        turn: { ...state.turn, phase },
      })),

      nextTurn: () => set((state) => {
        if (state.turn.phase === 'gameover') return state;

        const alivePlayers = state.players.filter((p) => p.isAlive);
        if (alivePlayers.length < 2) return state;

        const currentIndex = alivePlayers.findIndex(
          (p) => p.id === state.turn.currentPlayerId
        );
        const nextIndex = (currentIndex + 1) % alivePlayers.length;
        
        // Find next alive soldier for the next player
        const nextPlayer = alivePlayers[nextIndex];
        const nextSoldierIndex = nextPlayer.soldiers.findIndex(s => s.isAlive);

        return {
          turn: {
            currentPlayerId: nextPlayer.id,
            turnNumber: state.turn.turnNumber + 1,
            phase: 'input',
            currentSoldierIndex: nextSoldierIndex >= 0 ? nextSoldierIndex : 0,
          },
          projectile: null,
        };
      }),

      setCurrentPlayer: (playerId) => set((state) => ({
        turn: { ...state.turn, currentPlayerId: playerId },
      })),

      // Projectile actions
      fireProjectileForPlayer: (playerId, functionString) => {
        const state = get();
        const shooter = state.players.find((p) => p.id === playerId);
        if (!shooter) return false;
        
        // Get current soldier
        const soldierIndex = state.turn.currentSoldierIndex || 0;
        const soldier = shooter.soldiers[soldierIndex];
        if (!soldier || !soldier.isAlive) return false;

        const direction = shooter.team === 'red' ? 'right' : 'left';
        const result = generateTrajectory(
          functionString,
          soldier.position, // Use soldier's position instead of player position
          direction,
          state.gridConfig,
          state.gameMode,
          soldier.angle, // For 2nd order ODE
          state.terrain || undefined
        );

        if (!result.success) return false;

        set({
          projectile: {
            currentPosition: result.points[0],
            path: result.points,
            pathIndex: 0,
            isActive: true,
            owner: shooter.id,
          },
          turn: {
            ...state.turn,
            phase: 'animating',
            lastFunction: functionString,
          },
        });

        return true;
      },

      fireProjectile: (functionString) => {
        const state = get();
        const currentPlayerId = state.turn.currentPlayerId;
        if (!currentPlayerId) return false;
        return get().fireProjectileForPlayer(currentPlayerId, functionString);
      },

      clearProjectile: () => set({
        projectile: null,
      }),

      // Obstacle actions
      addObstacle: (obstacle) => set((state) => ({
        obstacles: [...state.obstacles, obstacle],
      })),

      destroyObstacle: (obstacleId) => set((state) => ({
        obstacles: state.obstacles.map((o) =>
          o.id === obstacleId ? { ...o, isDestroyed: true } : o
        ),
      })),
      
      // Terrain actions
      addTerrainExplosion: (x, y, radius) => set((state) => {
        if (!state.terrain) return state;
        
        return {
          terrain: {
            ...state.terrain,
            explosions: [...state.terrain.explosions, { x, y, radius }],
          },
        };
      }),

      // Game flow
      startGame: () => {
        const state = get();
        
        // Generate terrain with circular obstacles
        const terrain = generateTerrain(state.gridConfig);
        
        // Initialize players with soldiers
        const initializedPlayers: Player[] = state.players.map((player, index) => {
          const team = (index % 2 === 0 ? 'red' : 'blue') as Player['team'];
          const soldiers = createInitialSoldiers(state.gridConfig, team);
          
          return {
            ...player,
            position: soldiers[0]?.position || { x: 0, y: 0 },
            team,
            health: GAME_CONSTANTS.MAX_HEALTH,
            maxHealth: GAME_CONSTANTS.MAX_HEALTH,
            isAlive: true,
            soldiers,
            color: PLAYER_COLORS[index % PLAYER_COLORS.length],
          };
        });

        set({
          players: initializedPlayers,
          obstacles: [], // Using terrain.circles instead
          terrain,
          turn: {
            currentPlayerId: initializedPlayers[0]?.id || '',
            turnNumber: 1,
            phase: 'input',
            currentSoldierIndex: 0,
          },
          winner: null,
          winnerTeam: null,
          projectile: null,
        });
      },

      endGame: (winnerId, winnerTeam = null) => set({
        winner: winnerId,
        winnerTeam,
        turn: { ...get().turn, phase: 'gameover' },
      }),

      resetGame: () => set({
        ...initialState,
        myPlayerId: get().myPlayerId,
        isConnected: get().isConnected,
        roomId: get().roomId,
      }),

      // State sync for multiplayer
      syncGameState: (newState) => set((state) => {
        const mergedPlayers = newState.players
          ? upsertPlayers(state.players, newState.players)
          : state.players;

        return {
          ...state,
          ...newState,
          players: mergedPlayers,
        };
      }),

      // Utility functions
      getCurrentPlayer: () => {
        const state = get();
        return state.players.find((p) => p.id === state.turn.currentPlayerId);
      },
      
      getCurrentSoldier: () => {
        const state = get();
        const player = state.players.find((p) => p.id === state.turn.currentPlayerId);
        if (!player) return undefined;
        return player.soldiers[state.turn.currentSoldierIndex || 0];
      },

      isMyTurn: () => {
        const state = get();
        return state.turn.currentPlayerId === state.myPlayerId;
      },
    }),
    { name: 'GraphwarGameStore' }
  )
);

// Selector hooks for specific state slices
export const useCurrentPlayer = () => useGameStore((state) => 
  state.players.find((p) => p.id === state.turn.currentPlayerId)
);

export const useCurrentSoldier = () => useGameStore((state) => {
  const player = state.players.find((p) => p.id === state.turn.currentPlayerId);
  if (!player) return undefined;
  return player.soldiers[state.turn.currentSoldierIndex || 0];
});

export const useMyPlayer = () => useGameStore((state) => 
  state.players.find((p) => p.id === state.myPlayerId)
);

export const useIsMyTurn = () => useGameStore((state) => 
  state.turn.currentPlayerId === state.myPlayerId
);

export const useGamePhase = () => useGameStore((state) => state.turn.phase);

export const useTurnNumber = () => useGameStore((state) => state.turn.turnNumber);

export const useGameMode = () => useGameStore((state) => state.gameMode);

export const useTerrain = () => useGameStore((state) => state.terrain);
