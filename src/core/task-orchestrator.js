import { PermanentError, TransientError } from "./errors.js";

export class TaskOrchestrator {
  constructor({
    eventBus,
    queue,
    persistence = null,
    persistDebounceMs = 200,
    maxConcurrency = 2,
    maxSupportedConcurrency = 5,
    taskTimeoutMs = 5000,
    retryDelayMs = 500,
    maxRetries = 3,
    priorityAgingIntervalMs = 3000,
    priorityAgingStep = 1,
    priorityAgingMaxBoost = 12,
    now = () => Date.now(),
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  }) {
    this.eventBus = eventBus;
    this.queue = queue;
    this.persistence = persistence;
    this.persistDebounceMs = persistDebounceMs;
    this.maxConcurrency = Math.min(maxSupportedConcurrency, Math.max(1, Number(maxConcurrency) || 1));
    this.maxSupportedConcurrency = maxSupportedConcurrency;
    this.taskTimeoutMs = taskTimeoutMs;
    this.retryDelayMs = retryDelayMs ?? 500;
    this.maxRetries = maxRetries;
    this.priorityAgingIntervalMs = priorityAgingIntervalMs;
    this.priorityAgingStep = priorityAgingStep;
    this.priorityAgingMaxBoost = priorityAgingMaxBoost;
    this.now = now;
    this.sleep = sleep;
    this.tasks = [];
    this.runningCount = 0;
    this.isStarted = false;
    this.isPaused = false;

    this.auditLog = [];
    this.maxAuditEntries = 300;
    this._idCounter = 0;
    this._idleResolvers = [];

    this._hydrated = false;
    this._hydratePromise = this.#hydrateFromPersistence();
    this._persistTimer = null;
  }

  seedMockTasks(count = 5) {
    for (let i = 1; i <= count; i += 1) {
      const taskPriority = Math.ceil(Math.random() * 10);
      const task = {
        id: `T-${this.now()}-${i}-${Math.random().toString(16).slice(2, 6)}`,
        name: `Task ${this.tasks.length + 1}`,
        priority: taskPriority,
        basePriority: taskPriority,
        status: "queued",
        retries: 0,
        progress: 0,
        nextRunAt: null,
        failReason: null,
        timeoutMs: this.taskTimeoutMs,
        cancelRequested: false,
        abortController: null,
        retryTimer: null,
        createdAt: this.now(),
        enqueuedAt: this.now(),
        startedAt: null,
        finishedAt: null,
        run: this.#createMockRun(),
        retryDelayMs: this.retryDelayMs,
      };

      this.tasks.push(task);
      this.queue.enqueue(task);
      this.#appendAudit("task:queued", { taskId: task.id, priority: task.priority });
    }

    this.#emitState();

    if (this.isStarted && !this.isPaused) {
      this.#drainQueue();
    }
  }

