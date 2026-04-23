export class EventBus {
  constructor() {
    this.events = new Map();
  }

  on(eventName, handler) {
    const handlers = this.events.get(eventName) || [];
    handlers.push(handler);
    this.events.set(eventName, handlers);
  }

  emit(eventName, payload) {
    const handlers = this.events.get(eventName) || [];
    for (const handler of handlers) handler(payload);
  }
}
