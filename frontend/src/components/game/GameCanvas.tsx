'use client';

/**
 * GameCanvas Component
 * Renders the game grid, soldiers, terrain obstacles, and projectile animation
 * Uses HTML5 Canvas API for high-performance rendering
 * Updated to match original Graphwar visuals with circular terrain obstacles
 */

import React, { useRef, useEffect, useCallback } from 'react';
import {
  Point,
  Player,
  Soldier,
  Obstacle,
  Projectile,
  Explosion,
  GridConfig,
  Terrain,
  CircleObstacle,
  DEFAULT_GRID_CONFIG,
  GAME_CONSTANTS,
} from '@/types';
import { gridToCanvas } from '@/lib/math';

interface GameCanvasProps {
  gridConfig?: GridConfig;
  players: Player[];
  obstacles: Obstacle[];
  terrain: Terrain | null;
  projectile: Projectile | null;
  trajectoryPath?: Point[];
  currentSoldierIndex?: number;
  onAnimationComplete?: (result: {
    type: 'soldier' | 'obstacle' | 'terrain' | 'boundary' | 'miss';
    targetPlayerId?: string;
    targetSoldierIndex?: number;
    targetObstacleId?: string;
    impactPoint?: Point;
  }) => void;
  className?: string;
}

// Color palette (matching original Graphwar style with modern updates)
const COLORS = {
  // Background
  backgroundTop: '#1a1a2e',
  backgroundBottom: '#16213e',
  vignette: 'rgba(0,0,0,0.25)',
  
  // Grid
  gridLine: 'rgba(255,255,255,0.04)',
  gridLineMajor: 'rgba(255,255,255,0.10)',
  axisLine: '#5eead4',
  
  // Teams (matching original Graphwar: red/pink for team 1, blue/cyan for team 2)
  teamRed: '#ff6b6b',
  teamRedGlow: 'rgba(255, 107, 107, 0.35)',
  teamBlue: '#4ecdc4',
  teamBlueGlow: 'rgba(78, 205, 196, 0.35)',
  
  // Soldiers
  soldierOutline: '#ffffff',
  soldierDead: '#666666',
  
  // Projectile
  projectile: '#fbbf24',
  projectileGlow: 'rgba(251, 191, 36, 0.55)',
  trajectory: 'rgba(251, 191, 36, 0.8)',
  trajectoryPreview: 'rgba(251, 191, 36, 0.25)',
  
  // Terrain obstacles (original uses brown/earth tones)
  terrainFill: '#8b7355',
  terrainStroke: '#a08060',
  terrainGradient1: '#6b5344',
  terrainGradient2: '#9a8365',
  
  // Legacy obstacles
  obstacle: '#8b9bb5',
  obstacleStroke: '#cbd5e1',
  
  // UI elements
  healthBarBg: '#0f172a',
  healthBarFill: '#34d399',
  text: '#e5e7eb',
  explosion: '#ff9f43',
};

