import Database from "better-sqlite3";
import { logger } from "../logger.js";
import path from "path";
import { existsSync, mkdirSync } from "fs";
import type { TaskStore, TaskInfoUnknown } from "./actionRunner.js";
import { taskDbPath } from "../config.js";

class TaskDatabaseService implements TaskStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    const dir = path.dirname(dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.initializeTables();
    logger.info({ dbPath }, "Task database initialized");
  }

  private initializeTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        definitionName TEXT NOT NULL,
        startedAt INTEGER NOT NULL,
        lastUpdatedAt INTEGER NOT NULL,
        finishedAt INTEGER,
        status TEXT NOT NULL,
        statusMessage TEXT NOT NULL,
        taskData TEXT NOT NULL,
        resourcesTaken TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_tasks_startedAt ON tasks(startedAt);
      CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
      CREATE INDEX IF NOT EXISTS idx_tasks_definitionName ON tasks(definitionName);
    `);
  }

  async getAllTasks(
    beginTimestamp: number,
    endTimestamp?: number,
  ): Promise<TaskInfoUnknown[]> {
    const stmt = this.db.prepare<[number, number]>(`
      SELECT * FROM tasks
      WHERE startedAt >= ? AND startedAt <= ?
      ORDER BY startedAt DESC
    `);

    const rows = stmt.all(beginTimestamp, endTimestamp ?? Date.now());
    return rows.map(this.rowToTaskInfo);
  }

  async getActiveTasks(): Promise<TaskInfoUnknown[]> {
    const stmt = this.db.prepare(`
      SELECT * FROM tasks
      WHERE status IN ('pre-start', 'running')
      ORDER BY startedAt ASC
    `);

    const rows = stmt.all();
    return rows.map(this.rowToTaskInfo);
  }

  async getTask(id: string): Promise<TaskInfoUnknown | null> {
    const stmt = this.db.prepare<[string]>(`
      SELECT * FROM tasks
      WHERE id = ?
    `);

    const row = stmt.get(id);
    return row ? this.rowToTaskInfo(row) : null;
  }

  async addTask(taskInfo: TaskInfoUnknown): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT INTO tasks (
        id, definitionName, startedAt, lastUpdatedAt, finishedAt,
        status, statusMessage, taskData, resourcesTaken
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      taskInfo.id,
      taskInfo.definitionName,
      taskInfo.startedAt,
      taskInfo.lastUpdatedAt,
      taskInfo.finishedAt,
      taskInfo.status,
      taskInfo.statusMessage,
      JSON.stringify(taskInfo.taskData),
      JSON.stringify(taskInfo.resourcesTaken),
    );

    logger.debug(
      { taskId: taskInfo.id, definitionName: taskInfo.definitionName },
      "Task added to store",
    );
  }

  async updateTask(taskInfo: TaskInfoUnknown): Promise<void> {
    const stmt = this.db.prepare(`
      UPDATE tasks
      SET definitionName = ?,
          startedAt = ?,
          lastUpdatedAt = ?,
          finishedAt = ?,
          status = ?,
          statusMessage = ?,
          taskData = ?,
          resourcesTaken = ?
      WHERE id = ?
    `);

    const changes = stmt.run(
      taskInfo.definitionName,
      taskInfo.startedAt,
      taskInfo.lastUpdatedAt,
      taskInfo.finishedAt,
      taskInfo.status,
      taskInfo.statusMessage,
      JSON.stringify(taskInfo.taskData),
      JSON.stringify(taskInfo.resourcesTaken),
      taskInfo.id,
    ).changes;

    if (changes === 0) {
      logger.warn({ taskId: taskInfo.id }, "Task not found for update");
    } else {
      logger.debug(
        { taskId: taskInfo.id, status: taskInfo.status },
        "Task updated in store",
      );
    }
  }

  async getRecentTasks(limit: number): Promise<TaskInfoUnknown[]> {
    const stmt = this.db.prepare<[number]>(`
      SELECT * FROM tasks
      ORDER BY startedAt DESC
      LIMIT ?
    `);

    const rows = stmt.all(limit);
    return rows.map(this.rowToTaskInfo);
  }

  private rowToTaskInfo(row: any): TaskInfoUnknown {
    return {
      id: row.id,
      definitionName: row.definitionName,
      startedAt: row.startedAt,
      lastUpdatedAt: row.lastUpdatedAt,
      finishedAt: row.finishedAt,
      status: row.status,
      statusMessage: row.statusMessage,
      taskData: JSON.parse(row.taskData),
      resourcesTaken: JSON.parse(row.resourcesTaken),
    };
  }

  close(): void {
    this.db.close();
    logger.info("Task database closed");
  }
}

export let taskDb: TaskDatabaseService;

export function initializeTaskDatabase(): TaskDatabaseService {
  taskDb = new TaskDatabaseService(taskDbPath);
  return taskDb;
}

export function closeTaskDatabase(): void {
  if (taskDb) {
    taskDb.close();
  }
}
