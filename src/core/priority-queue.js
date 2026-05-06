export class PriorityQueue {
  constructor(compareFn = (a, b) => a - b) {
    this.compare = compareFn;
    this.heap = [];
  }

  size() {
    return this.heap.length;
  }

  isEmpty() {
    return this.size() === 0;
  }

  clear() {
    this.heap = [];
  }

  peek() {
    return this.heap[0] ?? null;
  }

  values() {
    return [...this.heap];
  }

  rebuild(values = []) {
    this.heap = [...values];
    if (this.heap.length <= 1) return;

    for (let index = Math.floor(this.heap.length / 2) - 1; index >= 0; index -= 1) {
      this.#heapifyDown(index);
    }
  }

  remove(predicate) {
    const nextValues = this.heap.filter((value, index) => !predicate(value, index));
    const removed = nextValues.length !== this.heap.length;

    if (removed) {
      this.rebuild(nextValues);
    }

    return removed;
  }

  enqueue(value) {
    this.heap.push(value);
    this.#heapifyUp(this.heap.length - 1);
  }

  dequeue() {
    if (this.heap.length === 0) return null;
    if (this.heap.length === 1) return this.heap.pop();

    const top = this.heap[0];
    this.heap[0] = this.heap.pop();
    this.#heapifyDown(0);
    return top;
  }

  #parent(i) {
    return Math.floor((i - 1) / 2);
  }

  #left(i) {
    return i * 2 + 1;
  }

  #right(i) {
    return i * 2 + 2;
  }

  #swap(i, j) {
    [this.heap[i], this.heap[j]] = [this.heap[j], this.heap[i]];
  }

  #heapifyUp(index) {
    let i = index;
    while (i > 0) {
      const p = this.#parent(i);
      if (this.compare(this.heap[i], this.heap[p]) <= 0) break;
      this.#swap(i, p);
      i = p;
    }
  }

  #heapifyDown(index) {
    let i = index;

    while (true) {
      const left = this.#left(i);
      const right = this.#right(i);
      let best = i;

      if (left < this.heap.length && this.compare(this.heap[left], this.heap[best]) > 0) {
        best = left;
      }

      if (right < this.heap.length && this.compare(this.heap[right], this.heap[best]) > 0) {
        best = right;
      }

      if (best === i) break;
      this.#swap(i, best);
      i = best;
    }
  }
}
