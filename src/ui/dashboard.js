export class Dashboard {
  constructor({ orchestrator, eventBus }) {
    this.orchestrator = orchestrator;
    this.eventBus = eventBus;
    this._delegationBound = false;
  }

  mount() {
    this.#bindCancelDelegation();
    this.eventBus.on("state:changed", (state) => this.render(state));
    this.render(this.orchestrator.getState());
  }

  #bindCancelDelegation() {
    if (this._delegationBound) return;
    this._delegationBound = true;

    document.addEventListener("pointerdown", (e) => {
      const btn = e.target.closest(".cancel-btn");
      if (!btn) return;
      e.preventDefault();
      this.orchestrator.cancelTask(btn.dataset.taskId);
    });
  }

  render(state) {
    const tasks = state.tasks || [];

    const byStatus = {
      queued: tasks.filter((t) => t.status === "queued"),
      running: tasks.filter((t) => t.status === "running"),
      completed: tasks.filter((t) => t.status === "completed"),
      failed: tasks.filter((t) => t.status === "failed"),
      cancelled: tasks.filter((t) => t.status === "cancelled"),
    };

    this.setText("queuedCount", byStatus.queued.length);
    this.setText("runningCount", byStatus.running.length);
    this.setText("completedCount", byStatus.completed.length);
    this.setText("failedCount", byStatus.failed.length);
    this.setText("cancelledCount", byStatus.cancelled.length);

    const total = tasks.length;
    const completed = byStatus.completed.length;
    const successRate = total === 0 ? 0 : Math.round((completed / total) * 100);
    const queueDepth = state.queueSize ?? 0;

    this.setText("totalCount", total);
    this.setText("successRate", `${successRate}%`);
    this.setText("queueDepth", queueDepth);

    this.renderList("queuedList", byStatus.queued);
    this.renderList("runningList", byStatus.running);

    const history = tasks
      .filter((t) => t.status === "completed" || t.status === "failed" || t.status === "cancelled")
      .sort((a, b) => {
        const bTs = b.finishedAt ?? b.createdAt ?? 0;
        const aTs = a.finishedAt ?? a.createdAt ?? 0;
        return bTs - aTs;
      });

    this.renderHistory("historyList", history);

    this.renderWorkers(state, byStatus.running);
  }

  renderWorkers(state, runningTasks) {
    const container = document.getElementById("workersList");
    if (!container) return;

    const max = state.maxConcurrency || 1;
    const pausedBadge = state.isPaused ? '<span class="badge badge-paused">PAUSED</span>' : "";

    let html = `
      <p>Max Workers: <strong>${max}</strong></p>
      <p>Running Now: <strong>${state.runningCount ?? 0}</strong></p>
      <p>Queue Size: <strong>${state.queueSize ?? 0}</strong></p>
      <p>State: <strong>${state.isPaused ? "Paused" : "Active"}</strong> ${pausedBadge}</p>
      <hr />
    `;

    for (let i = 0; i < max; i++) {
      const task = runningTasks[i];

      if (task) {
        html += `
          <div class="worker">
            <div class="worker-title">
              Worker #${i + 1}
              <span class="badge badge-running">RUNNING</span>
            </div>
            <div><strong>${task.name}</strong></div>
            <div>Priority: ${task.priority} | Retries: ${task.retries}</div>
            <div class="progress"><span style="width:${task.progress}%"></span></div>
            <small>${task.progress}%</small>
          </div>
        `;
      } else {
        html += `
          <div class="worker">
            <div class="worker-title">
              Worker #${i + 1}
              <span class="badge badge-idle">IDLE</span>
            </div>
            <small>No task assigned.</small>
          </div>
        `;
      }
    }

    container.innerHTML = html;
  }

  renderList(elementId, items) {
    const el = document.getElementById(elementId);
    if (!el) return;

    el.innerHTML = items
      .map((t) => {
        const retryInSeconds = t.nextRunAt
          ? Math.max(0, Math.ceil((t.nextRunAt - Date.now()) / 1000))
          : null;

        const nextRunText = retryInSeconds !== null ? ` | Retry In: ${retryInSeconds}s` : "";
        const reasonText = t.failReason ? ` | Reason: ${t.failReason}` : "";
        const canCancel = (t.status === "queued" || t.status === "running") && !t.cancelRequested;
        const isCancelling = t.cancelRequested && t.status === "running";
        const cancelLabel = t.status === "running" ? "Cancel Now" : "Cancel Task";

        return `
          <li>
            <strong>${t.name}</strong>
            <div>Priority: ${t.priority} | Progress: ${t.progress}%${nextRunText}${reasonText}</div>
            ${canCancel ? `<div class="task-actions"><button type="button" class="cancel-btn" data-task-id="${t.id}" aria-label="${cancelLabel} ${t.name}">${cancelLabel}</button></div>` : ""}
            ${isCancelling ? `<div class="task-actions"><button type="button" class="cancel-btn cancel-btn-pending" disabled>Cancelling...</button></div>` : ""}
          </li>
        `;
      })
      .join("");
  }

  renderHistory(elementId, items) {
    const el = document.getElementById(elementId);
    if (!el) return;

    const maxRows = 120;
    const rows = items.slice(0, maxRows);

    el.innerHTML = rows
      .map((t) => {
        const ts = t.finishedAt ?? t.createdAt ?? Date.now();
        const time = new Date(ts).toLocaleTimeString("en-US");
        const statusClass = `status-${t.status}`;
        const reason = t.failReason ? ` | ${t.failReason}` : "";

        return `
          <li class="history-item">
            <span class="history-time">${time}</span>
            <span class="status-badge ${statusClass}">${t.status.toUpperCase()}</span>
            <span class="history-name">${t.name}</span>
            <span class="history-meta">P:${t.priority}${reason}</span>
          </li>
        `;
      })
      .join("");
  }

  setText(id, value) {
    const el = document.getElementById(id);
    if (!el) return;

    el.textContent = String(value);
  }
}
