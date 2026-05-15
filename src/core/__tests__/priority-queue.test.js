import { describe, expect, it } from "vitest";
import { PriorityQueue } from "../priority-queue.js";

describe("PriorityQueue", () => {
  it("dequeues higher priority items first", () => {
    const queue = new PriorityQueue((a, b) => a.priority - b.priority);

    queue.enqueue({ id: "a", priority: 1 });
    queue.enqueue({ id: "b", priority: 5 });
    queue.enqueue({ id: "c", priority: 3 });

    expect(queue.dequeue().id).toBe("b");
    expect(queue.dequeue().id).toBe("c");
    expect(queue.dequeue().id).toBe("a");
  });

  it("peeks without removing the top item", () => {
    const queue = new PriorityQueue((a, b) => a.priority - b.priority);

    queue.enqueue({ id: "x", priority: 9 });

    expect(queue.peek().id).toBe("x");
    expect(queue.size()).toBe(1);
  });

  it("rebuilds the heap after priorities change", () => {
    const queue = new PriorityQueue((a, b) => a.priority - b.priority);

    const a = { id: "a", priority: 1 };
    const b = { id: "b", priority: 3 };
    const c = { id: "c", priority: 2 };

    queue.enqueue(a);
    queue.enqueue(b);
    queue.enqueue(c);

    a.priority = 10;
    queue.rebuild(queue.values());

    expect(queue.dequeue().id).toBe("a");
  });
});