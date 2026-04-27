export class TaskOrchestrator {
  constructor({ eventBus, queue, maxConcurrency = 2 }) {
    this.eventBus = eventBus;
    this.queue = queue;
    this.maxConcurrency = maxConcurrency;
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
      progress: 0,
      retries: 0,
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
      task.progress = 100;
    } catch {
      task.status = "failed";
    }

    this.runningCount = Math.max(0, this.runningCount - 1);
    this.#emitState();
    this.#drainQueue();
  }

  #emitState() {
    this.eventBus.emit("state:changed", this.getState());
  }
}
