export class EventEmitter<E extends Record<string, any>> {
  private _listeners: {
    [K in keyof E]?: Array<(data: E[K]) => unknown>;
  } = {};

  on<K extends keyof E>(event: K, listener: (data: E[K]) => unknown): this {
    if (!this._listeners[event]) {
      this._listeners[event] = [];
    }
    this._listeners[event]!.push(listener);
    return this;
  }

  off<K extends keyof E>(event: K, listener: (data: E[K]) => unknown): this {
    if (this._listeners[event]) {
      this._listeners[event] = this._listeners[event]!.filter(
        (l) => l !== listener,
      );
    }
    return this;
  }

  fire<K extends keyof E>(event: K, data?: E[K]): void {
    if (this._listeners[event]) {
      const listeners = this._listeners[event]!;
      listeners.forEach((listener) => listener(data as E[K]));
    }
  }
}
