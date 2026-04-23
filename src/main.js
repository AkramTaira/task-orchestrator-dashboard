import { Dashboard } from "./ui/dashboard.js";

const orchestrator = {
  getState() {
    return {
      tasks: [],
      queueSize: 0,
      runningCount: 0,
      maxConcurrency: 1,
    };
  },
};

const eventBus = {
  on() {},
};

const dashboard = new Dashboard({ orchestrator, eventBus });
dashboard.mount();
