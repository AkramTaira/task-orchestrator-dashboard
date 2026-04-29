export class TransientError extends Error {
  constructor(message, meta = {}) {
    super(message);
    this.name = "TransientError";
    this.transient = true;
    Object.assign(this, meta);
  }
}

export class PermanentError extends Error {
  constructor(message, meta = {}) {
    super(message);
    this.name = "PermanentError";
    this.transient = false;
    Object.assign(this, meta);
  }
}
