import { TransientError } from "./errors.js";

export class TaskOrchestrator {
  constructor({ eventBus, queue, maxConcurrency = 2, maxRetries = 2 }) {
    this.eventBus = eventBus;
    this.queue = queue;
    this.maxConcurrency = maxConcurrency;
    this.maxRetries = maxRetries;
    this.tasks = [];
    this.runningCount = 0;
    this.isStarted = false;
  }

  enqueue(taskInput) {
    const task = {
      id: taskInput.id,
      name: taskInput.name,
      priority: taskInput.priority ?? 1,
      status: "queued",
      retries: 0,
      failReason: null,
      run: taskInput.run,
    };

    this.tasks.push(task);
    this.queue.enqueue(task);
    if (this.isStarted) this.#drainQueue();
    this.#emitState();
    return task.id;
  }

  start() {
    this.isStarted = true;
    this.#drainQueue();
  }

  getState() {
    return {
      tasks: this.tasks,
      runningCount: this.runningCount,
      queueSize: this.queue.size(),
      maxConcurrency: this.maxConcurrency,
    };
  }

  #isTransientError(error) {
    if (!error) return false;
    if (error instanceof TransientError) return true;
    if (error.transient === true) return true;
    if (["ETIMEDOUT", "ECONNRESET"].includes(error.code)) return true;
    return false;
  }

  #drainQueue() {
    while (this.runningCount < this.maxConcurrency && !this.queue.isEmpty()) {
      const task = this.queue.dequeue();
      this.#runTask(task);
    }

    this.#emitState();
  }

  async #runTask(task) {
    this.runningCount += 1;
    task.status = "running";
    this.#emitState();

    try {
      await task.run();
      task.status = "completed";
    } catch (error) {
      if (this.#isTransientError(error) && task.retries < this.maxRetries) {
        task.retries += 1;
        task.status = "queued";
        this.queue.enqueue(task);
      } else {
        task.status = "failed";
        task.failReason = error?.message ?? "unknown";
      }
    }

    this.runningCount = Math.max(0, this.runningCount - 1);
    this.#emitState();
    this.#drainQueue();
  }

  #emitState() {
    this.eventBus.emit("state:changed", this.getState());
  }
}