export function GameCanvas({
  gridConfig = DEFAULT_GRID_CONFIG,
  players,
  obstacles,
  terrain,
  projectile,
  trajectoryPath,
  currentSoldierIndex = 0,
  onAnimationComplete,
  className = '',
}: GameCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationFrameRef = useRef<number>(0);
  const projectileIndexRef = useRef<number>(0);
  const [explosions, setExplosions] = React.useState<Explosion[]>([]);

  /**
   * Trigger an explosion effect
   */
  const triggerExplosion = useCallback((position: Point, color: string = COLORS.explosion) => {
    const id = Math.random().toString(36).substring(7);
    const newExplosion: Explosion = {
      id,
      position,
      radius: 5,
      maxRadius: 50,
      opacity: 1,
      color,
    };
    setExplosions(prev => [...prev, newExplosion]);
  }, []);

  /**
   * Draw the coordinate grid
   */
  const drawGrid = useCallback((ctx: CanvasRenderingContext2D) => {
    const { width, height, xMin, xMax, yMin, yMax, gridSpacing } = gridConfig;

    // Background gradient
    const bg = ctx.createLinearGradient(0, 0, 0, height);
    bg.addColorStop(0, COLORS.backgroundTop);
    bg.addColorStop(1, COLORS.backgroundBottom);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);

    // Vignette
    const vignette = ctx.createRadialGradient(width / 2, height / 2, Math.min(width, height) * 0.2, width / 2, height / 2, Math.max(width, height) * 0.7);
    vignette.addColorStop(0, 'rgba(0,0,0,0)');
    vignette.addColorStop(1, COLORS.vignette);
    ctx.fillStyle = vignette;
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
   * Draw circular terrain obstacles (matching original Graphwar)
   */
  const drawTerrain = useCallback((ctx: CanvasRenderingContext2D) => {
    if (!terrain) return;
    
    // Draw circular obstacles
    terrain.circles.forEach((circle: CircleObstacle) => {
      const canvasCenter = gridToCanvas({ x: circle.x, y: circle.y }, gridConfig);
      
      // Convert radius from grid units to canvas pixels
      const { xMin, xMax, width } = gridConfig;
      const canvasRadius = (circle.radius / (xMax - xMin)) * width;
      
      // Create gradient for 3D effect (like original Graphwar)
      const gradient = ctx.createRadialGradient(
        canvasCenter.x - canvasRadius * 0.3,
        canvasCenter.y - canvasRadius * 0.3,
        0,
        canvasCenter.x,
        canvasCenter.y,
        canvasRadius
      );
      gradient.addColorStop(0, COLORS.terrainGradient2);
      gradient.addColorStop(0.7, COLORS.terrainFill);
      gradient.addColorStop(1, COLORS.terrainGradient1);
      
      ctx.beginPath();
      ctx.arc(canvasCenter.x, canvasCenter.y, canvasRadius, 0, Math.PI * 2);
      ctx.fillStyle = gradient;
      ctx.fill();
      ctx.strokeStyle = COLORS.terrainStroke;
      ctx.lineWidth = 2;
      ctx.stroke();
    });

    // Carve holes for explosions (destructible terrain feel)
    if (terrain.explosions.length > 0) {
      const previousComposite = ctx.globalCompositeOperation;
      ctx.globalCompositeOperation = 'destination-out';
      terrain.explosions.forEach((explosion) => {
        const canvasCenter = gridToCanvas({ x: explosion.x, y: explosion.y }, gridConfig);
        const { xMin, xMax, width } = gridConfig;
        const canvasRadius = (explosion.radius / (xMax - xMin)) * width;
        ctx.beginPath();
        ctx.arc(canvasCenter.x, canvasCenter.y, canvasRadius, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(0,0,0,1)';
        ctx.fill();
      });
      ctx.globalCompositeOperation = previousComposite;

      // Optional crater rim shading (subtle)
      terrain.explosions.forEach((explosion) => {
        const canvasCenter = gridToCanvas({ x: explosion.x, y: explosion.y }, gridConfig);
        const { xMin, xMax, width } = gridConfig;
        const canvasRadius = (explosion.radius / (xMax - xMin)) * width;
        const gradient = ctx.createRadialGradient(
          canvasCenter.x,
          canvasCenter.y,
          canvasRadius * 0.6,
          canvasCenter.x,
          canvasCenter.y,
          canvasRadius * 1.15
        );
        gradient.addColorStop(0, 'rgba(0,0,0,0)');
        gradient.addColorStop(1, 'rgba(0,0,0,0.35)');
        ctx.beginPath();
        ctx.arc(canvasCenter.x, canvasCenter.y, canvasRadius * 1.15, 0, Math.PI * 2);
        ctx.fillStyle = gradient;
        ctx.fill();
      });
    }
  }, [terrain, gridConfig]);

  /**
   * Draw a soldier (small circle representing a unit)
   */
  const drawSoldier = useCallback((
    ctx: CanvasRenderingContext2D, 
    soldier: Soldier, 
    team: 'red' | 'blue',
    isCurrentSoldier: boolean,
    playerColor?: string
  ) => {
    const canvasPos = gridToCanvas(soldier.position, gridConfig);
    
    // Convert soldier radius from grid units to canvas pixels
    const { xMin, xMax, width } = gridConfig;
    const canvasRadius = (GAME_CONSTANTS.SOLDIER_RADIUS / (xMax - xMin)) * width;
    
    // Determine colors
    const teamColor = playerColor || (team === 'red' ? COLORS.teamRed : COLORS.teamBlue);
    const glowColor = team === 'red' ? COLORS.teamRedGlow : COLORS.teamBlueGlow;
    
    if (!soldier.isAlive) {
      // Dead soldier - draw as gray X
      ctx.strokeStyle = COLORS.soldierDead;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(canvasPos.x - canvasRadius, canvasPos.y - canvasRadius);
      ctx.lineTo(canvasPos.x + canvasRadius, canvasPos.y + canvasRadius);
      ctx.moveTo(canvasPos.x + canvasRadius, canvasPos.y - canvasRadius);
      ctx.lineTo(canvasPos.x - canvasRadius, canvasPos.y + canvasRadius);
      ctx.stroke();
      return;
    }
    
    // Draw glow effect for current soldier
    if (isCurrentSoldier) {
      ctx.beginPath();
      const gradient = ctx.createRadialGradient(
        canvasPos.x, canvasPos.y, canvasRadius * 0.5,
        canvasPos.x, canvasPos.y, canvasRadius * 3
      );
      gradient.addColorStop(0, glowColor);
      gradient.addColorStop(1, 'transparent');
      ctx.fillStyle = gradient;
      ctx.arc(canvasPos.x, canvasPos.y, canvasRadius * 3, 0, Math.PI * 2);
      ctx.fill();
      
      // Draw selection ring
      ctx.beginPath();
      ctx.arc(canvasPos.x, canvasPos.y, canvasRadius * 1.5, 0, Math.PI * 2);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    
    // Draw soldier body
    ctx.beginPath();
    ctx.arc(canvasPos.x, canvasPos.y, canvasRadius, 0, Math.PI * 2);
    ctx.fillStyle = teamColor;
    ctx.fill();
    ctx.strokeStyle = COLORS.soldierOutline;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Draw aiming barrel for the current soldier (helps readability)
    if (isCurrentSoldier) {
      const barrelLen = canvasRadius * 2.2;
      const endX = canvasPos.x + Math.cos(soldier.angle) * barrelLen;
      const endY = canvasPos.y - Math.sin(soldier.angle) * barrelLen;

      ctx.beginPath();
      ctx.moveTo(canvasPos.x, canvasPos.y);
      ctx.lineTo(endX, endY);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(endX, endY, 3, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
    }
  }, [gridConfig]);

  /**
   * Draw a player (now draws all their soldiers)
   */
  const drawPlayer = useCallback((
    ctx: CanvasRenderingContext2D, 
    player: Player,
    isCurrentPlayer: boolean,
    currentSoldierIdx: number
  ) => {
    if (!player.soldiers || player.soldiers.length === 0) {
      // Fallback: draw player at their position (legacy support)
      if (!player.isAlive) return;

      const canvasPos = gridToCanvas(player.position, gridConfig);
      const radius = GAME_CONSTANTS.PLAYER_RADIUS;
      const color = player.team === 'red' ? COLORS.teamRed : COLORS.teamBlue;
      const glowColor = player.team === 'red' ? COLORS.teamRedGlow : COLORS.teamBlueGlow;

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

      // Player name
      ctx.fillStyle = COLORS.text;
      ctx.font = 'bold 12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(player.name, canvasPos.x, canvasPos.y + radius + 20);
      return;
    }

    // Draw all soldiers for this player
    player.soldiers.forEach((soldier, soldierIndex) => {
      const isCurrentSoldier = isCurrentPlayer && soldierIndex === currentSoldierIdx;
      drawSoldier(ctx, soldier, player.team, isCurrentSoldier, player.color);
    });

    // Draw player name near their first alive soldier
    const aliveSoldier = player.soldiers.find(s => s.isAlive);
    if (aliveSoldier) {
      const canvasPos = gridToCanvas(aliveSoldier.position, gridConfig);
      ctx.fillStyle = COLORS.text;
      ctx.font = 'bold 11px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(player.name, canvasPos.x, canvasPos.y + 25);
    }
  }, [gridConfig, drawSoldier]);

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
   * Draw explosions
   */
  const drawExplosions = useCallback((ctx: CanvasRenderingContext2D) => {
    explosions.forEach(exp => {
      const canvasPos = gridToCanvas(exp.position, gridConfig);
      
      ctx.beginPath();
      const grad = ctx.createRadialGradient(
        canvasPos.x, canvasPos.y, exp.radius * 0.2,
        canvasPos.x, canvasPos.y, exp.radius
      );
      grad.addColorStop(0, exp.color);
      grad.addColorStop(0.6, exp.color + '88');
      grad.addColorStop(1, 'transparent');
      
      ctx.fillStyle = grad;
      ctx.globalAlpha = exp.opacity;
      ctx.arc(canvasPos.x, canvasPos.y, exp.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1.0;
    });
  }, [explosions, gridConfig]);

  /**
   * Check collision between projectile and entities (soldiers, terrain, obstacles)
   */
  const checkCollision = useCallback((
    projectilePos: Point,
    players: Player[],
    obstacles: Obstacle[],
    ownerId: string
  ): { 
    type: 'soldier' | 'obstacle' | 'terrain' | 'boundary' | 'none'; 
    targetPlayerId?: string;
    targetSoldierIndex?: number;
    target?: Player | Obstacle;
  } => {
    const { xMin, xMax, yMin, yMax } = gridConfig;
    
    // Use grid units directly for collision (SOLDIER_RADIUS is already in grid units)
    const soldierRadius = GAME_CONSTANTS.SOLDIER_RADIUS;

    // Check boundary collision
    if (
      projectilePos.x < xMin ||
      projectilePos.x > xMax ||
      projectilePos.y < yMin ||
      projectilePos.y > yMax
    ) {
      return { type: 'boundary' };
    }

    // Check soldier collision (each player has multiple soldiers)
    for (const player of players) {
      // Skip dead players and the player who fired the projectile (owner)
      if (!player.isAlive || player.id === ownerId) continue;
      
      // Check each soldier
      if (player.soldiers && player.soldiers.length > 0) {
        for (let soldierIndex = 0; soldierIndex < player.soldiers.length; soldierIndex++) {
          const soldier = player.soldiers[soldierIndex];
          if (!soldier.isAlive) continue;
          
          const distance = Math.sqrt(
            Math.pow(projectilePos.x - soldier.position.x, 2) +
            Math.pow(projectilePos.y - soldier.position.y, 2)
          );

          if (distance < soldierRadius) {
            return { 
              type: 'soldier', 
              targetPlayerId: player.id,
              targetSoldierIndex: soldierIndex,
              target: player 
            };
          }
        }
      } else {
        // Legacy: check player position directly
        const distance = Math.sqrt(
          Math.pow(projectilePos.x - player.position.x, 2) +
          Math.pow(projectilePos.y - player.position.y, 2)
        );

        if (distance < soldierRadius) {
          return { type: 'soldier', targetPlayerId: player.id, target: player };
        }
      }
    }
    
    // Check terrain collision (circular obstacles)
    if (terrain && terrain.circles) {
      // If we are inside an existing crater, treat as empty space.
      if (terrain.explosions?.some((e) => {
        const d = Math.hypot(projectilePos.x - e.x, projectilePos.y - e.y);
        return d < e.radius;
      })) {
        // Skip terrain collision
      } else {
      for (const circle of terrain.circles) {
        const distance = Math.sqrt(
          Math.pow(projectilePos.x - circle.x, 2) +
          Math.pow(projectilePos.y - circle.y, 2)
        );
        
        if (distance < circle.radius) {
          return { type: 'terrain' };
        }
      }
      }
    }

    // Check legacy obstacle collision (rectangular)
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
  }, [gridConfig, terrain]);

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
    
    // Draw terrain obstacles (circular)
    drawTerrain(ctx);

    // Draw legacy obstacles (rectangular)
    drawObstacles(ctx);

    // Draw trajectory preview
    if (trajectoryPath && trajectoryPath.length > 0) {
      drawTrajectory(ctx, trajectoryPath, true);
    }

    // Find current player for highlighting
    const currentPlayerId = projectile?.owner;
    
    // Draw players (each with their soldiers)
    players.forEach(player => {
      const isCurrentPlayer = player.id === currentPlayerId;
      drawPlayer(ctx, player, isCurrentPlayer, currentSoldierIndex);
    });

    // Draw explosions
    drawExplosions(ctx);

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
    drawTerrain,
    drawObstacles,
    drawPlayer,
    drawProjectile,
    drawTrajectory,
    drawExplosions,
    players,
    projectile,
    trajectoryPath,
    currentSoldierIndex,
  ]);

  /**
   * Animation loop for projectile and effects
   */
  const animate = useCallback(() => {
    // Update explosions
    if (explosions.length > 0) {
      setExplosions(prev => prev
        .map(exp => ({
          ...exp,
          radius: exp.radius + (exp.maxRadius - exp.radius) * 0.1,
          opacity: exp.opacity - 0.03,
        }))
        .filter(exp => exp.opacity > 0)
      );
    }

    if (!projectile?.isActive) {
      if (explosions.length > 0) {
        render();
        animationFrameRef.current = requestAnimationFrame(animate);
      } else {
        render();
      }
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
      // Build appropriate payload based on collision type
      let payload: {
        type: 'soldier' | 'obstacle' | 'terrain' | 'boundary' | 'miss';
        targetPlayerId?: string;
        targetSoldierIndex?: number;
        targetObstacleId?: string;
        impactPoint?: Point;
      };
      
      switch (collision.type) {
        case 'soldier':
          payload = { 
            type: 'soldier', 
            targetPlayerId: collision.targetPlayerId,
            targetSoldierIndex: collision.targetSoldierIndex,
          };
          break;
        case 'obstacle':
          payload = { type: 'obstacle', targetObstacleId: (collision.target as Obstacle | undefined)?.id };
          break;
        case 'terrain':
          payload = { type: 'terrain', impactPoint: currentPos };
          break;
        case 'boundary':
          payload = { type: 'boundary' };
          break;
        default:
          payload = { type: 'miss' };
      }

      // Trigger explosion effect with appropriate color
      const explosionColor = collision.type === 'soldier' 
        ? COLORS.teamRed 
        : collision.type === 'terrain'
          ? COLORS.terrainFill
          : COLORS.explosion;
      triggerExplosion(currentPos, explosionColor);

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
  }, [projectile, players, obstacles, render, checkCollision, onAnimationComplete, explosions, triggerExplosion]);

  // Start/stop animation when projectile or explosions change
  useEffect(() => {
    if (projectile?.isActive || explosions.length > 0) {
      if (projectile?.isActive) {
        projectileIndexRef.current = 0;
      }
      animationFrameRef.current = requestAnimationFrame(animate);
    } else {
      cancelAnimationFrame(animationFrameRef.current);
      render();
    }

    return () => {
      cancelAnimationFrame(animationFrameRef.current);
    };
  }, [projectile?.isActive, explosions.length > 0, animate, render]);

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
