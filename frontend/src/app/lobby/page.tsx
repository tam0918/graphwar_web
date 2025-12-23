'use client';

/**
 * Lobby Page
 * For creating/joining multiplayer rooms
 * All text in Vietnamese
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useGameStore } from '@/stores';
import { connectSocket, createRoom, joinRoom, getSocket } from '@/lib/socket';
import { UI_TEXT } from '@/types';

export default function LobbyPage() {
  const router = useRouter();
  const [playerName, setPlayerName] = useState('');
  const [roomIdInput, setRoomIdInput] = useState('');
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'menu' | 'create' | 'join'>('menu');

  const isConnected = useGameStore((state) => state.isConnected);
  const roomId = useGameStore((state) => state.roomId);
  const players = useGameStore((state) => state.players);
  const turn = useGameStore((state) => state.turn);

  // Connect to socket on mount
  useEffect(() => {
    connectSocket();
  }, []);

  // Navigate to game when room is ready
  useEffect(() => {
    if (roomId && players.length >= 2 && turn.phase === 'input') {
      router.push('/');
    }
  }, [roomId, players.length, turn.phase, router]);

  // Handle create room
  const handleCreateRoom = useCallback(() => {
    if (!playerName.trim()) {
      setError('Vui lòng nhập tên của bạn');
      return;
    }

    setIsConnecting(true);
    setError(null);
    createRoom(playerName);

    // Wait for room creation
    setTimeout(() => {
      setIsConnecting(false);
      const store = useGameStore.getState();
      if (!store.roomId) {
        setError('Không thể tạo phòng. Vui lòng thử lại.');
      }
    }, 3000);
  }, [playerName]);

  // Handle join room
  const handleJoinRoom = useCallback(() => {
    if (!playerName.trim()) {
      setError('Vui lòng nhập tên của bạn');
      return;
    }

    if (!roomIdInput.trim()) {
      setError('Vui lòng nhập mã phòng');
      return;
    }

    setIsConnecting(true);
    setError(null);
    joinRoom(roomIdInput.toUpperCase(), playerName);

    // Wait for room join
    setTimeout(() => {
      setIsConnecting(false);
    }, 3000);
  }, [playerName, roomIdInput]);

  // Handle play local (single device)
  const handlePlayLocal = useCallback(() => {
    router.push('/');
  }, [router]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-indigo-900 to-gray-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo & Title */}
        <div className="text-center mb-8">
          <h1 className="text-5xl font-bold text-white mb-2">
            🎯 Graphwar
          </h1>
          <p className="text-gray-400">
            Trò chơi pháo hàm số - Sử dụng toán học để chiến thắng!
          </p>
        </div>

        {/* Main Card */}
        <div className="bg-gray-800/80 backdrop-blur-sm rounded-2xl p-6 shadow-2xl border border-gray-700">
          {/* Connection Status */}
          <div className="flex items-center justify-center gap-2 mb-6 text-sm">
            <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`} />
            <span className={isConnected ? 'text-green-400' : 'text-red-400'}>
              {isConnected ? 'Đã kết nối server' : 'Đang kết nối...'}
            </span>
          </div>

          {/* Error Message */}
          {error && (
            <div className="mb-4 p-3 bg-red-500/20 border border-red-500/50 rounded-lg text-red-400 text-sm">
              ⚠️ {error}
            </div>
          )}

          {/* Waiting for opponent */}
          {roomId && players.length < 2 && (
            <div className="text-center py-8">
              <div className="w-16 h-16 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
              <p className="text-white font-medium mb-2">
                {UI_TEXT.MSG_WAITING_OPPONENT}
              </p>
              <p className="text-gray-400 text-sm mb-4">
                Chia sẻ mã phòng cho bạn bè:
              </p>
              <div className="bg-gray-900 px-6 py-3 rounded-lg inline-block">
                <span className="font-mono text-2xl text-yellow-400 tracking-wider">
                  {roomId}
                </span>
              </div>
            </div>
          )}

          {/* Menu Mode */}
          {mode === 'menu' && !roomId && (
            <div className="space-y-4">
              {/* Player Name Input */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  {UI_TEXT.LABEL_PLAYER_NAME}
                </label>
                <input
                  type="text"
                  value={playerName}
                  onChange={(e) => setPlayerName(e.target.value)}
                  placeholder="Nhập tên của bạn..."
                  className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  maxLength={20}
                />
              </div>

              {/* Action Buttons */}
              <div className="space-y-3 pt-4">
                <button
                  onClick={() => setMode('create')}
                  disabled={!isConnected}
                  className="w-full py-4 bg-gradient-to-r from-indigo-500 to-purple-600 text-white font-bold rounded-lg hover:from-indigo-600 hover:to-purple-700 transition-all disabled:opacity-50"
                >
                  🏠 {UI_TEXT.BTN_CREATE_ROOM}
                </button>

                <button
                  onClick={() => setMode('join')}
                  disabled={!isConnected}
                  className="w-full py-4 bg-gradient-to-r from-green-500 to-emerald-600 text-white font-bold rounded-lg hover:from-green-600 hover:to-emerald-700 transition-all disabled:opacity-50"
                >
                  🚪 {UI_TEXT.BTN_JOIN}
                </button>

                <div className="relative py-2">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-gray-600" />
                  </div>
                  <div className="relative flex justify-center">
                    <span className="px-4 bg-gray-800 text-gray-400 text-sm">hoặc</span>
                  </div>
                </div>

                <button
                  onClick={handlePlayLocal}
                  className="w-full py-4 bg-gray-700 text-white font-bold rounded-lg hover:bg-gray-600 transition-all border border-gray-600"
                >
                  🎮 Chơi cục bộ (2 người 1 máy)
                </button>
              </div>
            </div>
          )}

          {/* Create Room Mode */}
          {mode === 'create' && !roomId && (
            <div className="space-y-4">
              <button
                onClick={() => setMode('menu')}
                className="text-gray-400 hover:text-white transition-colors text-sm"
              >
                ← Quay lại
              </button>

              <div className="pt-4">
                <h2 className="text-xl font-bold text-white mb-4">
                  🏠 Tạo phòng mới
                </h2>

                <p className="text-gray-400 text-sm mb-4">
                  Tạo phòng và mời bạn bè tham gia bằng mã phòng.
                </p>

                <button
                  onClick={handleCreateRoom}
                  disabled={isConnecting || !playerName.trim()}
                  className="w-full py-4 bg-gradient-to-r from-indigo-500 to-purple-600 text-white font-bold rounded-lg hover:from-indigo-600 hover:to-purple-700 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {isConnecting ? (
                    <>
                      <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      Đang tạo...
                    </>
                  ) : (
                    'Tạo phòng'
                  )}
                </button>
              </div>
            </div>
          )}

          {/* Join Room Mode */}
          {mode === 'join' && !roomId && (
            <div className="space-y-4">
              <button
                onClick={() => setMode('menu')}
                className="text-gray-400 hover:text-white transition-colors text-sm"
              >
                ← Quay lại
              </button>

              <div className="pt-4">
                <h2 className="text-xl font-bold text-white mb-4">
                  🚪 Tham gia phòng
                </h2>

                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    {UI_TEXT.LABEL_ROOM_ID}
                  </label>
                  <input
                    type="text"
                    value={roomIdInput}
                    onChange={(e) => setRoomIdInput(e.target.value.toUpperCase())}
                    placeholder="Nhập mã phòng (6 ký tự)..."
                    className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-green-500 font-mono text-lg tracking-wider text-center uppercase"
                    maxLength={6}
                  />
                </div>

                <button
                  onClick={handleJoinRoom}
                  disabled={isConnecting || !playerName.trim() || !roomIdInput.trim()}
                  className="w-full py-4 bg-gradient-to-r from-green-500 to-emerald-600 text-white font-bold rounded-lg hover:from-green-600 hover:to-emerald-700 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {isConnecting ? (
                    <>
                      <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      Đang kết nối...
                    </>
                  ) : (
                    'Tham gia'
                  )}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="text-center mt-6 text-gray-500 text-sm">
          <p>Đồ án Capstone - Phát triển Ứng dụng Web</p>
        </div>
      </div>
    </div>
  );
}
