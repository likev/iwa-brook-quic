export class EventEmitter {
  constructor() {
    this._events = {};
  }
  on(event, listener) {
    if (!this._events[event]) this._events[event] = [];
    this._events[event].push(listener);
    return this;
  }
  once(event, listener) {
    const g = (...args) => {
      this.off(event, g);
      listener.apply(this, args);
    };
    return this.on(event, g);
  }
  off(event, listener) {
    if (!this._events[event]) return this;
    this._events[event] = this._events[event].filter(l => l !== listener);
    return this;
  }
  emit(event, ...args) {
    if (!this._events[event]) return false;
    for (const l of [...this._events[event]]) {
      l.apply(this, args);
    }
    return true;
  }
  listenerCount(event) {
    return this._events[event] ? this._events[event].length : 0;
  }
  rawListeners(event) {
    return this._events[event] ? [...this._events[event]] : [];
  }
  listeners(event) {
    return this._events[event] ? [...this._events[event]] : [];
  }
  addListener(e, l) { return this.on(e, l); }
  removeListener(e, l) { return this.off(e, l); }
  removeAllListeners(e) {
    if (e) delete this._events[e];
    else this._events = {};
    return this;
  }
}
export default EventEmitter;
