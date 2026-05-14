import { EventBus } from "./core/event-bus.js";
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

const workerCountSelect = document.getElementById("workerCountSelect");
if (workerCountSelect) {
  workerCountSelect.value = String(orchestrator.maxConcurrency);
  workerCountSelect.addEventListener("change", (event) => {
    const nextValue = Number(event.target.value);
    const appliedValue = orchestrator.setMaxConcurrency(nextValue);
    event.target.value = String(appliedValue);
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

document.getElementById("seedTasksBtn")?.addEventListener("click", () => {
  orchestrator.seedMockTasks(10);
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
