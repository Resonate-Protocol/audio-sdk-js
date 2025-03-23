export class EventEmitter {
  _listeners: { [key: string]: Function[] } = {};

  on(event: string, listener: Function) {
    if (!this._listeners[event]) {
      this._listeners[event] = [];
    }
    this._listeners[event].push(listener);
  }

  fire(event: string, ...args: any[]) {
    if (this._listeners[event]) {
      this._listeners[event].forEach((listener) => listener(...args));
    }
  }
}
