'use client';

/**
 * GameInfo Component
 * Displays game status, player info, and scores
 * All text in Vietnamese
 */

import React from 'react';
import { Player, UI_TEXT } from '@/types';

interface GameInfoProps {
  players: Player[];
  currentPlayerId: string | null;
  myPlayerId: string | null;
  turnNumber: number;
  roomId?: string;
  timeLeft?: number;
}

export function GameInfo({
  players,
  currentPlayerId,
  myPlayerId,
  turnNumber,
  roomId,
  timeLeft,
}: GameInfoProps) {
  const getTeamName = (team: 'red' | 'blue') => {
    return team === 'red' ? UI_TEXT.TEAM_RED : UI_TEXT.TEAM_BLUE;
  };

  return (
    <div className="bg-gray-900/90 backdrop-blur-sm rounded-xl p-4 shadow-2xl border border-gray-700">
      {/* Room ID */}
      {roomId && (
        <div className="mb-4 pb-3 border-b border-gray-700">
          <span className="text-xs text-gray-500">{UI_TEXT.LABEL_ROOM_ID}: </span>
          <span className="font-mono text-sm text-indigo-400">{roomId}</span>
        </div>
      )}

      {/* Turn Counter */}
      <div className="mb-4 text-center flex flex-col items-center">
        <span className="text-2xl font-bold text-white">
          {UI_TEXT.LABEL_TURN} #{turnNumber}
        </span>
        {timeLeft !== undefined && (
          <div className={`
            mt-1 px-3 py-1 rounded-full text-sm font-mono font-bold
            ${timeLeft <= 5 ? 'bg-red-500 text-white animate-pulse' : 'bg-gray-800 text-yellow-400'}
          `}>
            ⏱️ {timeLeft}s
          </div>
        )}
      </div>

      {/* Players List */}
      <div className="space-y-3">
        <h3 className="text-sm font-medium text-gray-400 uppercase tracking-wider">
          {UI_TEXT.LABEL_PLAYER}
        </h3>
        
        {players.map((player) => {
          const isCurrentTurn = player.id === currentPlayerId;
          const isMe = player.id === myPlayerId;
          const healthPercent = (player.health / player.maxHealth) * 100;

          return (
            <div
              key={player.id}
              className={`
                p-3 rounded-lg border transition-all duration-300
                ${isCurrentTurn 
                  ? 'border-yellow-500/50 bg-yellow-500/10' 
                  : 'border-gray-700 bg-gray-800/50'
                }
                ${!player.isAlive ? 'opacity-50' : ''}
              `}
            >
              {/* Player Header */}
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  {/* Team Color Indicator */}
                  <div
                    className={`
                      w-3 h-3 rounded-full
                      ${player.team === 'red' ? 'bg-red-500' : 'bg-blue-500'}
                    `}
                  />
                  {/* Player Name */}
                  <span className={`
                    font-medium
                    ${isMe ? 'text-green-400' : 'text-white'}
                  `}>
                    {player.name}
                    {isMe && <span className="text-xs ml-1">(Bạn)</span>}
                  </span>
                </div>
                
                {/* Turn Indicator */}
                {isCurrentTurn && (
                  <span className="text-xs px-2 py-1 bg-yellow-500/20 text-yellow-400 rounded">
                    ▶ Lượt hiện tại
                  </span>
                )}
              </div>

              {/* Team Badge */}
              <div className="mb-2">
                <span className={`
                  text-xs px-2 py-0.5 rounded
                  ${player.team === 'red' 
                    ? 'bg-red-500/20 text-red-400' 
                    : 'bg-blue-500/20 text-blue-400'
                  }
                `}>
                  {getTeamName(player.team)}
                </span>
              </div>

              {/* Health Bar */}
              <div className="space-y-1">
                <div className="flex justify-between text-xs text-gray-400">
                  <span>{UI_TEXT.LABEL_HEALTH}</span>
                  <span>{player.health}/{player.maxHealth}</span>
                </div>
                <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
                  <div
                    className={`
                      h-full transition-all duration-500
                      ${healthPercent > 50 
                        ? 'bg-green-500' 
                        : healthPercent > 25 
                          ? 'bg-yellow-500' 
                          : 'bg-red-500'
                      }
                    `}
                    style={{ width: `${healthPercent}%` }}
                  />
                </div>
              </div>

              {/* Death Status */}
              {!player.isAlive && (
                <div className="mt-2 text-center text-red-400 text-sm font-medium">
                  💀 Đã bị loại
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default GameInfo;
