import { logger } from "../logger.js";

export type TaskStatus = "pre-start" | "running" | "completed" | "failed" | "stopped" | "error";

export interface TaskInfo<T> {
  definitionName: string;
  startedAt: number;
  lastUpdatedAt: number;
  finishedAt: number | null;
  status: TaskStatus;
  statusMessage: string;
  id: string;
  taskData: T;
  resourcesTaken: string[];
}

export function isActiveStatus(status: TaskStatus): boolean {
  return status === "pre-start" || status === "running";
}

let globalTaskCounter = 1;

export function createNewTask<T>(definitionName: string, lockResources: string[], data: T): TaskInfo<T> {
  return {
    definitionName: definitionName,
    startedAt: Date.now(),
    lastUpdatedAt: Date.now(),
    finishedAt: null,
    status: "pre-start",
    statusMessage: "waiting to start",
    id: `${definitionName}-${Date.now()}-${globalTaskCounter++}`,
    taskData: data,
    resourcesTaken: lockResources,
  };
}

function isNotStarted(result: unknown): result is NotStartedTask {
  return typeof result === "object" && result !== null && "message" in result && !("status" in result);
}

export interface NotStartedTask {
  message: string;
}

/**
 * Type alias for tasks with unknown data type.
 * Used when we need to work with tasks from different action definitions.
 */
export type TaskInfoUnknown = TaskInfo<unknown>;

export interface ActionDefinition<T> {
  name: string;

  /**
   * Apart from checking against the tasks in shouldStart()/start(), we can quickly
   * skip tasks based on the resources they take.
   */
  lockResources: () => string[];

  shouldStart: (existingTasks: TaskInfoUnknown[]) => Promise<boolean>;
  /**
   * Start a task, put it in pre-start status. The first call to update()
   * should start it (allows us to persist the task before executing).
   */
  start: (existingTasks: TaskInfoUnknown[], force: boolean) => Promise<TaskInfo<T> | NotStartedTask>;
  /**
   * Make progress on this task if possible.
   * @returns The updated task info.
   */
  update: (taskInfo: TaskInfo<T>) => Promise<TaskInfo<T>>;
  stop: (taskInfo: TaskInfo<T>) => Promise<void>;
}

export interface TaskStore {
  getAllTasks: (beginTimestamp: number, endTimestamp?: number) => Promise<TaskInfoUnknown[]>;
  getActiveTasks: () => Promise<TaskInfoUnknown[]>;
  getTask: (id: string) => Promise<TaskInfoUnknown | null>;
  addTask: (taskInfo: TaskInfoUnknown) => Promise<void>;
  updateTask: (taskInfo: TaskInfoUnknown) => Promise<void>;
}

export class ActionRunner {
  private taskStore: TaskStore;
  private actionDefinitions: Map<string, ActionDefinition<unknown>>;

  constructor(taskStore: TaskStore, actionDefinitions: ActionDefinition<unknown>[]) {
    this.taskStore = taskStore;
    this.actionDefinitions = new Map(actionDefinitions.map((definition) => [definition.name, definition]));
  }

  async runActionLoop(signal?: AbortSignal) {
    const activeTasks = await this.taskStore.getActiveTasks();

    logger.info({ activeTasks: activeTasks.map((task) => task.definitionName) }, "Active tasks");

    // Make progress on active tasks
    const updateJobs = activeTasks.map(async (task) => {
      const definition = this.actionDefinitions.get(task.definitionName);
      if (!definition) {
        logger.error({ definitionName: task.definitionName }, "Task definition not found");
        return null;
      }
      try {
        // Note: We trust that tasks in the store match their definition's type.
        // The runtime contract is that tasks are created by their matching definition.
        const updatedTask = await definition.update(task);
        updatedTask.lastUpdatedAt = Date.now();
        if (!isActiveStatus(updatedTask.status)) {
          updatedTask.finishedAt = Date.now();
        }
        await this.taskStore.updateTask(updatedTask);
        return updatedTask;
      } catch (error) {
        // TODO: we could store this and maybe retry later, because the in-task logic
        // would set an error itself if it was an expected error
        logger.error({ task: task.id, error }, "Failed to update task");
        task.status = "error";
        task.statusMessage = error instanceof Error ? error.message : String(error);
        task.lastUpdatedAt = Date.now();
        task.finishedAt = Date.now();
        await this.taskStore.updateTask(task);
        return task;
      }
    });

    const updatedTasks = await Promise.all(updateJobs);
    const stillActive = updatedTasks.filter(
      (task): task is TaskInfoUnknown => task !== null && isActiveStatus(task.status),
    );

    if (signal?.aborted) return;

    // Collect locked resources from still-active tasks
    const lockedResources = new Set(stillActive.flatMap((task) => task.resourcesTaken));

    // Find candidate actions whose resources are free
    const candidateActions = Array.from(this.actionDefinitions.values()).filter((definition) =>
      definition.lockResources().every((resource) => !lockedResources.has(resource)),
    );

    // Start new tasks sequentially (new tasks may conflict with each other)
    for (const candidateAction of candidateActions) {
      if (signal?.aborted) break;
      if (candidateAction.lockResources().some((resource) => lockedResources.has(resource))) {
        continue;
      }

      const shouldStart = await candidateAction.shouldStart(stillActive);
      if (!shouldStart) {
        continue;
      }

      const result = await candidateAction.start(stillActive, false);
      if (isNotStarted(result)) {
        logger.debug({ action: candidateAction.name, reason: result.message }, "Action decided not to start");
        continue;
      }

      // Persist the pre-start task, then run first update
      await this.taskStore.addTask(result);
      candidateAction.lockResources().forEach((resource) => {
        lockedResources.add(resource);
      });

      try {
        // Note: result was created by candidateAction.start(), so it matches the definition's type
        const updated = await candidateAction.update(result);
        updated.lastUpdatedAt = Date.now();
        await this.taskStore.updateTask(updated);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        logger.error({ task: result.id, error: msg }, "Failed first update after start");
        result.status = "error";
        result.statusMessage = msg;
        result.finishedAt = Date.now();
        await this.taskStore.updateTask(result);
      }

      logger.info({ task: result.id, action: candidateAction.name }, "Started new task");
    }
  }
}
