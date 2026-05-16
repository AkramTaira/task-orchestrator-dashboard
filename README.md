# Task Orchestrator Dashboard

A clean, learning-focused JavaScript project that simulates a real task orchestration engine with a live monitoring dashboard.

This project is built with vanilla JavaScript (no framework) to make the core concepts visible and easy to study.

## What This Project Does

The app manages tasks from creation to completion using a queue and an orchestrator.

Each task can:

- have a priority
- be queued, running, completed, failed, or cancelled
- retry after transient failures using exponential backoff
- be cancelled while queued or running

The dashboard displays:

- current system metrics
- worker activity
- active queued/running tasks
- compact history of finished tasks
- an audit log of orchestrator events

## Why This Project Matters

This is not just a UI exercise. It demonstrates key backend-like runtime concepts inside a frontend learning project:

- scheduling and prioritization
- bounded concurrency (worker pool behavior)
- timeout and cancellation handling
- transient vs permanent failure handling
- fairness via priority aging
- state persistence and hydration
- observability through live dashboard state

## Architecture Summary

The project follows a clear separation of concerns:

- core runtime logic in `src/core`
- rendering and user interaction in `src/ui`
- application wiring in `src/main.js`
- HTML shell and styles in `index.html` and `styles/main.css`

Data flow:

1. UI triggers actions (seed, start, pause, resume, cancel, workers count)
2. Orchestrator updates internal state and queue
3. Event bus emits `state:changed`
4. Dashboard re-renders from latest state
5. Persistence support exists in the codebase and can be wired to store state snapshots

## File-by-File Guide

### Application Shell

- `index.html`

  - Defines page layout and static sections.
  - Contains action controls, worker selector, metrics, active task lists, and task history.
- `styles/main.css`

  - Handles visual design, spacing, responsiveness, and list compactness.
  - Keeps UI readable when many tasks exist.

### App Bootstrap

- `src/main.js`
  - Creates and connects all building blocks.
  - Instantiates event bus, queue, persistence store, orchestrator, and dashboard.
  - Wires DOM events to orchestrator commands.

### Core Runtime

- `src/core/task-orchestrator.js`

  - Main runtime engine.
  - Responsible for queue draining, max concurrency, retries, timeout handling, cancellation, pause/resume, fairness aging, persistence hydration/saving, and state emissions.
- `src/core/priority-queue.js`

  - Binary heap priority queue implementation.
  - Supports `enqueue`, `dequeue`, `peek`, `rebuild`, and helper methods.
- `src/core/indexeddb-task-store.js`

  - IndexedDB persistence layer.
  - Saves and loads orchestrator snapshots.
  - Present in the codebase, but not wired into the current browser bootstrap.
- `src/core/event-bus.js`

  - Minimal pub/sub utility.
  - Broadcasts state updates from runtime to UI.
- `src/core/errors.js`

  - Error taxonomy helpers.
  - `TransientError` supports retry behavior.
  - `PermanentError` represents non-retryable failures.

### UI Layer

- `src/ui/dashboard.js`
  - Reads orchestrator state and renders all dashboard sections.
  - Handles cancel action delegation.
  - Builds ordered history rows and worker cards.

### Tests

- `src/core/__tests__/priority-queue.test.js`

  - Verifies queue ordering and heap rebuild behavior.
- `src/core/__tests__/task-orchestrator.test.js`

  - Verifies runtime behavior end-to-end at unit level:
    - execution
    - retries
    - permanent failure behavior
    - queued/running cancellation
    - persistence hydration
    - priority aging fairness

### Project Metadata

- `package.json`

  - Holds test scripts and test dependency (`vitest`).
  - Not required to simply open `index.html`, but required to run tests.
- `.gitignore`

  - Excludes dependency and local build artifacts from version control.

## Task Lifecycle

A task generally moves through these states:

- `queued` -> `running` -> `completed`
- `queued` -> `running` -> `failed`
- `queued` -> `cancelled`
- `running` -> `cancelled`
- `running` -> `queued` (retry scheduled) -> `running` again

## Retry and Backoff Strategy

When a transient error happens:

- task retry count increments
- delay is computed as exponential backoff
- task is re-enqueued after delay
- priority is reset to base priority before requeue

This keeps retries controlled and avoids immediate retry storms.

## Fairness (Priority Aging)

Queued tasks gain additional effective priority over time.

This prevents starvation of old low-priority tasks when new high-priority tasks keep arriving.

## Persistence Behavior

The runtime includes persistence hooks and an IndexedDB adapter in the codebase.

On startup:

- saved state is loaded
- tasks are reconstructed
- previously running tasks are normalized to queued
- queue is rebuilt

In the current browser bootstrap, that adapter is present but not connected, so persistence is available in code but not active at runtime.

This allows continuity after refresh during local experiments.

## Running the Project

For basic usage:

1. Open `index.html` directly in a browser.
2. Click `Add Tasks`.
3. Click `Start`.
4. Optionally pause/resume, change workers, and cancel tasks.

## Running Tests (Optional)

If you want automated verification:

1. Install Node.js + npm.
2. Run:

```bash
npm install
npm run test
```

## Current Quality Status

- Architecture is clean and modular.
- Core behavior is covered with focused unit tests.
- UI is responsive and simplified for readability.
- No current editor diagnostics in core project files.

## Known Boundaries

- This is a learning-focused runtime, not a distributed production scheduler.
- Test execution requires Node/npm in local environment.
- Persistence snapshot size is suitable for learning/demo scale.

## Suggested Next Steps

- Add screenshots or a short GIF to showcase runtime behavior.
- Add a small changelog section as you iterate.
- Optionally add CI test workflow for GitHub Actions.
