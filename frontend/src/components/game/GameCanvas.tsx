'use client';

/**
 * GameCanvas Component
 * Renders the game grid, players, obstacles, and projectile animation
 * Uses HTML5 Canvas API for high-performance rendering
 */

import React, { useRef, useEffect, useCallback } from 'react';
import {
  Point,
  Player,
  Obstacle,
  Projectile,
  GridConfig,
  DEFAULT_GRID_CONFIG,
  GAME_CONSTANTS,
} from '@/types';
import { gridToCanvas } from '@/lib/math';

interface GameCanvasProps {
  gridConfig?: GridConfig;
  players: Player[];
  obstacles: Obstacle[];
  projectile: Projectile | null;
  trajectoryPath?: Point[];
  onAnimationComplete?: (result: {
    type: 'player' | 'obstacle' | 'boundary' | 'miss';
    targetId?: string;
  }) => void;
  className?: string;
}

// Color palette
const COLORS = {
  background: '#0a0a0f',
  gridLine: '#1a1a2e',
  gridLineMajor: '#2a2a4e',
  axisLine: '#4a4a6e',
  playerRed: '#ef4444',
  playerRedGlow: 'rgba(239, 68, 68, 0.3)',
  playerBlue: '#3b82f6',
  playerBlueGlow: 'rgba(59, 130, 246, 0.3)',
  projectile: '#fbbf24',
  projectileGlow: 'rgba(251, 191, 36, 0.5)',
  trajectory: 'rgba(251, 191, 36, 0.6)',
  trajectoryPreview: 'rgba(251, 191, 36, 0.3)',
  obstacle: '#6b7280',
  obstacleStroke: '#9ca3af',
  healthBarBg: '#1f2937',
  healthBarFill: '#10b981',
  text: '#e5e7eb',
};

