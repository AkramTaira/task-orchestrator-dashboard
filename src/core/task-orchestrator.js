export class TaskOrchestrator {
  constructor({ eventBus, queue }) {
    this.eventBus = eventBus;
    this.queue = queue;
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
      run: taskInput.run,
    };

    this.tasks.push(task);
    this.queue.enqueue(task);
    this.#emitState();
    return task.id;
  }

  async start() {
    this.isStarted = true;

    while (!this.queue.isEmpty()) {
      const task = this.queue.dequeue();
      task.status = "running";
      this.runningCount = 1;
      this.#emitState();

      try {
        await task.run();
        task.status = "completed";
      } catch {
        task.status = "failed";
      }

      this.runningCount = 0;
      this.#emitState();
    }
  }

  getState() {
    return {
      tasks: this.tasks,
      runningCount: this.runningCount,
      queueSize: this.queue.size(),
      isStarted: this.isStarted,
    };
  }

  #emitState() {
    this.eventBus.emit("state:changed", this.getState());
  }
}
