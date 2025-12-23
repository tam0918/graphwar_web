'use client';

/**
 * Main Game Page
 * Integrates all game components
 * Updated to support original Graphwar mechanics
 */

import React, { useState, useEffect, useCallback } from 'react';
import { GameCanvas, ControlPanel, GameInfo, Chat } from '@/components/game';
import { useGameStore, useIsMyTurn, useGamePhase, useGameMode, useTerrain, useCurrentSoldier } from '@/stores';
import { parseMathFunction, generateTrajectory } from '@/lib/math';
import { UI_TEXT, GAME_CONSTANTS, DEFAULT_GRID_CONFIG, Point, GameMode, Soldier } from '@/types';
import { reportHit, reportMiss, submitFunction } from '@/lib/socket';

// For demo purposes, create a single-player local game
// In production, this would connect via Socket.io
function initializeDemoGame() {
  const store = useGameStore.getState();
  
  // Use startGame to properly initialize with soldiers and terrain
  // First set up demo players without soldiers
  const grid = DEFAULT_GRID_CONFIG;

  const demoPlayer1 = {
    id: 'player-1',
    name: 'Người chơi 1',
    team: 'red' as const,
    color: '#ff6b6b',
    soldiers: [] as Soldier[],
    currentSoldierIndex: 0,
    isAlive: true,
    position: { x: 0, y: 0 },
    health: GAME_CONSTANTS.MAX_HEALTH,
    maxHealth: GAME_CONSTANTS.MAX_HEALTH,
  };

  const demoPlayer2 = {
    id: 'player-2',
    name: 'Người chơi 2',
    team: 'blue' as const,
    color: '#4ecdc4',
    soldiers: [] as Soldier[],
    currentSoldierIndex: 0,
    isAlive: true,
    position: { x: 0, y: 0 },
    health: GAME_CONSTANTS.MAX_HEALTH,
    maxHealth: GAME_CONSTANTS.MAX_HEALTH,
  };

  store.addPlayer(demoPlayer1);
  store.addPlayer(demoPlayer2);

  // Set my player ID for local play
  store.setMyPlayerId('player-1');
  store.setRoomId('LOCAL');

  // Use startGame to initialize soldiers and terrain
  store.startGame();
}

