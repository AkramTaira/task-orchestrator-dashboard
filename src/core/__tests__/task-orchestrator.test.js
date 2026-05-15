import { describe, expect, it, vi } from "vitest";
import { EventBus } from "../event-bus.js";
import { PermanentError, TransientError } from "../errors.js";
import { PriorityQueue } from "../priority-queue.js";
import { TaskOrchestrator } from "../task-orchestrator.js";

function createOrchestrator(overrides = {}) {
  return new TaskOrchestrator({
    eventBus: new EventBus(),
    queue: new PriorityQueue((a, b) => {
      const priorityDelta = (a.priority ?? 0) - (b.priority ?? 0);
      if (priorityDelta !== 0) return priorityDelta;

      const aEnqueuedAt = a.enqueuedAt ?? a.createdAt ?? 0;
      const bEnqueuedAt = b.enqueuedAt ?? b.createdAt ?? 0;
      return bEnqueuedAt - aEnqueuedAt;
    }),
    maxConcurrency: 1,
    maxRetries: 2,
    retryDelayMs: 50,
    taskTimeoutMs: 50,
    ...overrides,
  });
}

async function settleTasks(iterations = 12) {
  for (let index = 0; index < iterations; index += 1) {
    await Promise.resolve();
  }
}

describe("TaskOrchestrator", () => {
  it("executes a queued task", async () => {
    const orchestrator = createOrchestrator();
    const ran = [];

    orchestrator.enqueue({
      id: "job-1",
      priority: 1,
      run: async () => {
        ran.push("job-1");
      },
    });

    orchestrator.start();
    await settleTasks();

    expect(ran).toEqual(["job-1"]);
    expect(orchestrator.getState().tasks.find((task) => task.id === "job-1")?.status).toBe(
      "completed"
    );
  });

  it("retries transient failures with backoff", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);

    const orchestrator = createOrchestrator();
    let attempts = 0;

    orchestrator.enqueue({
      id: "retry-task",
      priority: 1,
      run: async () => {
        attempts += 1;
        if (attempts < 3) {
          throw new TransientError("temporary", { code: "ETIMEDOUT" });
        }
      },
    });

    orchestrator.start();
    await Promise.resolve();
    await vi.runAllTimersAsync();
    await settleTasks();

    const task = orchestrator.getState().tasks.find((entry) => entry.id === "retry-task");

    expect(attempts).toBe(3);
    expect(task?.status).toBe("completed");

    vi.useRealTimers();
  });

  it("does not retry permanent errors", async () => {
    const orchestrator = createOrchestrator();
    let attempts = 0;

    orchestrator.enqueue({
      id: "permanent-failure",
      priority: 1,
      run: async () => {
        attempts += 1;
        throw new PermanentError("validation", { status: 400 });
      },
    });

    orchestrator.start();
    await settleTasks();

    expect(attempts).toBe(1);
    expect(orchestrator.getState().tasks.find((task) => task.id === "permanent-failure")?.status).toBe(
      "failed"
    );
  });

  it("cancels queued tasks before they start", async () => {
    const orchestrator = createOrchestrator();
    let ran = false;

    const taskId = orchestrator.enqueue({
      id: "queued-cancel",
      priority: 1,
      run: async () => {
        ran = true;
      },
    });

    expect(orchestrator.cancelTask(taskId)).toBe(true);

    orchestrator.start();
    await settleTasks();

    expect(ran).toBe(false);
    expect(orchestrator.getState().tasks.find((task) => task.id === taskId)?.status).toBe(
      "cancelled"
    );
  });

  it("cancels running tasks through AbortSignal", async () => {
    const orchestrator = createOrchestrator();

    const taskId = orchestrator.enqueue({
      id: "running-cancel",
      priority: 1,
      run: async ({ signal }) => {
        await new Promise((resolve, reject) => {
          const timer = setTimeout(resolve, 1000);
          signal.addEventListener(
            "abort",
            () => {
              clearTimeout(timer);
              reject(new Error("cancelled-by-user"));
            },
            { once: true }
          );
        });
      },
    });

    orchestrator.start();
    await settleTasks();
    expect(orchestrator.cancelTask(taskId)).toBe(true);
    await settleTasks();

    expect(orchestrator.getState().tasks.find((task) => task.id === taskId)?.status).toBe(
      "cancelled"
    );
  });

  it("hydrates saved state on start", async () => {
    const persistence = {
      loadState: vi.fn(async () => ({
        idCounter: 12,
        maxConcurrency: 3,
        tasks: [
          {
            id: "persisted-1",
            name: "Persisted Task",
            priority: 4,
            basePriority: 4,
            status: "completed",
            retries: 0,
            progress: 100,
            timeoutMs: 100,
          },
        ],
      })),
      saveState: vi.fn(async () => true),
    };

    const orchestrator = createOrchestrator({ persistence, persistDebounceMs: 0 });

    await orchestrator.start();

    expect(persistence.loadState).toHaveBeenCalledTimes(1);
    expect(orchestrator.getState().tasks[0]?.id).toBe("persisted-1");
    expect(orchestrator.getState().maxConcurrency).toBe(3);
  });

  it("ages queued priorities to reduce starvation", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);

    const orchestrator = createOrchestrator({
      priorityAgingIntervalMs: 1000,
      priorityAgingStep: 2,
      priorityAgingMaxBoost: 10,
    });
    const order = [];

    orchestrator.enqueue({
      id: "old-low",
      priority: 1,
      run: async () => {
        order.push("old-low");
      },
    });

    vi.setSystemTime(5000);

    orchestrator.enqueue({
      id: "new-high",
      priority: 5,
      run: async () => {
        order.push("new-high");
      },
    });

    orchestrator.start();
    await settleTasks();

    expect(order[0]).toBe("old-low");
    expect(order[1]).toBe("new-high");

    vi.useRealTimers();
  });
});