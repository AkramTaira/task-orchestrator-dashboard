export class Dashboard {
  constructor({ orchestrator, eventBus }) {
    this.orchestrator = orchestrator;
    this.eventBus = eventBus;
  }

  mount() {
    this.eventBus.on("state:changed", (state) => this.render(state));
    this.render(this.orchestrator.getState());
  }

  render(state) {
    const tasks = state.tasks || [];
    const queued = tasks.filter((t) => t.status === "queued");
    const running = tasks.filter((t) => t.status === "running");

    this.setText("queuedCount", queued.length);
    this.setText("runningCount", running.length);
    this.setText("completedCount", tasks.filter((t) => t.status === "completed").length);
    this.setText("totalCount", tasks.length);

    this.renderWorkers(state, running);
  }

  renderWorkers(state, runningTasks) {
    const container = document.getElementById("workersList");
    if (!container) return;

    let html = `<p>Max Workers: <strong>${state.maxConcurrency || 1}</strong></p>`;

    for (let i = 0; i < (state.maxConcurrency || 1); i += 1) {
      const task = runningTasks[i];
      html += task
        ? `<div class="worker"><strong>Worker #${i + 1}</strong>: ${task.name}</div>`
        : `<div class="worker"><strong>Worker #${i + 1}</strong>: idle</div>`;
    }

    container.innerHTML = html;
  }

  setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = String(value);
  }
}