export default function GamePage() {
  const [trajectoryPreview, setTrajectoryPreview] = useState<Point[]>([]);
  const [currentFunction, setCurrentFunction] = useState<string>('');
  const [notification, setNotification] = useState<string | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);

  // Store selectors
  const players = useGameStore((state) => state.players);
  const obstacles = useGameStore((state) => state.obstacles);
  const terrain = useTerrain();
  const projectile = useGameStore((state) => state.projectile);
  const turn = useGameStore((state) => state.turn);
  const gridConfig = useGameStore((state) => state.gridConfig);
  const myPlayerId = useGameStore((state) => state.myPlayerId);
  const roomId = useGameStore((state) => state.roomId);
  const winner = useGameStore((state) => state.winner);
  const isMyTurn = useIsMyTurn();
  const phase = useGamePhase();
  const gameMode = useGameMode();
  const currentSoldier = useCurrentSoldier();

  // Store actions
  const fireProjectile = useGameStore((state) => state.fireProjectile);
  const nextTurn = useGameStore((state) => state.nextTurn);
  const killSoldier = useGameStore((state) => state.killSoldier);
  const damagePlayer = useGameStore((state) => state.damagePlayer);
  const damageObstacle = useGameStore((state) => state.damageObstacle);
  const addTerrainExplosion = useGameStore((state) => state.addTerrainExplosion);
  const setPhase = useGameStore((state) => state.setPhase);
  const setGameMode = useGameStore((state) => state.setGameMode);
  const setSoldierAngle = useGameStore((state) => state.setSoldierAngle);
  const clearProjectile = useGameStore((state) => state.clearProjectile);
  const resetGame = useGameStore((state) => state.resetGame);

  // Initialize demo game on mount
  useEffect(() => {
    if (!isInitialized && players.length === 0) {
      initializeDemoGame();
      setIsInitialized(true);
    }
  }, [isInitialized, players.length]);

  // Show notification helper
  const showNotification = useCallback((message: string) => {
    setNotification(message);
    setTimeout(() => setNotification(null), 3000);
  }, []);

  // Handle function input for preview
  const handlePreviewFunction = useCallback((functionString: string) => {
    setCurrentFunction(functionString);
    
    const currentPlayer = players.find(p => p.id === turn.currentPlayerId);
    if (!currentPlayer || !functionString.trim()) {
      setTrajectoryPreview([]);
      return;
    }
    
    // Get current soldier position
    const soldierIndex = turn.currentSoldierIndex || 0;
    const soldier = currentPlayer.soldiers?.[soldierIndex];
    const position = soldier?.position || currentPlayer.position;
    const angle = soldier?.angle || 0;

    const direction = currentPlayer.team === 'red' ? 'right' : 'left';
    const result = generateTrajectory(
      functionString, 
      position, 
      direction, 
      gridConfig,
      gameMode,
      angle,
      terrain || undefined
    );
    
    if (result.success) {
      setTrajectoryPreview(result.points);
    } else {
      setTrajectoryPreview([]);
    }
  }, [players, turn.currentPlayerId, turn.currentSoldierIndex, gridConfig, gameMode, terrain]);

  // Handle fire action
  const handleFire = useCallback((functionString: string) => {
    if (roomId && roomId !== 'LOCAL' && myPlayerId) {
      submitFunction(roomId, myPlayerId, functionString);
      setCurrentFunction(functionString);
      setTrajectoryPreview([]);
      return;
    }

    const success = fireProjectile(functionString);
    
    if (success) {
      setCurrentFunction(functionString);
      setTrajectoryPreview([]);
      showNotification(`Bắn với hàm: ${functionString}`);
    } else {
      showNotification('Lỗi: Không thể bắn với hàm số này');
    }
  }, [fireProjectile, showNotification, roomId, myPlayerId]);

  // Handle game mode change
  const handleGameModeChange = useCallback((mode: GameMode) => {
    setGameMode(mode);
    setTrajectoryPreview([]);
    setCurrentFunction('');
  }, [setGameMode]);

  // Handle angle change for 2nd order ODE
  const handleAngleChange = useCallback((angle: number) => {
    if (myPlayerId) {
      const soldierIndex = turn.currentSoldierIndex || 0;
      setSoldierAngle(myPlayerId, soldierIndex, angle);
    }
  }, [myPlayerId, turn.currentSoldierIndex, setSoldierAngle]);

  // Handle animation complete
  const handleAnimationComplete = useCallback((result: {
    type: 'soldier' | 'obstacle' | 'terrain' | 'boundary' | 'miss';
    targetPlayerId?: string;
    targetSoldierIndex?: number;
    targetObstacleId?: string;
    impactPoint?: { x: number; y: number };
  }) => {
    // Clear projectile so we only resolve once
    clearProjectile();

    // If multiplayer, report to server and let server handle state
    if (roomId && roomId !== 'LOCAL') {
      reportHit({
        roomId,
        type: result.type,
        targetPlayerId: result.targetPlayerId,
        targetSoldierIndex: result.targetSoldierIndex,
        targetObstacleId: result.targetObstacleId,
        impactPoint: result.impactPoint,
      });
      return;
    }

    // Local play logic
    if (result.type === 'soldier' && result.targetPlayerId) {
      if (result.targetSoldierIndex !== undefined) {
        killSoldier(result.targetPlayerId, result.targetSoldierIndex);
      }
      const hitPlayer = players.find((p) => p.id === result.targetPlayerId);
      showNotification(`${hitPlayer?.name ?? 'Đối thủ'} - ${UI_TEXT.MSG_SOLDIER_KILLED}`);
      setPhase('hit');

      setTimeout(() => {
        const updated = useGameStore.getState();
        const alivePlayers = updated.players.filter((p) => p.isAlive);
        if (alivePlayers.length <= 1) {
          const winnerName = alivePlayers[0]?.name ?? 'Hòa';
          showNotification(`${winnerName} ${UI_TEXT.MSG_YOU_WIN}`);
          return;
        }
        nextTurn();
      }, 800);
      return;
    }
    
    if (result.type === 'terrain') {
      // Add explosion crater at impact point
      setPhase('hit');
      showNotification(UI_TEXT.MSG_FUNCTION_EXPLODED);
      if (result.impactPoint) {
        addTerrainExplosion(result.impactPoint.x, result.impactPoint.y, GAME_CONSTANTS.EXPLOSION_RADIUS);
      }
      setTimeout(() => {
        nextTurn();
      }, 500);
      return;
    }

    if (result.type === 'obstacle' && result.targetObstacleId) {
      damageObstacle(result.targetObstacleId, GAME_CONSTANTS.OBSTACLE_HIT_DAMAGE);
      setPhase('hit');
      showNotification(UI_TEXT.MSG_OBSTACLE_DESTROYED);
      setTimeout(() => {
        nextTurn();
      }, 500);
      return;
    }

    // Miss or boundary
    setPhase('miss');
    showNotification(UI_TEXT.MSG_TURN_ENDED);
    setTimeout(() => {
      nextTurn();
    }, 400);
  }, [addTerrainExplosion, clearProjectile, damageObstacle, killSoldier, nextTurn, players, setPhase, showNotification, roomId]);

  // Handle new game
  const handleNewGame = useCallback(() => {
    resetGame();
    setIsInitialized(false);
    setTrajectoryPreview([]);
    setCurrentFunction('');
  }, [resetGame]);

  // Get current player info
  const currentPlayer = players.find(p => p.id === turn.currentPlayerId);
  const myPlayer = players.find(p => p.id === myPlayerId);
  const opponent = players.find(p => p.id !== myPlayerId);
  const canShoot = roomId === 'LOCAL' ? true : isMyTurn;

  // Get mode label for display
  const getModeLabel = () => {
    switch (gameMode) {
      case 'first_order_ode': return UI_TEXT.MODE_ODE1;
      case 'second_order_ode': return UI_TEXT.MODE_ODE2;
      default: return UI_TEXT.MODE_NORMAL;
    }
  };

  return (
    <div className="game-container min-h-screen p-4 md:p-8">
      {/* Header */}
      <header className="text-center mb-6">
        <h1 className="text-4xl font-bold text-white mb-2">
          🎯 Graphwar
        </h1>
        <p className="text-gray-400">
          Trò chơi pháo hàm số - Sử dụng toán học để chiến thắng!
        </p>
        <p className="text-sm text-indigo-400 mt-1">
          Chế độ: {getModeLabel()}
        </p>
      </header>

      {/* Notification Toast */}
      {notification && (
        <div className="fixed top-4 left-1/2 transform -translate-x-1/2 z-50">
          <div className="bg-indigo-600 text-white px-6 py-3 rounded-lg shadow-lg animate-pulse">
            {notification}
          </div>
        </div>
      )}

      {/* Game Over Modal */}
      {winner && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="bg-gray-900 p-8 rounded-2xl text-center border border-gray-700">
            <h2 className="text-3xl font-bold text-yellow-400 mb-4">
              🏆 {UI_TEXT.PHASE_GAMEOVER}
            </h2>
            <p className="text-xl text-white mb-6">
              {players.find(p => p.id === winner)?.name} {UI_TEXT.MSG_YOU_WIN}
            </p>
            <button
              onClick={handleNewGame}
              className="px-8 py-3 bg-gradient-to-r from-green-500 to-emerald-600 text-white font-bold rounded-lg hover:from-green-600 hover:to-emerald-700 transition-all"
            >
              {UI_TEXT.BTN_NEW_GAME}
            </button>
          </div>
        </div>
      )}

      {/* Main Game Layout */}
      <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Game Info Panel (Left) */}
        <div className="lg:col-span-1 space-y-6">
          <GameInfo
            players={players}
            currentPlayerId={turn.currentPlayerId}
            myPlayerId={myPlayerId}
            turnNumber={turn.turnNumber}
            roomId={roomId || "LOCAL"}
            timeLeft={turn.timeLeft}
          />
          
          <Chat />
        </div>

        {/* Canvas (Center) */}
        <div className="lg:col-span-2">
          <div className="canvas-container bg-gray-900 p-2 rounded-xl">
            <GameCanvas
              gridConfig={gridConfig}
              players={players}
              obstacles={obstacles}
              terrain={terrain}
              projectile={projectile}
              trajectoryPath={trajectoryPreview}
              currentSoldierIndex={turn.currentSoldierIndex || 0}
              onAnimationComplete={handleAnimationComplete}
              className="w-full"
            />
          </div>

          {/* Function Display */}
          {(currentFunction || turn.lastFunction) && (
            <div className="mt-4 text-center">
              <span className="text-gray-400">
                {phase === 'animating' || phase === 'firing' ? 'Đang bắn: ' : 'Hàm số: '}
              </span>
              <span className="font-mono text-yellow-400 text-lg">
                {gameMode === 'normal' ? 'y = ' : gameMode === 'first_order_ode' ? "y' = " : "y'' = "}
                {phase === 'animating' || phase === 'firing' ? turn.lastFunction : currentFunction}
              </span>
            </div>
          )}
        </div>

        {/* Control Panel (Right) */}
        <div className="lg:col-span-1">
          <ControlPanel
            isMyTurn={canShoot}
            isGameActive={phase === 'input'}
            currentPhase={phase}
            gameMode={gameMode}
            currentAngle={currentSoldier?.angle || 0}
            onFire={handleFire}
            onPreview={handlePreviewFunction}
            onGameModeChange={handleGameModeChange}
            onAngleChange={handleAngleChange}
            playerName={currentPlayer?.name}
            opponentName={players.find(p => p.id !== turn.currentPlayerId)?.name}
            disabled={phase === 'animating' || phase === 'firing'}
          />

          {/* Help Section */}
          <div className="mt-4 p-4 bg-gray-800/50 rounded-lg text-sm text-gray-400">
            <h3 className="font-bold text-white mb-2">💡 Hướng dẫn</h3>
            <ul className="space-y-1 list-disc list-inside">
              {gameMode === 'normal' && (
                <>
                  <li>Nhập hàm số như <code className="text-yellow-400">sin(x)</code></li>
                  <li>Đường đạn bay theo đồ thị y = f(x)</li>
                </>
              )}
              {gameMode === 'first_order_ode' && (
                <>
                  <li>Nhập y' = f(x,y) như <code className="text-yellow-400">-y/3</code></li>
                  <li>Đường đạn bay theo nghiệm ODE bậc 1</li>
                </>
              )}
              {gameMode === 'second_order_ode' && (
                <>
                  <li>Nhập y'' = f(x,y,y') như <code className="text-yellow-400">-y</code></li>
                  <li>Điều chỉnh góc bắn ban đầu</li>
                </>
              )}
              <li>Bắn trúng lính đối phương để tiêu diệt</li>
              <li>Tiêu diệt hết lính đối phương thắng!</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="text-center mt-8 text-gray-500 text-sm">
        <p>Dự án cuối kỳ - Môn Phát triển Ứng dụng Web - 2025</p>
      </footer>
    </div>
  );
}
