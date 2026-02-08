import { describe, expect, it } from "vitest";
import type {
  ActionDefinition,
  NotStartedTask,
  TaskInfo,
  TaskInfoUnknown,
  TaskStore,
} from "../src/services/actionRunner.js";
import { ActionRunner, createNewTask, isActiveStatus } from "../src/services/actionRunner.js";

// --- In-memory TaskStore ---

class InMemoryTaskStore implements TaskStore {
  tasks: TaskInfoUnknown[] = [];

  async getAllTasks(beginTimestamp: number, endTimestamp?: number) {
    return this.tasks.filter(
      (t) => t.startedAt >= beginTimestamp && (endTimestamp === undefined || t.startedAt <= endTimestamp),
    );
  }

  async getActiveTasks() {
    return this.tasks.filter((t) => isActiveStatus(t.status));
  }

  async getTask(id: string) {
    return this.tasks.find((t) => t.id === id) ?? null;
  }

  async addTask(taskInfo: TaskInfoUnknown) {
    this.tasks.push(taskInfo);
  }

  async updateTask(taskInfo: TaskInfoUnknown) {
    const idx = this.tasks.findIndex((t) => t.id === taskInfo.id);
    if (idx >= 0) this.tasks[idx] = taskInfo;
  }
}

// --- Test Helpers ---

interface CounterTaskData {
  updatesRemaining: number;
}

/**
 * Creates a simple action that completes after N update() calls.
 *
 * Lifecycle:
 * - start() → creates task in "pre-start" status
 * - First update() → transitions to "running"
 * - Next N-1 updates → decrements counter
 * - When counter reaches 0 → transitions to "completed"
 */
function makeCounterAction(
  name: string,
  resources: string[],
  updatesUntilDone: number,
  opts?: {
    shouldStart?: (activeTasks: TaskInfoUnknown[]) => boolean;
    start?: (activeTasks: TaskInfoUnknown[], force: boolean) => Promise<TaskInfo<CounterTaskData> | NotStartedTask>;
  },
): ActionDefinition<CounterTaskData> {
  const definition: ActionDefinition<CounterTaskData> = {
    name,
    lockResources: () => resources,

    shouldStart: async (activeTasks) => {
      return opts?.shouldStart ? opts.shouldStart(activeTasks) : true;
    },

    start:
      opts?.start ??
      (async (_activeTasks, _force) => createNewTask(name, resources, { updatesRemaining: updatesUntilDone })),

    update: async (taskInfo) => {
      // First update: transition from pre-start to running
      if (taskInfo.status === "pre-start") {
        return {
          ...taskInfo,
          status: "running" as const,
          statusMessage: "started",
        };
      }

      // Subsequent updates: decrement counter
      const remaining = taskInfo.taskData.updatesRemaining - 1;
      if (remaining <= 0) {
        return {
          ...taskInfo,
          status: "completed" as const,
          statusMessage: "done",
          finishedAt: Date.now(),
          taskData: { ...taskInfo.taskData, updatesRemaining: 0 },
        };
      }

      return {
        ...taskInfo,
        statusMessage: `${remaining} updates remaining`,
        taskData: { ...taskInfo.taskData, updatesRemaining: remaining },
      };
    },

    stop: async () => {},
  };
  return definition;
}

/**
 * Helper to create an action that only starts once (prevents restarts)
 */
function makeOneTimeAction(
  name: string,
  resources: string[],
  updatesUntilDone: number,
): ActionDefinition<CounterTaskData> {
  let hasStarted = false;
  return makeCounterAction(name, resources, updatesUntilDone, {
    shouldStart: () => !hasStarted,
    start: async (_activeTasks, _force) => {
      hasStarted = true;
      return createNewTask(name, resources, {
        updatesRemaining: updatesUntilDone,
      });
    },
  });
}

/**
 * Helper to create ActionRunner with properly typed actions.
 * Accepts actions with any task data type and casts them to ActionDefinition<unknown>
 * for ActionRunner. This is safe because ActionRunner's runtime contract ensures
 * tasks match their definition's type.
 */
function createActionRunner<T>(store: TaskStore, ...actions: Array<ActionDefinition<T>>): ActionRunner {
  // Cast is safe: ActionRunner's runtime contract ensures tasks match their definition's type
  return new ActionRunner(store, actions as unknown as Array<ActionDefinition<unknown>>);
}

// --- Tests ---

