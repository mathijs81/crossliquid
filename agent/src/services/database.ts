import Database from "better-sqlite3";
import { logger } from "../logger";

export interface ExchangeRateRecord {
  timestamp: string;
  chainId: number;
  usdcOutput: string;
}

class DatabaseService {
  private db: Database.Database;

  constructor(dbPath = "./data/agent.db") {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.initializeTables();
    logger.info({ dbPath }, "Database initialized");
  }

  private initializeTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS exchange_rates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT NOT NULL,
        chainId INTEGER NOT NULL,
        usdcOutput TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_rates_timestamp ON exchange_rates(timestamp);
      CREATE INDEX IF NOT EXISTS idx_rates_chainId ON exchange_rates(chainId);
    `);
  }

  insertExchangeRate(record: ExchangeRateRecord): void {
    const stmt = this.db.prepare(`
      INSERT INTO exchange_rates (timestamp, chainId, usdcOutput)
      VALUES (?, ?, ?)
    `);

    stmt.run(record.timestamp, record.chainId, record.usdcOutput);
    logger.debug({ chainId: record.chainId, usdcOutput: record.usdcOutput }, "Exchange rate inserted");
  }

  getRecentRates(chainId?: number, limit = 100): ExchangeRateRecord[] {
    if (chainId !== undefined) {
      const stmt = this.db.prepare<[number, number]>(`
        SELECT timestamp, chainId, usdcOutput FROM exchange_rates
        WHERE chainId = ?
        ORDER BY timestamp DESC
        LIMIT ?
      `);
      return stmt.all(chainId, limit) as ExchangeRateRecord[];
    }

    const stmt = this.db.prepare<[number]>(`
      SELECT timestamp, chainId, usdcOutput FROM exchange_rates
      ORDER BY timestamp DESC
      LIMIT ?
    `);
    return stmt.all(limit) as ExchangeRateRecord[];
  }

  close(): void {
    this.db.close();
    logger.info("Database closed");
  }
}

export let db: DatabaseService;

export function initializeDatabase(dbPath?: string): void {
  db = new DatabaseService(dbPath);
}

export function closeDatabase(): void {
  if (db) {
    db.close();
  }
}
