import { EventBus } from "./core/event-bus.js";
import { PermanentError, TransientError } from "./core/errors.js";
import { PriorityQueue } from "./core/priority-queue.js";
import { TaskOrchestrator } from "./core/task-orchestrator.js";
import { Dashboard } from "./ui/dashboard.js";

const eventBus = new EventBus();
const queue = new PriorityQueue((a, b) => (a.priority ?? 0) - (b.priority ?? 0));

const orchestrator = new TaskOrchestrator({
  eventBus,
  queue,
  maxConcurrency: 2,
});

const dashboard = new Dashboard({ orchestrator, eventBus });
dashboard.mount();

eventBus.on("state:changed", (state) => dashboard.render(state));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

document.getElementById("seedTasksBtn")?.addEventListener("click", () => {
  const seedTasks = [
    {
      name: "Quick sync",
      priority: 5,
      run: async ({ signal }) => {
        await sleep(700);
        if (signal.aborted) throw Object.assign(new Error("Task cancelled"), { name: "AbortError" });
      },
    },
    {
      name: "Transient retry",
      priority: 4,
      run: async () => {
        await sleep(500);
        throw new TransientError("Temporary upstream outage");
      },
    },
    {
      name: "Permanent failure",
      priority: 3,
      run: async () => {
        await sleep(400);
        throw new PermanentError("Validation failed permanently");
      },
    },
    {
      name: "Long worker task",
      priority: 2,
      run: async ({ signal }) => {
        await sleep(2500);
        if (signal.aborted) throw Object.assign(new Error("Task cancelled"), { name: "AbortError" });
      },
    },
  ];

  for (const task of seedTasks) {
    orchestrator.enqueue({
      id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      ...task,
    });
  }
});

document.getElementById("startBtn")?.addEventListener("click", () => {
  orchestrator.start();
});

document.getElementById("pauseBtn")?.addEventListener("click", () => {
  orchestrator.pause();
});

document.getElementById("resumeBtn")?.addEventListener("click", () => {
  orchestrator.resume();
});

dashboard.render(orchestrator.getState());
