import mariadb from "mariadb";
import type { PlayerStats } from "@graphwar/shared";

type RawRow = {
  name: string;
  total_games: number;
  total_wins: number;
  total_kills: number;
  best_multi_kill: number;
};

function toStats(row: RawRow): PlayerStats {
  const totalGames = Number(row.total_games ?? 0);
  const totalWins = Number(row.total_wins ?? 0);
  const winRate = totalGames > 0 ? totalWins / totalGames : 0;

  return {
    name: String(row.name),
    totalGames,
    totalWins,
    winRate,
    totalKills: Number(row.total_kills ?? 0),
    bestMultiKill: Number(row.best_multi_kill ?? 0),
  };
}

export function createStatsDbFromEnv() {
  const host = process.env.DB_HOST;
  const user = process.env.DB_USER;
  const password = process.env.DB_PASSWORD;
  const database = process.env.DB_DATABASE;
  const port = Number(process.env.DB_PORT ?? 3306);
  const connectionLimit = Number(process.env.DB_CONNECTION_LIMIT ?? 5);

  const enabled = !!(host && user && password != null && database);

  const pool = enabled
    ? mariadb.createPool({
        host,
        user,
        password,
        database,
        port,
        connectionLimit,
      })
    : null;

  async function init(): Promise<void> {
    if (!pool) return;
    const conn = await pool.getConnection();
    try {
      await conn.query(`
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
        )
      `);
    } finally {
      conn.release();
    }
  }

  async function getPlayer(name: string): Promise<PlayerStats> {
    if (!pool) {
      return {
        name,
        totalGames: 0,
        totalWins: 0,
        winRate: 0,
        totalKills: 0,
        bestMultiKill: 0,
      };
    }

    const conn = await pool.getConnection();
    try {
      const rows = (await conn.query(
        "SELECT name, total_games, total_wins, total_kills, best_multi_kill FROM player_stats WHERE name = ? LIMIT 1",
        [name],
      )) as RawRow[];

      if (!rows?.length) {
        return {
          name,
          totalGames: 0,
          totalWins: 0,
          winRate: 0,
          totalKills: 0,
          bestMultiKill: 0,
        };
      }

      return toStats(rows[0]!);
    } finally {
      conn.release();
    }
  }

  async function getLeaderboard(limit: number): Promise<PlayerStats[]> {
    if (!pool) return [];

    const conn = await pool.getConnection();
    try {
      const rows = (await conn.query(
        `
        SELECT name, total_games, total_wins, total_kills, best_multi_kill
        FROM player_stats
        ORDER BY total_wins DESC, (total_wins / NULLIF(total_games, 0)) DESC, total_games DESC, name ASC
        LIMIT ?
        `,
        [limit],
      )) as RawRow[];

      return (rows ?? []).map(toStats);
    } finally {
      conn.release();
    }
  }

  async function recordMatch(args: {
    players: Array<{ name: string; didWin: boolean; kills: number; bestMultiKill: number }>;
  }): Promise<void> {
    if (!pool) return;

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      for (const p of args.players) {
        const name = p.name.trim().slice(0, 64);
        if (!name) continue;

        const gamesInc = 1;
        const winsInc = p.didWin ? 1 : 0;
        const killsInc = Math.max(0, p.kills | 0);
        const bestMultiKill = Math.max(0, p.bestMultiKill | 0);

        await conn.query(
          `
          INSERT INTO player_stats (name, total_games, total_wins, total_kills, best_multi_kill)
          VALUES (?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            total_games = total_games + VALUES(total_games),
            total_wins = total_wins + VALUES(total_wins),
            total_kills = total_kills + VALUES(total_kills),
            best_multi_kill = GREATEST(best_multi_kill, VALUES(best_multi_kill)),
            updated_at = CURRENT_TIMESTAMP
          `,
          [name, gamesInc, winsInc, killsInc, bestMultiKill],
        );
      }

      await conn.commit();
    } catch (e) {
      try {
        await conn.rollback();
      } catch {
        // ignore
      }
      throw e;
    } finally {
      conn.release();
    }
  }

  return {
    enabled,
    init,
    getPlayer,
    getLeaderboard,
    recordMatch,
  };
}
