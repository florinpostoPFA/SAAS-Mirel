const listeners = {};

function on(event, handler) {
  if (!listeners[event]) listeners[event] = [];
  listeners[event].push(handler);
}

function emit(event, payload) {
  if (!listeners[event]) return;
  listeners[event].forEach(fn => fn(payload));
}

module.exports = { on, emit };
