'use client';

import React, { useState, useRef, useEffect } from 'react';
import { useGameStore } from '@/stores';
import { getSocket } from '@/lib/socket';

interface Message {
  playerId: string;
  playerName: string;
  message: string;
  timestamp: number;
}

export function Chat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  
  const roomId = useGameStore((state) => state.roomId);
  const myPlayerId = useGameStore((state) => state.myPlayerId);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    const handleMessage = (msg: Message) => {
      setMessages((prev) => [...prev, msg].slice(-50)); // Keep last 50 messages
    };

    socket.on('chatMessage', handleMessage);
    return () => {
      socket.off('chatMessage', handleMessage);
    };
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputValue.trim() || !roomId) return;

    const socket = getSocket();
    if (socket) {
      socket.emit('sendChatMessage', { roomId, message: inputValue });
      setInputValue('');
    }
  };

  return (
    <div className="flex flex-col h-64 bg-gray-900/80 backdrop-blur-sm rounded-xl border border-gray-700 overflow-hidden">
      <div className="p-2 bg-gray-800/50 border-b border-gray-700 text-xs font-bold text-gray-400 uppercase tracking-wider">
        Trò chuyện
      </div>
      
      <div 
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-3 space-y-2 scrollbar-thin scrollbar-thumb-gray-700"
      >
        {messages.length === 0 && (
          <div className="text-center text-gray-600 text-xs mt-4 italic">
            Chưa có tin nhắn nào
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className="flex flex-col">
            <div className="flex items-baseline gap-2">
              <span className={`text-xs font-bold ${msg.playerId === myPlayerId ? 'text-green-400' : 'text-indigo-400'}`}>
                {msg.playerName}
              </span>
              <span className="text-[10px] text-gray-600">
                {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
            <p className="text-sm text-gray-300 break-words">
              {msg.message}
            </p>
          </div>
        ))}
      </div>

      <form onSubmit={handleSendMessage} className="p-2 bg-gray-800/30 border-t border-gray-700">
        <input
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          placeholder="Nhập tin nhắn..."
          className="w-full bg-gray-950 text-white text-sm rounded-lg px-3 py-2 border border-gray-700 focus:outline-none focus:border-indigo-500 transition-colors"
        />
      </form>
    </div>
  );
}
