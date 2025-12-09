'use client';

/**
 * Main Game Page
 * Integrates all game components
 */

import React, { useState, useEffect, useCallback } from 'react';
import { GameCanvas, ControlPanel, GameInfo } from '@/components/game';
import { useGameStore, useIsMyTurn, useGamePhase } from '@/stores';
import { parseMathFunction, generateTrajectory } from '@/lib/math';
import { UI_TEXT, GAME_CONSTANTS, DEFAULT_GRID_CONFIG, Point } from '@/types';

// For demo purposes, create a single-player local game
// In production, this would connect via Socket.io
function initializeDemoGame() {
  const store = useGameStore.getState();
  
  // Create two demo players
  store.addPlayer({
    id: 'player-1',
    name: 'Người chơi 1',
    team: 'red',
    position: { x: -15, y: 0 },
    health: GAME_CONSTANTS.MAX_HEALTH,
    maxHealth: GAME_CONSTANTS.MAX_HEALTH,
    isAlive: true,
  });

  store.addPlayer({
    id: 'player-2',
    name: 'Người chơi 2',
    team: 'blue',
    position: { x: 15, y: 0 },
    health: GAME_CONSTANTS.MAX_HEALTH,
    maxHealth: GAME_CONSTANTS.MAX_HEALTH,
    isAlive: true,
  });

  // Add some obstacles
  store.addObstacle({
    id: 'obstacle-1',
    position: { x: -2, y: 5 },
    width: 2,
    height: 3,
    health: 100,
    isDestroyed: false,
  });

  store.addObstacle({
    id: 'obstacle-2',
    position: { x: 0, y: -3 },
    width: 3,
    height: 2,
    health: 100,
    isDestroyed: false,
  });

  // Set my player ID for local play
  store.setMyPlayerId('player-1');
  store.setRoomId('LOCAL');

  // Start the game
  store.setCurrentPlayer('player-1');
  store.setPhase('input');
}

export default function GamePage() {
  const [trajectoryPreview, setTrajectoryPreview] = useState<Point[]>([]);
  const [currentFunction, setCurrentFunction] = useState<string>('');
  const [notification, setNotification] = useState<string | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);

  // Store selectors
  const players = useGameStore((state) => state.players);
  const obstacles = useGameStore((state) => state.obstacles);
  const projectile = useGameStore((state) => state.projectile);
  const turn = useGameStore((state) => state.turn);
  const gridConfig = useGameStore((state) => state.gridConfig);
  const myPlayerId = useGameStore((state) => state.myPlayerId);
  const winner = useGameStore((state) => state.winner);
  const isMyTurn = useIsMyTurn();
  const phase = useGamePhase();

  // Store actions
  const fireProjectile = useGameStore((state) => state.fireProjectile);
  const nextTurn = useGameStore((state) => state.nextTurn);
  const damagePlayer = useGameStore((state) => state.damagePlayer);
  const setPhase = useGameStore((state) => state.setPhase);
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

    const direction = currentPlayer.team === 'red' ? 'right' : 'left';
    const result = generateTrajectory(functionString, currentPlayer.position, direction, gridConfig);
    
    if (result.success) {
      setTrajectoryPreview(result.points);
    } else {
      setTrajectoryPreview([]);
    }
  }, [players, turn.currentPlayerId, gridConfig]);

  // Handle fire action
  const handleFire = useCallback((functionString: string) => {
    const success = fireProjectile(functionString);
    
    if (success) {
      setCurrentFunction(functionString);
      setTrajectoryPreview([]);
      showNotification(`Bắn với hàm: ${functionString}`);
    } else {
      showNotification('Lỗi: Không thể bắn với hàm số này');
    }
  }, [fireProjectile, showNotification]);

  // Handle animation complete
  const handleAnimationComplete = useCallback(() => {
    // Check what the projectile hit
    const currentProjectile = useGameStore.getState().projectile;
    if (!currentProjectile) return;

    const path = currentProjectile.path;
    if (!path || path.length === 0) {
      nextTurn();
      return;
    }

    // Check for player hit along the entire path
    for (const player of players) {
      if (!player.isAlive || player.id === currentProjectile.owner) continue;

      // Check all points in the path for collision
      for (const point of path) {
        const distance = Math.sqrt(
          Math.pow(point.x - player.position.x, 2) +
          Math.pow(point.y - player.position.y, 2)
        );

        // Hit detection radius (more generous for better gameplay)
        if (distance < 1.5) {
          damagePlayer(player.id, GAME_CONSTANTS.HIT_DAMAGE);
          showNotification(`${player.name} ${UI_TEXT.MSG_PLAYER_HIT}`);
          setPhase('hit');
          
          // Check for game over after damage
          setTimeout(() => {
            const updatedPlayers = useGameStore.getState().players;
            const alivePlayers = updatedPlayers.filter(p => p.isAlive);
            if (alivePlayers.length === 1) {
              // Game over handled by store
              showNotification(`${alivePlayers[0].name} ${UI_TEXT.MSG_YOU_WIN}`);
            } else {
              nextTurn();
            }
          }, 1500);
          return;
        }
      }
    }

    // No hit - miss
    setPhase('miss');
    showNotification(UI_TEXT.MSG_TURN_ENDED);
    setTimeout(() => {
      nextTurn();
    }, 1000);
  }, [players, damagePlayer, nextTurn, setPhase, showNotification]);

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
        <div className="lg:col-span-1">
          <GameInfo
            players={players}
            currentPlayerId={turn.currentPlayerId}
            myPlayerId={myPlayerId}
            turnNumber={turn.turnNumber}
            roomId="LOCAL"
          />
        </div>

        {/* Canvas (Center) */}
        <div className="lg:col-span-2">
          <div className="canvas-container bg-gray-900 p-2 rounded-xl">
            <GameCanvas
              gridConfig={gridConfig}
              players={players}
              obstacles={obstacles}
              projectile={projectile}
              trajectoryPath={trajectoryPreview}
              onAnimationComplete={handleAnimationComplete}
              className="w-full"
            />
          </div>

          {/* Function Preview */}
          {currentFunction && (
            <div className="mt-4 text-center">
              <span className="text-gray-400">Hàm số: </span>
              <span className="font-mono text-yellow-400 text-lg">
                y = {currentFunction}
              </span>
            </div>
          )}
        </div>

        {/* Control Panel (Right) */}
        <div className="lg:col-span-1">
          <ControlPanel
            isMyTurn={true}
            isGameActive={phase !== 'gameover' && phase !== 'waiting'}
            currentPhase={phase}
            onFire={handleFire}
            playerName={currentPlayer?.name}
            opponentName={players.find(p => p.id !== turn.currentPlayerId)?.name}
            disabled={phase === 'animating' || phase === 'firing'}
          />

          {/* Help Section */}
          <div className="mt-4 p-4 bg-gray-800/50 rounded-lg text-sm text-gray-400">
            <h3 className="font-bold text-white mb-2">💡 Hướng dẫn</h3>
            <ul className="space-y-1 list-disc list-inside">
              <li>Nhập hàm số như <code className="text-yellow-400">sin(x)</code></li>
              <li>Đường đạn sẽ bay theo đồ thị hàm số</li>
              <li>Bắn trúng đối thủ để gây sát thương</li>
              <li>Người còn lại cuối cùng thắng!</li>
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
