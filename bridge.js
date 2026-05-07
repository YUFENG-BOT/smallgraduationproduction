// Shared bridge + channel helpers
const CHANNELS_KEY = 'td:channels';
const GATHER_BRIDGE_KEY = 'td:gather:incoming';
const gatherChannel = ('BroadcastChannel' in window) ? new BroadcastChannel('td-gather-channel') : null;

function sharedSaveChannels(n) {
  try { localStorage.setItem(CHANNELS_KEY, String(n)); } catch (_) {}
  if (gatherChannel) gatherChannel.postMessage({ type: 'channels', value: n });
  try { localStorage.setItem('td:channels:latest', JSON.stringify({ value: n, ts: Date.now() })); } catch (_) {}
}

function sharedLoadChannels(defaultValue = 5) {
  try {
    const v = localStorage.getItem(CHANNELS_KEY);
    if (v) return Math.max(1, Math.min(5, Number(v)));
  } catch (_) {}
  return defaultValue;
}

// small util for creating a logger tied to an element
function makeLogger(elementId) {
  return function (message, isError = false) {
    const el = document.getElementById(elementId);
    if (!el) return;
    const time = new Date().toLocaleTimeString();
    el.textContent = `[${time}] ${message}`;
    el.classList.toggle('err', !!isError);
  };
}
