/**
 * Game State Store (Zustand)
 * Manages all game state including players, projectiles, and turn logic
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import {
  GameState,
  Player,
  Obstacle,
  Projectile,
  TurnState,
  GamePhase,
  Point,
  GridConfig,
  DEFAULT_GRID_CONFIG,
  GAME_CONSTANTS,
} from '@/types';
import { parseMathFunction, generateTrajectory } from '@/lib/math';

interface GameStore extends GameState {
  // Connection state
  myPlayerId: string | null;
  isConnected: boolean;

  // Actions
  setMyPlayerId: (id: string) => void;
  setConnected: (connected: boolean) => void;
  setRoomId: (roomId: string) => void;

  // Player actions
  addPlayer: (player: Player) => void;
  removePlayer: (playerId: string) => void;
  updatePlayer: (playerId: string, updates: Partial<Player>) => void;
  damagePlayer: (playerId: string, damage: number) => void;
  damageObstacle: (obstacleId: string, damage: number) => void;

  // Turn actions
  setPhase: (phase: GamePhase) => void;
  nextTurn: () => void;
  setCurrentPlayer: (playerId: string) => void;

  // Projectile actions
  fireProjectile: (functionString: string) => boolean;
  clearProjectile: () => void;

  // Obstacle actions
  addObstacle: (obstacle: Obstacle) => void;
  destroyObstacle: (obstacleId: string) => void;

  // Game flow
  startGame: () => void;
  endGame: (winnerId: string | null, winnerTeam?: Player['team'] | null) => void;
  resetGame: () => void;

  // State sync (for multiplayer)
  syncGameState: (state: Partial<GameState>) => void;

  // Utility
  getCurrentPlayer: () => Player | undefined;
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

// Generate random position within grid bounds
function randomPosition(gridConfig: GridConfig, team: 'red' | 'blue'): Point {
  const { xMin, xMax, yMin, yMax } = gridConfig;
  
  // Red team on left side, blue team on right side
  const xRange = team === 'red'
    ? { min: xMin + 2, max: xMin + (xMax - xMin) * 0.3 }
    : { min: xMax - (xMax - xMin) * 0.3, max: xMax - 2 };

  return {
    x: xRange.min + Math.random() * (xRange.max - xRange.min),
    y: yMin + 2 + Math.random() * (yMax - yMin - 4),
  };
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
  | 'setMyPlayerId' | 'setConnected' | 'setRoomId'
  | 'addPlayer' | 'removePlayer' | 'updatePlayer' | 'damagePlayer' | 'damageObstacle'
  | 'setPhase' | 'nextTurn' | 'setCurrentPlayer'
  | 'fireProjectile' | 'clearProjectile'
  | 'addObstacle' | 'destroyObstacle'
  | 'startGame' | 'endGame' | 'resetGame'
  | 'syncGameState' | 'getCurrentPlayer' | 'isMyTurn'
> = {
  roomId: '',
  players: [],
  obstacles: [],
  projectile: null,
  turn: {
    currentPlayerId: '',
    turnNumber: 0,
    phase: 'waiting',
  },
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

      damagePlayer: (playerId, damage) => set((state) => {
        const players = state.players.map((p) => {
          if (p.id !== playerId) return p;
          
          const newHealth = Math.max(0, p.health - damage);
          return {
            ...p,
            health: newHealth,
            isAlive: newHealth > 0,
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

        return {
          turn: {
            currentPlayerId: alivePlayers[nextIndex].id,
            turnNumber: state.turn.turnNumber + 1,
            phase: 'input',
          },
          projectile: null,
        };
      }),

      setCurrentPlayer: (playerId) => set((state) => ({
        turn: { ...state.turn, currentPlayerId: playerId },
      })),

      // Projectile actions
      fireProjectile: (functionString) => {
        const state = get();
        const currentPlayer = state.players.find(
          (p) => p.id === state.turn.currentPlayerId
        );

        if (!currentPlayer) return false;

        // Determine firing direction based on team
        const direction = currentPlayer.team === 'red' ? 'right' : 'left';

        // Generate trajectory
        const result = generateTrajectory(
          functionString,
          currentPlayer.position,
          direction,
          state.gridConfig
        );

        if (!result.success) return false;

        set({
          projectile: {
            currentPosition: result.points[0],
            path: result.points,
            pathIndex: 0,
            isActive: true,
            owner: currentPlayer.id,
          },
          turn: {
            ...state.turn,
            phase: 'animating',
            lastFunction: functionString,
          },
        });

        return true;
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

      // Game flow
      startGame: () => {
        const state = get();
        
        // Initialize player positions if not set
        const initializedPlayers: Player[] = state.players.map((player, index) => ({
          ...player,
          position: player.position.x === 0 && player.position.y === 0
            ? randomPosition(state.gridConfig, index === 0 ? 'red' : 'blue')
            : player.position,
          team: (index === 0 ? 'red' : 'blue') as Player['team'],
          health: GAME_CONSTANTS.MAX_HEALTH,
          maxHealth: GAME_CONSTANTS.MAX_HEALTH,
          isAlive: true,
        }));

        set({
          players: initializedPlayers,
          obstacles: generateObstacles(state.gridConfig),
          turn: {
            currentPlayerId: initializedPlayers[0]?.id || '',
            turnNumber: 1,
            phase: 'input',
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

export const useMyPlayer = () => useGameStore((state) => 
  state.players.find((p) => p.id === state.myPlayerId)
);

export const useIsMyTurn = () => useGameStore((state) => 
  state.turn.currentPlayerId === state.myPlayerId
);

export const useGamePhase = () => useGameStore((state) => state.turn.phase);

export const useTurnNumber = () => useGameStore((state) => state.turn.turnNumber);