export function GameCanvas({
  gridConfig = DEFAULT_GRID_CONFIG,
  players,
  obstacles,
  projectile,
  trajectoryPath,
  onAnimationComplete,
  className = '',
}: GameCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationFrameRef = useRef<number>(0);
  const projectileIndexRef = useRef<number>(0);

  /**
   * Draw the coordinate grid
   */
  const drawGrid = useCallback((ctx: CanvasRenderingContext2D) => {
    const { width, height, xMin, xMax, yMin, yMax, gridSpacing } = gridConfig;

    // Background
    ctx.fillStyle = COLORS.background;
    ctx.fillRect(0, 0, width, height);

    // Grid lines
    ctx.strokeStyle = COLORS.gridLine;
    ctx.lineWidth = 0.5;

    // Vertical lines
    for (let x = Math.ceil(xMin); x <= xMax; x += gridSpacing) {
      const canvasX = gridToCanvas({ x, y: 0 }, gridConfig).x;
      
      ctx.beginPath();
      ctx.strokeStyle = x === 0 ? COLORS.axisLine : (x % 5 === 0 ? COLORS.gridLineMajor : COLORS.gridLine);
      ctx.lineWidth = x === 0 ? 2 : (x % 5 === 0 ? 1 : 0.5);
      ctx.moveTo(canvasX, 0);
      ctx.lineTo(canvasX, height);
      ctx.stroke();
    }

    // Horizontal lines
    for (let y = Math.ceil(yMin); y <= yMax; y += gridSpacing) {
      const canvasY = gridToCanvas({ x: 0, y }, gridConfig).y;
      
      ctx.beginPath();
      ctx.strokeStyle = y === 0 ? COLORS.axisLine : (y % 5 === 0 ? COLORS.gridLineMajor : COLORS.gridLine);
      ctx.lineWidth = y === 0 ? 2 : (y % 5 === 0 ? 1 : 0.5);
      ctx.moveTo(0, canvasY);
      ctx.lineTo(width, canvasY);
      ctx.stroke();
    }

    // Draw axis labels
    ctx.fillStyle = COLORS.text;
    ctx.font = '10px monospace';
    ctx.textAlign = 'center';

    // X-axis labels
    for (let x = Math.ceil(xMin); x <= xMax; x += 5) {
      if (x === 0) continue;
      const pos = gridToCanvas({ x, y: 0 }, gridConfig);
      ctx.fillText(x.toString(), pos.x, Math.min(pos.y + 15, height - 5));
    }

    // Y-axis labels
    ctx.textAlign = 'right';
    for (let y = Math.ceil(yMin); y <= yMax; y += 5) {
      if (y === 0) continue;
      const pos = gridToCanvas({ x: 0, y }, gridConfig);
      ctx.fillText(y.toString(), Math.max(pos.x - 5, 25), pos.y + 3);
    }
  }, [gridConfig]);

  /**
   * Draw a player with glow effect
   */
  const drawPlayer = useCallback((ctx: CanvasRenderingContext2D, player: Player) => {
    if (!player.isAlive) return;

    const canvasPos = gridToCanvas(player.position, gridConfig);
    const radius = GAME_CONSTANTS.PLAYER_RADIUS;
    const color = player.team === 'red' ? COLORS.playerRed : COLORS.playerBlue;
    const glowColor = player.team === 'red' ? COLORS.playerRedGlow : COLORS.playerBlueGlow;

    // Glow effect
    ctx.beginPath();
    const gradient = ctx.createRadialGradient(
      canvasPos.x, canvasPos.y, radius * 0.5,
      canvasPos.x, canvasPos.y, radius * 2
    );
    gradient.addColorStop(0, glowColor);
    gradient.addColorStop(1, 'transparent');
    ctx.fillStyle = gradient;
    ctx.arc(canvasPos.x, canvasPos.y, radius * 2, 0, Math.PI * 2);
    ctx.fill();

    // Player circle
    ctx.beginPath();
    ctx.arc(canvasPos.x, canvasPos.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = 'white';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Health bar
    const healthBarWidth = 40;
    const healthBarHeight = 6;
    const healthPercent = player.health / player.maxHealth;
    const healthBarX = canvasPos.x - healthBarWidth / 2;
    const healthBarY = canvasPos.y - radius - 15;

    // Background
    ctx.fillStyle = COLORS.healthBarBg;
    ctx.fillRect(healthBarX, healthBarY, healthBarWidth, healthBarHeight);

    // Fill
    ctx.fillStyle = healthPercent > 0.3 ? COLORS.healthBarFill : COLORS.playerRed;
    ctx.fillRect(healthBarX, healthBarY, healthBarWidth * healthPercent, healthBarHeight);

    // Border
    ctx.strokeStyle = COLORS.text;
    ctx.lineWidth = 1;
    ctx.strokeRect(healthBarX, healthBarY, healthBarWidth, healthBarHeight);

    // Player name
    ctx.fillStyle = COLORS.text;
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(player.name, canvasPos.x, canvasPos.y + radius + 20);
  }, [gridConfig]);

  /**
   * Draw obstacles
   */
  const drawObstacles = useCallback((ctx: CanvasRenderingContext2D) => {
    obstacles.forEach(obstacle => {
      if (obstacle.isDestroyed) return;

      const topLeft = gridToCanvas(obstacle.position, gridConfig);
      const bottomRight = gridToCanvas(
        { x: obstacle.position.x + obstacle.width, y: obstacle.position.y - obstacle.height },
        gridConfig
      );

      const canvasWidth = Math.abs(bottomRight.x - topLeft.x);
      const canvasHeight = Math.abs(bottomRight.y - topLeft.y);

      // Health-based tint
      const healthRatio = Math.max(0, obstacle.health) / 120;
      const shade = Math.floor(100 + 80 * healthRatio);
      ctx.fillStyle = `rgb(${shade}, ${shade + 20}, ${shade + 30})`;

      // Obstacle body with subtle gradient
      const grad = ctx.createLinearGradient(topLeft.x, topLeft.y, bottomRight.x, bottomRight.y);
      grad.addColorStop(0, ctx.fillStyle);
      grad.addColorStop(1, COLORS.obstacle);
      ctx.fillStyle = grad;
      ctx.fillRect(topLeft.x, topLeft.y, canvasWidth, canvasHeight);

      // Border
      ctx.strokeStyle = COLORS.obstacleStroke;
      ctx.lineWidth = 2;
      ctx.strokeRect(topLeft.x, topLeft.y, canvasWidth, canvasHeight);
    });
  }, [obstacles, gridConfig]);

  /**
   * Draw trajectory path (preview or actual)
   */
  const drawTrajectory = useCallback((
    ctx: CanvasRenderingContext2D,
    path: Point[],
    isPreview: boolean = false
  ) => {
    if (path.length < 2) return;

    ctx.beginPath();
    ctx.strokeStyle = isPreview ? COLORS.trajectoryPreview : COLORS.trajectory;
    ctx.lineWidth = isPreview ? 1 : 2;
    ctx.setLineDash(isPreview ? [5, 5] : []);

    const startPoint = gridToCanvas(path[0], gridConfig);
    ctx.moveTo(startPoint.x, startPoint.y);

    for (let i = 1; i < path.length; i++) {
      const point = gridToCanvas(path[i], gridConfig);
      ctx.lineTo(point.x, point.y);
    }

    ctx.stroke();
    ctx.setLineDash([]);
  }, [gridConfig]);

  /**
   * Draw projectile with trail effect
   */
  const drawProjectile = useCallback((
    ctx: CanvasRenderingContext2D,
    position: Point,
    path: Point[],
    currentIndex: number
  ) => {
    const canvasPos = gridToCanvas(position, gridConfig);
    const radius = GAME_CONSTANTS.PROJECTILE_RADIUS;

    // Trail effect (draw last N points)
    const trailLength = 20;
    const trailStart = Math.max(0, currentIndex - trailLength);
    
    for (let i = trailStart; i < currentIndex; i++) {
      const trailPoint = gridToCanvas(path[i], gridConfig);
      const alpha = (i - trailStart) / trailLength * 0.5;
      
      ctx.beginPath();
      ctx.arc(trailPoint.x, trailPoint.y, radius * 0.5, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(251, 191, 36, ${alpha})`;
      ctx.fill();
    }

    // Glow effect
    ctx.beginPath();
    const gradient = ctx.createRadialGradient(
      canvasPos.x, canvasPos.y, radius * 0.5,
      canvasPos.x, canvasPos.y, radius * 3
    );
    gradient.addColorStop(0, COLORS.projectileGlow);
    gradient.addColorStop(1, 'transparent');
    ctx.fillStyle = gradient;
    ctx.arc(canvasPos.x, canvasPos.y, radius * 3, 0, Math.PI * 2);
    ctx.fill();

    // Projectile body
    ctx.beginPath();
    ctx.arc(canvasPos.x, canvasPos.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = COLORS.projectile;
    ctx.fill();
    ctx.strokeStyle = 'white';
    ctx.lineWidth = 1;
    ctx.stroke();
  }, [gridConfig]);

  /**
   * Check collision between projectile and entities
   */
  const checkCollision = useCallback((
    projectilePos: Point,
    players: Player[],
    obstacles: Obstacle[],
    ownerId: string
  ): { type: 'player' | 'obstacle' | 'boundary' | 'none'; target?: Player | Obstacle } => {
    const { xMin, xMax, yMin, yMax } = gridConfig;
    const projectileRadius = GAME_CONSTANTS.PROJECTILE_RADIUS;
    const playerRadius = GAME_CONSTANTS.PLAYER_RADIUS;

    // Convert to grid units for collision (approximate)
    const gridProjectileRadius = (projectileRadius / gridConfig.width) * (xMax - xMin);
    const gridPlayerRadius = (playerRadius / gridConfig.width) * (xMax - xMin);

    // Check boundary collision
    if (
      projectilePos.x < xMin ||
      projectilePos.x > xMax ||
      projectilePos.y < yMin ||
      projectilePos.y > yMax
    ) {
      return { type: 'boundary' };
    }

    // Check player collision
    for (const player of players) {
      // Skip dead players and the player who fired the projectile (owner)
      if (!player.isAlive || player.id === ownerId) continue;
      
      const distance = Math.sqrt(
        Math.pow(projectilePos.x - player.position.x, 2) +
        Math.pow(projectilePos.y - player.position.y, 2)
      );

      if (distance < gridProjectileRadius + gridPlayerRadius) {
        return { type: 'player', target: player };
      }
    }

    // Check obstacle collision
    for (const obstacle of obstacles) {
      if (obstacle.isDestroyed) continue;

      const { x, y } = obstacle.position;
      const { width, height } = obstacle;

      if (
        projectilePos.x >= x &&
        projectilePos.x <= x + width &&
        projectilePos.y <= y &&
        projectilePos.y >= y - height
      ) {
        return { type: 'obstacle', target: obstacle };
      }
    }

    return { type: 'none' };
  }, [gridConfig]);

  /**
   * Main render function
   */
  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear and draw background
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw grid
    drawGrid(ctx);

    // Draw obstacles
    drawObstacles(ctx);

    // Draw trajectory preview
    if (trajectoryPath && trajectoryPath.length > 0) {
      drawTrajectory(ctx, trajectoryPath, true);
    }

    // Draw players
    players.forEach(player => drawPlayer(ctx, player));

    // Draw projectile if active
    if (projectile?.isActive && projectile.path.length > 0) {
      const currentPos = projectile.path[projectileIndexRef.current];
      if (currentPos) {
        // Draw the path up to current point
        const pathToNow = projectile.path.slice(0, projectileIndexRef.current + 1);
        drawTrajectory(ctx, pathToNow, false);

        // Draw projectile
        drawProjectile(ctx, currentPos, projectile.path, projectileIndexRef.current);
      }
    }
  }, [
    drawGrid,
    drawObstacles,
    drawPlayer,
    drawProjectile,
    drawTrajectory,
    players,
    projectile,
    trajectoryPath,
  ]);

  /**
   * Animation loop for projectile
   */
  const animate = useCallback(() => {
    if (!projectile?.isActive) {
      render();
      return;
    }

    const path = projectile.path;
    const currentIndex = projectileIndexRef.current;

    // Check if animation is complete without collision
    if (currentIndex >= path.length) {
      onAnimationComplete?.({ type: 'miss' });
      projectileIndexRef.current = 0;
      render();
      return;
    }

    // Check for collision at current position (pass owner to exclude from collision)
    const currentPos = path[currentIndex];
    const collision = checkCollision(currentPos, players, obstacles, projectile.owner);

    if (collision.type !== 'none') {
      const payload =
        collision.type === 'player'
          ? { type: 'player' as const, targetId: (collision.target as Player)?.id }
          : collision.type === 'obstacle'
            ? { type: 'obstacle' as const, targetId: (collision.target as Obstacle)?.id }
            : { type: 'boundary' as const };

      // Collision detected - stop animation and report
      onAnimationComplete?.(payload);
      projectileIndexRef.current = 0;
      render();
      return;
    }

    // Advance projectile
    projectileIndexRef.current += GAME_CONSTANTS.PROJECTILE_SPEED;

    // Render frame
    render();

    // Continue animation
    animationFrameRef.current = requestAnimationFrame(animate);
  }, [projectile, players, obstacles, render, checkCollision, onAnimationComplete]);

  // Start/stop animation when projectile changes
  useEffect(() => {
    if (projectile?.isActive) {
      projectileIndexRef.current = 0;
      animationFrameRef.current = requestAnimationFrame(animate);
    } else {
      cancelAnimationFrame(animationFrameRef.current);
      render();
    }

    return () => {
      cancelAnimationFrame(animationFrameRef.current);
    };
  }, [projectile, animate, render]);

  // Initial render
  useEffect(() => {
    render();
  }, [render]);

  // Handle canvas resize
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleResize = () => {
      // Maintain aspect ratio
      const container = canvas.parentElement;
      if (container) {
        const aspectRatio = gridConfig.width / gridConfig.height;
        const containerWidth = container.clientWidth;
        const newHeight = containerWidth / aspectRatio;
        
        canvas.style.width = `${containerWidth}px`;
        canvas.style.height = `${newHeight}px`;
      }
      render();
    };

    window.addEventListener('resize', handleResize);
    handleResize();

    return () => window.removeEventListener('resize', handleResize);
  }, [gridConfig, render]);

  return (
    <canvas
      ref={canvasRef}
      width={gridConfig.width}
      height={gridConfig.height}
      className={`border-2 border-game-grid rounded-lg ${className}`}
      style={{ imageRendering: 'pixelated' }}
    />
  );
}

export default GameCanvas;
