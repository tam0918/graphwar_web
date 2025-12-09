/**
 * Graphwar Backend Server
 * Express + Socket.io for real-time multiplayer
 */

import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { setupSocketHandlers } from './socket/handlers.js';
import {
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData,
} from './types.js';

const PORT = process.env.PORT || 3001;
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';

// Initialize Express app
const app = express();
app.use(cors({
  origin: FRONTEND_URL,
  credentials: true,
}));
app.use(express.json());

// Create HTTP server
const httpServer = createServer(app);

// Initialize Socket.io with typed events
const io = new Server<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>(httpServer, {
  cors: {
    origin: FRONTEND_URL,
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

// Setup socket event handlers
setupSocketHandlers(io);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API endpoint to check room status (optional)
app.get('/api/room/:roomId', (req, res) => {
  // This could be used by clients to check if a room exists before connecting
  res.json({ exists: true }); // Simplified for now
});

// Start server
httpServer.listen(PORT, () => {
  console.log(`🚀 Graphwar server running on port ${PORT}`);
  console.log(`📡 Accepting connections from ${FRONTEND_URL}`);
});
