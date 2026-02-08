import Database from "better-sqlite3";
import { logger } from "../logger.js";
import path from "path";
import { existsSync, mkdirSync } from "fs";

export interface ExchangeRateRecord {
  timestamp: string;
  chainId: number;
  usdcOutput: string;
}

export interface PoolPriceRecord {
  timestamp: string;
  chainId: number;
  poolAddress: string;
  sqrtPriceX96: string;
  tick: number;
  liquidity: string;
  fee: number;
  feeGrowthGlobal0: string;
  feeGrowthGlobal1: string;
}

class DatabaseService {
  private db: Database.Database;

  constructor(dbPath: string) {
    const dir = path.dirname(dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

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

      CREATE TABLE IF NOT EXISTS pool_prices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT NOT NULL,
        chainId INTEGER NOT NULL,
        poolAddress TEXT NOT NULL,
        sqrtPriceX96 TEXT NOT NULL,
        tick INTEGER NOT NULL,
        liquidity TEXT NOT NULL,
        fee INTEGER NOT NULL,
        feeGrowthGlobal0 TEXT NOT NULL DEFAULT '0',
        feeGrowthGlobal1 TEXT NOT NULL DEFAULT '0'
      );

      CREATE INDEX IF NOT EXISTS idx_rates_timestamp ON exchange_rates(timestamp);
      CREATE INDEX IF NOT EXISTS idx_rates_chainId ON exchange_rates(chainId);
      CREATE INDEX IF NOT EXISTS idx_pool_prices_timestamp ON pool_prices(timestamp);
      CREATE INDEX IF NOT EXISTS idx_pool_prices_chainId ON pool_prices(chainId);
    `);

    // Migration: add feeGrowthGlobal columns to existing tables
    this.migrateAddColumn("pool_prices", "feeGrowthGlobal0", "TEXT NOT NULL DEFAULT '0'");
    this.migrateAddColumn("pool_prices", "feeGrowthGlobal1", "TEXT NOT NULL DEFAULT '0'");
  }

  private migrateAddColumn(table: string, column: string, type: string): void {
    try {
      this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
      logger.info({ table, column }, "Migration: added column");
    } catch {
      // Column already exists
    }
  }

  insertExchangeRate(record: ExchangeRateRecord): void {
    const stmt = this.db.prepare(`
      INSERT INTO exchange_rates (timestamp, chainId, usdcOutput)
      VALUES (?, ?, ?)
    `);

    stmt.run(record.timestamp, record.chainId, record.usdcOutput);
    logger.debug({ chainId: record.chainId, usdcOutput: record.usdcOutput }, "Exchange rate inserted");
  }

  insertPoolPrice(record: PoolPriceRecord): void {
    const stmt = this.db.prepare(`
      INSERT INTO pool_prices (timestamp, chainId, poolAddress, sqrtPriceX96, tick, liquidity, fee, feeGrowthGlobal0, feeGrowthGlobal1)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      record.timestamp,
      record.chainId,
      record.poolAddress,
      record.sqrtPriceX96,
      record.tick,
      record.liquidity,
      record.fee,
      record.feeGrowthGlobal0,
      record.feeGrowthGlobal1,
    );
    logger.debug({ chainId: record.chainId, poolAddress: record.poolAddress }, "Pool price inserted");
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

  getPoolPricesForChain(chainId: number, minTimestamp: string, maxTimestamp?: string): PoolPriceRecord[] {
    const stmt = this.db.prepare<[number, string, string]>(`
      SELECT timestamp, chainId, poolAddress, sqrtPriceX96, tick, liquidity, fee, feeGrowthGlobal0, feeGrowthGlobal1 FROM pool_prices
      WHERE chainId = ? AND timestamp >= ? AND timestamp <= ?
      ORDER BY timestamp DESC
    `);
    return stmt.all(chainId, minTimestamp, maxTimestamp ?? "9999-99-99") as PoolPriceRecord[];
  }

  getRecentPoolPrices(limit = 256): PoolPriceRecord[] {
    const stmt = this.db.prepare<[number]>(`
      SELECT timestamp, chainId, poolAddress, sqrtPriceX96, tick, liquidity, fee, feeGrowthGlobal0, feeGrowthGlobal1 FROM pool_prices
      ORDER BY timestamp DESC
      LIMIT ?
    `);
    return stmt.all(limit) as PoolPriceRecord[];
  }

  close(): void {
    this.db.close();
    logger.info("Database closed");
  }
}

export let db: DatabaseService;

export function initializeDatabase(dbPath: string): void {
  db = new DatabaseService(dbPath);
}

export function closeDatabase(): void {
  if (db) {
    db.close();
  }
}
