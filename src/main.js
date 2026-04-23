import { EventBus } from "./core/event-bus.js";
import { Dashboard } from "./ui/dashboard.js";

const eventBus = new EventBus();

const orchestrator = {
  state: {
    tasks: [],
    queueSize: 0,
    runningCount: 0,
    maxConcurrency: 1,
  },
  getState() {
    return this.state;
  },
};

const dashboard = new Dashboard({ orchestrator, eventBus });
dashboard.mount();

eventBus.on("state:changed", (state) => dashboard.render(state));

setInterval(() => {
  orchestrator.state.queueSize += 1;
  eventBus.emit("state:changed", orchestrator.getState());
}, 2000);
