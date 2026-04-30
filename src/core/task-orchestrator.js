import { TransientError } from "./errors.js";

export class TaskOrchestrator {
  constructor({
    eventBus,
    queue,
    maxConcurrency = 2,
    maxRetries = 3,
    baseDelayMs = 500,
    defaultTimeoutMs = 5000,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  }) {
    this.eventBus = eventBus;
    this.queue = queue;
    this.maxConcurrency = maxConcurrency;
    this.maxRetries = maxRetries;
    this.baseDelayMs = baseDelayMs;
    this.defaultTimeoutMs = defaultTimeoutMs;
    this.sleep = sleep;
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
      timeoutMs: taskInput.timeoutMs ?? this.defaultTimeoutMs,
      nextRunAt: null,
      failReason: null,
      cancelRequested: false,
      abortController: null,
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

  cancelTask(taskId) {
    const task = this.tasks.find((t) => t.id === taskId);
    if (!task) return false;
    if (["completed", "failed", "cancelled"].includes(task.status)) return false;

    task.cancelRequested = true;
    task.failReason = "cancelled-by-user";

    if (task.status === "queued") {
      task.status = "cancelled";
      this.#emitState();
      return true;
    }

    if (task.status === "running") {
      task.abortController?.abort("cancelled-by-user");
      this.#emitState();
      return true;
    }

    return false;
  }

  #runWithTimeout(promise, timeoutMs, abortController) {
    const taskPromise = Promise.resolve(promise);
    taskPromise.catch(() => {});

    const racers = [taskPromise];

    if (timeoutMs > 0) {
      racers.push(
        new Promise((_, reject) => {
          setTimeout(() => {
            abortController?.abort("timeout");
            reject(new TransientError("timeout", { code: "ETIMEDOUT" }));
          }, timeoutMs);
        })
      );
    }

    if (abortController?.signal) {
      racers.push(
        new Promise((_, reject) => {
          if (abortController.signal.aborted) {
            reject(new Error("cancelled-by-user"));
            return;
          }

          abortController.signal.addEventListener(
            "abort",
            () => reject(new Error("cancelled-by-user")),
            { once: true }
          );
        })
      );
    }

    return Promise.race(racers);
  }

  #isTransientError(error) {
    return error instanceof TransientError || error?.transient === true;
  }

  #computeBackoffDelay(retriesSoFar) {
    return this.baseDelayMs * Math.pow(2, retriesSoFar);
  }

  #drainQueue() {
    while (this.runningCount < this.maxConcurrency && !this.queue.isEmpty()) {
      const task = this.queue.dequeue();
      if (task.cancelRequested) {
        task.status = "cancelled";
        continue;
      }
      this.#runTask(task);
    }

    this.#emitState();
  }

  async #runTask(task) {
    this.runningCount += 1;
    task.status = "running";
    task.abortController = new AbortController();
    this.#emitState();

    try {
      await this.#runWithTimeout(
        task.run({ task, signal: task.abortController.signal, orchestrator: this }),
        task.timeoutMs,
        task.abortController
      );

      task.status = task.cancelRequested ? "cancelled" : "completed";
    } catch (error) {
      if (task.cancelRequested) {
        task.status = "cancelled";
      } else if (this.#isTransientError(error) && task.retries < this.maxRetries) {
        const delay = this.#computeBackoffDelay(task.retries);
        task.retries += 1;
        task.status = "queued";
        task.nextRunAt = Date.now() + delay;
        this.runningCount = Math.max(0, this.runningCount - 1);
        this.#emitState();
        await this.sleep(delay);
        if (!task.cancelRequested) this.queue.enqueue(task);
        this.#drainQueue();
        return;
      } else {
        task.status = "failed";
        task.failReason = error?.message ?? "unknown";
      }
    }

    this.runningCount = Math.max(0, this.runningCount - 1);
    this.#emitState();
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

  #emitState() {
    this.eventBus.emit("state:changed", this.getState());
  }
}
