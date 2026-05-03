import { PermanentError, TransientError } from "./errors.js";

export class TaskOrchestrator {
  constructor({ eventBus, queue, maxConcurrency = 2, taskTimeoutMs = 5000, retryDelayMs = 500, maxRetries = 3 }) {
    this.eventBus = eventBus;
    this.queue = queue;
    this.maxConcurrency = maxConcurrency;
    this.taskTimeoutMs = taskTimeoutMs;
    this.retryDelayMs = retryDelayMs;
    this.maxRetries = maxRetries;
    this.tasks = [];
    this.runningCount = 0;
    this.isStarted = false;
    this.isPaused = false;
  }

  enqueue(taskInput) {
    const task = {
      id: taskInput.id,
      name: taskInput.name,
      priority: taskInput.priority ?? 1,
      status: "queued",
      retries: taskInput.retries ?? 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      startedAt: null,
      finishedAt: null,
      nextRunAt: 0,
      retryTimer: null,
      abortController: null,
      cancelRequested: false,
      failReason: "",
      progress: 0,
      timeoutMs: taskInput.timeoutMs ?? this.taskTimeoutMs,
      retryDelayMs: taskInput.retryDelayMs ?? this.retryDelayMs,
      maxRetries: taskInput.maxRetries ?? this.maxRetries,
      run: taskInput.run,
    };

    this.tasks.push(task);
    this.queue.enqueue(task);
    this.#emitState();

    if (this.isStarted && !this.isPaused) {
      this.#drainQueue();
    }

    return task.id;
  }

  start() {
    this.isStarted = true;
    this.isPaused = false;
    this.#emitState();
    this.#drainQueue();
  }

  pause() {
    this.isStarted = true;
    this.isPaused = true;
    this.#emitState();
  }

  resume() {
    this.isStarted = true;
    this.isPaused = false;
    this.#emitState();
    this.#drainQueue();
  }

  cancelTask(taskId) {
    const task = this.#findTask(taskId);
    if (!task || ["completed", "failed", "cancelled"].includes(task.status)) return false;

    if (task.retryTimer) {
      clearTimeout(task.retryTimer);
      task.retryTimer = null;
    }

    if (task.status === "queued") {
      this.queue.remove((candidate) => candidate.id === task.id);
      this.#markCancelled(task, "Cancelled before start");
      this.#emitState();
      return true;
    }

    if (task.status === "running") {
      task.cancelRequested = true;
      task.abortController?.abort();
      this.#emitState();
      return true;
    }

    return false;
  }

  #findTask(taskId) {
    return this.tasks.find((task) => task.id === taskId) ?? null;
  }

  #markCancelled(task, reason = "Cancelled") {
    task.status = "cancelled";
    task.cancelRequested = true;
    task.failReason = reason;
    task.finishedAt = Date.now();
    task.updatedAt = task.finishedAt;
    task.nextRunAt = 0;
    task.progress = 0;
  }

  #drainQueue() {
    if (this.isPaused) return;

    while (!this.isPaused && this.runningCount < this.maxConcurrency) {
      const task = this.queue.dequeue();
      if (!task) break;

      if (task.status !== "queued") {
        continue;
      }

      this.#runTask(task);
    }

    this.#emitState();
  }

  async #runTask(task) {
    this.runningCount += 1;
    task.status = "running";
    task.startedAt ??= Date.now();
    task.updatedAt = Date.now();
    task.nextRunAt = 0;
    task.cancelRequested = false;
    task.progress = 10;

    const controller = new AbortController();
    task.abortController = controller;
    this.#emitState();

    try {
      await this.#runWithTimeout(task, controller.signal);
      task.progress = 100;
      task.status = "completed";
      task.finishedAt = Date.now();
      task.updatedAt = task.finishedAt;
      task.failReason = "";
    } catch (error) {
      if (task.cancelRequested || controller.signal.aborted || error?.name === "AbortError") {
        this.#markCancelled(task, "Cancelled");
        return;
      }

      const isTransient = error instanceof TransientError || error?.transient === true;
      const isPermanent = error instanceof PermanentError || error?.transient === false;

      if (isTransient && task.retries < task.maxRetries) {
        task.retries += 1;
        task.status = "queued";
        task.failReason = error?.message ?? "Transient error";
        task.updatedAt = Date.now();
        task.nextRunAt = Date.now() + this.#getRetryDelay(task.retries, task.retryDelayMs);
        task.progress = 0;
        this.#scheduleRetry(task);
        return;
      }

      task.status = "failed";
      task.finishedAt = Date.now();
      task.updatedAt = task.finishedAt;
      task.failReason = error?.message ?? (isPermanent ? "Permanent error" : "Task failed");
      task.progress = 0;
    } finally {
      task.abortController = null;
      this.runningCount = Math.max(0, this.runningCount - 1);
      this.#emitState();

      if (this.isStarted && !this.isPaused) {
        this.#drainQueue();
      }
    }
  }

  getState() {
    return {
      tasks: this.tasks.map((task) => this.#snapshotTask(task)),
      queueSize: this.queue.size(),
      runningCount: this.runningCount,
      started: this.isStarted,
      isPaused: this.isPaused,
      maxConcurrency: this.maxConcurrency,
    };
  }

  #snapshotTask(task) {
    const { run, retryTimer, abortController, ...snapshot } = task;
    return { ...snapshot };
  }

  #getRetryDelay(retries, baseDelay) {
    return baseDelay * 2 ** Math.max(0, retries - 1);
  }

  #scheduleRetry(task) {
    if (task.retryTimer) {
      clearTimeout(task.retryTimer);
    }

    const delay = Math.max(0, task.nextRunAt - Date.now());
    task.retryTimer = setTimeout(() => {
      task.retryTimer = null;

      if (task.status === "cancelled") return;

      this.queue.enqueue(task);
      this.#emitState();

      if (this.isStarted && !this.isPaused) {
        this.#drainQueue();
      }
    }, delay);
  }

  async #runWithTimeout(task, signal) {
    if (typeof task.run !== "function") {
      throw new TypeError("Task is missing a run function");
    }

    const timeoutMs = task.timeoutMs ?? this.taskTimeoutMs;

    const timeoutPromise = new Promise((_, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error(`Task timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      signal.addEventListener(
        "abort",
        () => {
          clearTimeout(timeoutId);
          const abortError = new Error("Task cancelled");
          abortError.name = "AbortError";
          reject(abortError);
        },
        { once: true }
      );
    });

    return Promise.race([
      Promise.resolve().then(() => task.run({ signal, task, attempt: task.retries + 1 })),
      timeoutPromise,
    ]);
  }

  #emitState() {
    this.eventBus.emit("state:changed", this.getState());
  }
}