  setMaxConcurrency(nextValue) {
    const normalized = Math.min(this.maxSupportedConcurrency, Math.max(1, Number(nextValue) || 1));
    this.maxConcurrency = normalized;
    this.#appendAudit("orchestrator:concurrency-updated", {
      maxConcurrency: this.maxConcurrency,
    });
    this.#emitState();

    if (this.isStarted && !this.isPaused) {
      this.#drainQueue();
    }

    return this.maxConcurrency;
  }

  enqueue(taskInput) {
    const now = this.now();
    const task = {
      id: taskInput.id ?? `task-${++this._idCounter}`,
      name: taskInput.name ?? `Task ${this.tasks.length + 1}`,
      priority: taskInput.priority ?? 1,
      basePriority: taskInput.priority ?? 1,
      status: "queued",
      retries: taskInput.retries ?? 0,
      progress: taskInput.progress ?? 0,
      nextRunAt: taskInput.nextRunAt ?? null,
      failReason: taskInput.failReason ?? null,
      timeoutMs: taskInput.timeoutMs ?? this.taskTimeoutMs,
      cancelRequested: Boolean(taskInput.cancelRequested),
      abortController: null,
      retryTimer: null,
      createdAt: taskInput.createdAt ?? now,
      enqueuedAt: taskInput.enqueuedAt ?? now,
      startedAt: taskInput.startedAt ?? null,
      finishedAt: taskInput.finishedAt ?? null,
      run: taskInput.run,
      retryDelayMs: taskInput.retryDelayMs ?? this.retryDelayMs,
    };

    this.tasks.push(task);
    this.queue.enqueue(task);
  this.#appendAudit("task:queued", { taskId: task.id, priority: task.priority });
    this.#emitState();

    if (this.isStarted && !this.isPaused) {
      this.#drainQueue();
    }

    return task.id;
  }

  async start() {
    await this._hydratePromise;
    this.isStarted = true;
    this.isPaused = false;
    this.#appendAudit("orchestrator:started", {});
    this.#emitState();
    this.#drainQueue();

    return new Promise((resolve) => {
      this._idleResolvers.push(resolve);
      this.#resolveIdleIfNeeded();
    });
  }

  pause() {
    this.isStarted = true;
    this.isPaused = true;
    this.#appendAudit("orchestrator:paused", {});
    this.#emitState();
  }

  resume() {
    this.isStarted = true;
    this.isPaused = false;
    this.#appendAudit("orchestrator:resumed", {});
    this.#emitState();
    if (this.isStarted) this.#drainQueue();
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
      this.#appendAudit("task:cancelled", { taskId });
      this.#emitState();
      this.#resolveIdleIfNeeded();
      return true;
    }

    if (task.status === "running") {
      task.cancelRequested = true;
      task.abortController?.abort();
      this.#appendAudit("task:cancellation-requested", { taskId });
      this.#emitState();
      return true;
    }

    return false;
  }

  getAuditLog() {
    return [...this.auditLog];
  }

  #findTask(taskId) {
    return this.tasks.find((task) => task.id === taskId) ?? null;
  }

  #markCancelled(task, reason = "Cancelled") {
    task.status = "cancelled";
    task.cancelRequested = true;
    task.failReason = reason;
    task.finishedAt = this.now();
    task.updatedAt = task.finishedAt;
    task.nextRunAt = 0;
    task.progress = 0;
  }

  #drainQueue() {
    if (!this.isStarted || this.isPaused) {
      this.#emitState();
      return;
    }

    this.#applyPriorityAging();

    while (!this.isPaused && this.runningCount < this.maxConcurrency) {
      const task = this.queue.dequeue();
      if (!task) break;

      if (task.status !== "queued") {
        continue;
      }

      this.#runTask(task);
    }

    this.#emitState();
    this.#resolveIdleIfNeeded();
  }

  async #runTask(task) {
    this.runningCount += 1;
    task.status = "running";
    task.startedAt ??= this.now();
    task.updatedAt = this.now();
    task.nextRunAt = 0;
    task.cancelRequested = false;
    task.progress = 10;

    const controller = new AbortController();
    task.abortController = controller;
    this.#appendAudit("task:running", { taskId: task.id, attempt: task.retries + 1 });
    this.#emitState();

    try {
      const runFn = typeof task.run === "function" ? task.run : this.#createMockRun();
      await this.#runWithTimeout(
        runFn({ task, signal: controller.signal, orchestrator: this }),
        task.timeoutMs,
        controller
      );
      task.progress = 100;
      task.status = "completed";
      task.finishedAt = this.now();
      task.updatedAt = task.finishedAt;
      task.failReason = "";
    } catch (error) {
      if (task.cancelRequested || controller.signal.aborted || error?.name === "AbortError") {
        this.#markCancelled(task, "Cancelled");
        this.#appendAudit("task:cancelled", { taskId: task.id });
        return;
      }

      const isTransient = error instanceof TransientError || error?.transient === true;
      const isPermanent = error instanceof PermanentError || error?.transient === false;

      if (isTransient && task.retries < this.maxRetries) {
        task.retries += 1;
        task.status = "queued";
        task.priority = task.basePriority ?? task.priority;
        task.failReason = error?.message ?? "Transient error";
        task.updatedAt = this.now();
        task.enqueuedAt = this.now();
        task.nextRunAt = this.now() + this.#getRetryDelay(task.retries, task.retryDelayMs ?? this.retryDelayMs);
        task.progress = 0;
        this.#appendAudit("task:retry-scheduled", {
          taskId: task.id,
          retries: task.retries,
          delay: task.nextRunAt - this.now(),
          reason: task.failReason,
        });
        this.#scheduleRetry(task);
        return;
      }

      task.status = "failed";
      task.finishedAt = this.now();
      task.updatedAt = task.finishedAt;
      task.failReason = error?.message ?? (isPermanent ? "Permanent error" : "Task failed");
      task.progress = 0;
      this.#appendAudit("task:failed", { taskId: task.id, reason: task.failReason });
    } finally {
      task.abortController = null;
      this.runningCount = Math.max(0, this.runningCount - 1);
      this.#emitState();

      if (this.isStarted && !this.isPaused) {
        this.#drainQueue();
      }
    }
  }

  #runWithTimeout(promise, timeoutMs, abortController) {
    const taskPromise = Promise.resolve(promise);
    taskPromise.catch(() => {});

    let timeoutId;
    const racers = [taskPromise];

    if (timeoutMs && timeoutMs > 0) {
      racers.push(
        new Promise((_, reject) => {
          timeoutId = setTimeout(() => {
            abortController?.abort("timeout");
            reject(new TransientError("timeout", { code: "ETIMEDOUT" }));
          }, timeoutMs);
        })
      );
    }

    if (abortController?.signal) {
      racers.push(
        new Promise((_, reject) => {
          const onAbort = () => reject(new Error("cancelled-by-user"));

          if (abortController.signal.aborted) {
            onAbort();
            return;
          }

          abortController.signal.addEventListener("abort", onAbort, { once: true });
        })
      );
    }

    return Promise.race(racers).finally(() => {
      if (timeoutId) clearTimeout(timeoutId);
    });
  }

  getState() {
    return {
      tasks: this.tasks.map((task) => this.#snapshotTask(task)),
      queueSize: this.queue.size(),
      runningCount: this.runningCount,
      started: this.isStarted,
      isPaused: this.isPaused,
      maxConcurrency: this.maxConcurrency,
      maxSupportedConcurrency: this.maxSupportedConcurrency,
      maxRetries: this.maxRetries,
      auditLog: this.getAuditLog(),
    };
  }

  #appendAudit(type, payload) {
    const entry = {
      at: this.now(),
      type,
      ...payload,
    };

    this.auditLog.push(entry);
    if (this.auditLog.length > this.maxAuditEntries) this.auditLog.shift();

    this.eventBus.emit("audit:append", entry);
  }

  #resolveIdleIfNeeded() {
    if (!this.isStarted) return;

    const hasPendingQueued = this.tasks.some((task) => task.status === "queued" && !task.cancelRequested);
    const idle = this.runningCount === 0 && this.queue.isEmpty() && !hasPendingQueued;

    if (idle && this._idleResolvers.length > 0) {
      const resolvers = [...this._idleResolvers];
      this._idleResolvers = [];
      resolvers.forEach((resolve) => resolve(this.getState()));
    }
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

    const delay = Math.max(0, task.nextRunAt - this.now());
    task.retryTimer = setTimeout(() => {
      task.retryTimer = null;

      if (task.status === "cancelled") return;

      this.queue.enqueue(task);
      this.#appendAudit("task:requeued", { taskId: task.id, retries: task.retries });
      this.#emitState();

      if (this.isStarted && !this.isPaused) {
        this.#drainQueue();
      }
    }, delay);
  }

  #applyPriorityAging() {
    if (this.queue.isEmpty() || this.priorityAgingIntervalMs <= 0) return;

    const queuedItems = this.queue.values();
    const now = this.now();

    for (const task of queuedItems) {
      if (task.status !== "queued") continue;

      const basePriority = task.basePriority ?? task.priority ?? 1;
      const enqueuedAt = task.enqueuedAt ?? task.createdAt ?? now;
      const waitedMs = Math.max(0, now - enqueuedAt);
      const steps = Math.floor(waitedMs / this.priorityAgingIntervalMs);
      const boost = Math.min(this.priorityAgingMaxBoost, steps * this.priorityAgingStep);

      task.priority = basePriority + boost;
    }

    this.queue.rebuild(queuedItems);
  }

  async #hydrateFromPersistence() {
    if (!this.persistence || typeof this.persistence.loadState !== "function") {
      this._hydrated = true;
      return;
    }

    try {
      const snapshot = await this.persistence.loadState();
      if (!snapshot || !Array.isArray(snapshot.tasks)) {
        this._hydrated = true;
        return;
      }

      if (typeof snapshot.maxConcurrency === "number") {
        this.maxConcurrency = Math.min(
          this.maxSupportedConcurrency,
          Math.max(1, Number(snapshot.maxConcurrency) || 1)
        );
      }

      if (typeof snapshot.idCounter === "number") {
        this._idCounter = snapshot.idCounter;
      }

      this.tasks = snapshot.tasks.map((raw) => ({
        ...raw,
        status: raw.status === "running" ? "queued" : raw.status,
        abortController: null,
        retryTimer: null,
        retryDelayMs: raw.retryDelayMs ?? this.retryDelayMs,
        run: this.#createMockRun(),
      }));

      this.queue.clear();
      for (const task of this.tasks) {
        if (task.status === "queued" && !task.cancelRequested) {
          this.queue.enqueue(task);
        }
      }

      this.#appendAudit("persistence:hydrated", { tasks: this.tasks.length });
    } finally {
      this._hydrated = true;
      this.#emitState();
    }
  }

  #schedulePersist() {
    if (!this.persistence || typeof this.persistence.saveState !== "function") return;
    if (!this._hydrated) return;

    if (this._persistTimer) clearTimeout(this._persistTimer);
    this._persistTimer = setTimeout(() => {
      this._persistTimer = null;
      this.#persistNow();
    }, this.persistDebounceMs);
  }

  async #persistNow() {
    if (!this.persistence || typeof this.persistence.saveState !== "function") return;

    await this.persistence.saveState({
      idCounter: this._idCounter,
      tasks: this.tasks.map((task) => ({
        id: task.id,
        name: task.name,
        priority: task.priority,
        basePriority: task.basePriority,
        status: task.status,
        retries: task.retries,
        progress: task.progress,
        nextRunAt: task.nextRunAt,
        failReason: task.failReason,
        timeoutMs: task.timeoutMs,
        cancelRequested: task.cancelRequested,
        createdAt: task.createdAt,
        enqueuedAt: task.enqueuedAt,
        startedAt: task.startedAt,
        finishedAt: task.finishedAt,
        retryDelayMs: task.retryDelayMs,
      })),
      queueSize: this.queue.size(),
      runningCount: this.runningCount,
      maxConcurrency: this.maxConcurrency,
      maxSupportedConcurrency: this.maxSupportedConcurrency,
      isPaused: this.isPaused,
    });
  }

  #createMockRun() {
    return async ({ task, signal }) => {
      const total = 1000 + Math.random() * 2000;
      const tick = 100;
      const steps = Math.ceil(total / tick);

      for (let i = 1; i <= steps; i += 1) {
        if (task.cancelRequested || signal?.aborted) {
          throw new Error("cancelled-by-user");
        }

        await this.sleep(tick);
        task.progress = Math.min(100, Math.round((i / steps) * 100));
        this.#emitState();
      }

      if (Math.random() < 0.3) {
        throw new TransientError("transient-error", { code: "ETIMEDOUT" });
      }
    };
  }

  #emitState() {
    this.eventBus.emit("state:changed", this.getState());
    this.#schedulePersist();
  }
}