describe("ActionRunner", () => {
  describe("task lifecycle", () => {
    it("progresses through pre-start → running → completed", async () => {
      const store = new InMemoryTaskStore();
      const action = makeOneTimeAction("vault-sync", ["chain:8453:vault"], 2);
      const runner = createActionRunner(store, action);

      // Tick 1: start + first update → pre-start → running
      await runner.runActionLoop();
      expect(store.tasks).toHaveLength(1);
      expect(store.tasks[0].status).toBe("running");

      // Tick 2: update (2 → 1)
      await runner.runActionLoop();
      expect(store.tasks[0].status).toBe("running");
      expect((store.tasks[0].taskData as CounterTaskData).updatesRemaining).toBe(1);

      // Tick 3: update (1 → 0 → completed)
      await runner.runActionLoop();
      expect(store.tasks[0].status).toBe("completed");
      expect(store.tasks[0].finishedAt).not.toBeNull();
    });

    it("tracks lastUpdatedAt on each tick", async () => {
      const store = new InMemoryTaskStore();
      const action = makeCounterAction("tracker", ["res:a"], 3);
      const runner = createActionRunner(store, action);

      await runner.runActionLoop();
      const t1 = store.tasks[0].lastUpdatedAt;

      await new Promise((r) => setTimeout(r, 5));

      await runner.runActionLoop();
      const t2 = store.tasks[0].lastUpdatedAt;

      expect(t2).toBeGreaterThan(t1);
    });
  });

  describe("task start conditions", () => {
    it("does not start when shouldStart returns false", async () => {
      const store = new InMemoryTaskStore();
      const action = makeCounterAction("lazy", ["res:a"], 1, {
        shouldStart: () => false,
      });
      const runner = createActionRunner(store, action);

      await runner.runActionLoop();
      expect(store.tasks).toHaveLength(0);
    });

    it("does not start when start() returns NotStartedTask", async () => {
      const store = new InMemoryTaskStore();
      // Using unknown since this action never actually creates a task
      const action: ActionDefinition<unknown> = {
        name: "picky",
        lockResources: () => ["res:a"],
        shouldStart: async () => true,
        start: async (_activeTasks, _force) => ({ message: "conditions not met" }) as NotStartedTask,
        update: async (t) => t,
        stop: async () => {},
      };
      const runner = createActionRunner(store, action);

      await runner.runActionLoop();
      expect(store.tasks).toHaveLength(0);
    });
  });

  describe("resource locking", () => {
    it("prevents concurrent execution when resources overlap", async () => {
      const store = new InMemoryTaskStore();
      const slow = makeOneTimeAction("slow", ["chain:8453:liquidity"], 2);
      const fast = makeCounterAction("fast", ["chain:8453:liquidity"], 1);

      const runner = createActionRunner(store, slow, fast);

      // Tick 1: slow starts, fast blocked by resource lock
      await runner.runActionLoop();
      expect(store.tasks).toHaveLength(1);
      expect(store.tasks[0].definitionName).toBe("slow");

      // Tick 2: slow still running, fast still blocked
      await runner.runActionLoop();
      expect(store.tasks).toHaveLength(1);

      // Tick 3: slow completes, resource freed, fast starts
      await runner.runActionLoop();
      expect(store.tasks).toHaveLength(2);
      expect(store.tasks[0].status).toBe("completed");
      expect(store.tasks[1].definitionName).toBe("fast");
    });

    it("allows concurrent execution when resources don't overlap", async () => {
      const store = new InMemoryTaskStore();
      const vaultSync = makeOneTimeAction("vault-sync", ["chain:8453:vault"], 2);
      const hookFee = makeOneTimeAction("hook-fee", ["chain:8453:hook"], 2);

      const runner = createActionRunner(store, vaultSync, hookFee);

      await runner.runActionLoop();
      expect(store.tasks).toHaveLength(2);
      expect(store.tasks.map((t) => t.definitionName).sort()).toEqual(["hook-fee", "vault-sync"]);
    });

    it("prevents duplicate tasks via resource lock", async () => {
      const store = new InMemoryTaskStore();
      // shouldStart always true, but resource lock prevents second instance
      const action = makeCounterAction("sync", ["chain:8453:vault"], 3);
      const runner = createActionRunner(store, action);

      await runner.runActionLoop();
      expect(store.tasks).toHaveLength(1);

      // Task still running → resource locked → can't start another
      await runner.runActionLoop();
      expect(store.tasks).toHaveLength(1);
    });

    it("blocks all actions when multi-resource lock overlaps", async () => {
      const store = new InMemoryTaskStore();
      const bridge = makeOneTimeAction("bridge", ["chain:8453:liquidity", "chain:10:liquidity"], 2);
      const baseDeposit = makeCounterAction("base-deposit", ["chain:8453:liquidity"], 1);
      const opDeposit = makeCounterAction("op-deposit", ["chain:10:liquidity"], 1);

      const runner = createActionRunner(store, bridge, baseDeposit, opDeposit);

      // Tick 1: bridge starts, both deposits blocked
      await runner.runActionLoop();
      expect(store.tasks).toHaveLength(1);
      expect(store.tasks[0].definitionName).toBe("bridge");

      // Tick 2: bridge still running
      await runner.runActionLoop();
      expect(store.tasks).toHaveLength(1);

      // Tick 3: bridge completes, both deposits start
      await runner.runActionLoop();
      expect(store.tasks[0].status).toBe("completed");
      expect(store.tasks).toHaveLength(3);
      const newTasks = store.tasks
        .filter((t) => t.definitionName !== "bridge")
        .map((t) => t.definitionName)
        .sort();
      expect(newTasks).toEqual(["base-deposit", "op-deposit"]);
    });
  });

  describe("error handling", () => {
    it("marks task as error when update() throws", async () => {
      const store = new InMemoryTaskStore();
      let callCount = 0;

      const flaky = makeOneTimeAction("flaky", ["res:a"], 3);
      const originalUpdate = flaky.update;
      flaky.update = async (taskInfo) => {
        callCount++;
        if (callCount === 2) throw new Error("rpc timeout");
        return originalUpdate(taskInfo);
      };

      const runner = createActionRunner(store, flaky);

      // Tick 1: starts successfully (pre-start → running)
      await runner.runActionLoop();
      expect(store.tasks[0].status).toBe("running");

      // Tick 2: update throws, runner catches and marks error
      await runner.runActionLoop();
      expect(store.tasks[0].status).toBe("error");
      expect(store.tasks[0].statusMessage).toBe("rpc timeout");
      expect(store.tasks[0].finishedAt).not.toBeNull();
    });
  });

  describe("action sequencing", () => {
    it("sequences actions: swap completes, then add-liquidity starts", async () => {
      const store = new InMemoryTaskStore();

      let swapDone = false;
      const swap = makeCounterAction("swap", ["chain:8453:liquidity"], 1, {
        shouldStart: () => !swapDone,
      });
      const origSwapUpdate = swap.update;
      swap.update = async (taskInfo) => {
        const result = await origSwapUpdate(taskInfo);
        if (result.status === "completed") swapDone = true;
        return result;
      };

      const addLiq = makeCounterAction("add-liquidity", ["chain:8453:liquidity"], 1, {
        shouldStart: () => swapDone,
      });

      const runner = createActionRunner(store, swap, addLiq);

      // Tick 1: swap starts, add-liquidity blocked (resource + shouldStart)
      await runner.runActionLoop();
      expect(store.tasks).toHaveLength(1);
      expect(store.tasks[0].definitionName).toBe("swap");

      // Tick 2: swap completes, add-liquidity starts
      await runner.runActionLoop();
      expect(store.tasks[0].status).toBe("completed");
      expect(store.tasks).toHaveLength(2);
      expect(store.tasks[1].definitionName).toBe("add-liquidity");
    });
  });

  describe("restart behavior", () => {
    it("restarts action when shouldStart always returns true", async () => {
      const store = new InMemoryTaskStore();
      // shouldStart always true → action restarts after completing
      // This simulates something like "sync vault if balance > 0"
      // where the condition keeps being true.
      const action = makeCounterAction("restarter", ["res:a"], 1);
      const runner = createActionRunner(store, action);

      // Tick 1: starts (pre-start → running)
      await runner.runActionLoop();
      expect(store.tasks).toHaveLength(1);
      expect(store.tasks[0].status).toBe("running");

      // Tick 2: completes, then immediately restarts (same tick)
      await runner.runActionLoop();
      expect(store.tasks).toHaveLength(2);
      console.log(store.tasks);
      expect(store.tasks[0].status).toBe("completed");
      expect(store.tasks[1].status).toBe("running");
    });
  });
});
