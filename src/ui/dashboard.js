export class Dashboard {
  constructor({ orchestrator, eventBus }) {
    this.orchestrator = orchestrator;
    this.eventBus = eventBus;
    this.bound = false;
  }

  mount() {
    this.#bindCancel();
    this.eventBus.on("state:changed", (state) => this.render(state));
    this.render(this.orchestrator.getState());
  }

  #bindCancel() {
    if (this.bound) return;
    this.bound = true;

    document.addEventListener("pointerdown", (event) => {
      const btn = event.target.closest(".cancel-btn");
      if (!btn) return;
      event.preventDefault();
      this.orchestrator.cancelTask(btn.dataset.taskId);
    });
  }

  render(state) {
    const tasks = state.tasks || [];
    const queued = tasks.filter((t) => t.status === "queued");
    const running = tasks.filter((t) => t.status === "running");

    this.renderList("queuedList", queued);
    this.renderList("runningList", running);
  }

  renderList(id, items) {
    const el = document.getElementById(id);
    if (!el) return;

    el.innerHTML = items
      .map(
        (t) => `
          <li>
            <strong>${t.name}</strong>
            <div>Priority: ${t.priority} | Retries: ${t.retries}</div>
            <button type="button" class="cancel-btn" data-task-id="${t.id}">Cancel</button>
          </li>
        `
      )
      .join("");
  }
}
