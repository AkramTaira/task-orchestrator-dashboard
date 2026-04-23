export class Dashboard {
  constructor({ orchestrator, eventBus }) {
    this.orchestrator = orchestrator;
    this.eventBus = eventBus;
  }

  mount() {
    this.render(this.orchestrator.getState());
  }

  render(state) {
    const total = state.tasks?.length ?? 0;
    this.setText("totalCount", total);
    this.setText("queuedCount", state.queueSize ?? 0);
    this.setText("runningCount", state.runningCount ?? 0);
  }

  setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = String(value);
  }
}
