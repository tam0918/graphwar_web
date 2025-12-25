-- MariaDB schema for Graphwar Web stats
-- Run:
--   mysql -u root -p < server/sql/schema.sql

CREATE DATABASE IF NOT EXISTS graphwar
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_general_ci;

USE graphwar;

CREATE TABLE IF NOT EXISTS player_stats (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(64) NOT NULL,
  total_games INT NOT NULL DEFAULT 0,
  total_wins INT NOT NULL DEFAULT 0,
  total_kills INT NOT NULL DEFAULT 0,
  best_multi_kill INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_player_name (name)
);
