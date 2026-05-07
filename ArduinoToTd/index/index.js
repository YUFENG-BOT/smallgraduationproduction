const WS_URL = "ws://localhost:8080";
const BAUD_RATE = 9600;
const GATHER_BRIDGE_KEY = "td:gather:incoming";
const gatherChannel = "BroadcastChannel" in window
  ? new BroadcastChannel("td-gather-channel")
  : null;
const CHANNELS_KEY = 'td:channels';

const connectSerialBtn = document.getElementById("connectSerialBtn");
const toggleWsBtn = document.getElementById("toggleWsBtn");
const wsStatusEl = document.getElementById("wsStatus");
const currentValueEl = document.getElementById("currentValue");
const logEl = document.getElementById("log");

let ws = null;
let reconnectDelayMs = 1200;
let reconnectTimer = null;
let wsEnabled = true;


const SIGNAL_IDS = ["A","B","C","D","E"];
let lastDisplayedValue = { A:null, B:null, C:null, D:null, E:null };
let lastSentValue = { A:null, B:null, C:null, D:null, E:null };
let activeChannels = sharedLoadChannels();

function renderChannelButtons() {
  const container = document.getElementById('channelsGroup');
  if (!container) return;
  const labels = ['A', 'B', 'C', 'D', 'E'];
  container.innerHTML = '';
  for (let i=1;i<=5;i++){
    const btn = document.createElement('button');
    btn.className = 'btn';
    btn.style.padding = '6px 10px';
    btn.textContent = labels[i-1];
    if (i===activeChannels) btn.style.opacity = '0.85';
    btn.addEventListener('click', ()=>{
      activeChannels = i;
      sharedSaveChannels(activeChannels);
      renderChannelButtons();
      applyChannelDisplay();
    });
    container.appendChild(btn);
  }
}

function applyChannelDisplay(){
  for (let i=0;i<SIGNAL_IDS.length;i++){
    const id = SIGNAL_IDS[i];
    const el = document.getElementById(`val${id}`);
    if (!el) continue;
    el.parentElement.style.display = (i<activeChannels)?'block':'none';
  }
}

const setLog = makeLogger('log');

function setWsStatus(text, level) {
  wsStatusEl.textContent = `WebSocket: ${text}`;
  wsStatusEl.classList.remove("ok", "warn", "err");
  wsStatusEl.classList.add(level);
}

function updateWsButtonLabel() {
  toggleWsBtn.textContent = wsEnabled ? "中斷 WebSocket" : "連接 WebSocket";
}

function scheduleReconnect() {
  if (!wsEnabled) {
    return;
  }

  if (reconnectTimer) {
    return;
  }

  setWsStatus(`斷線，${Math.round(reconnectDelayMs / 1000)} 秒後重連`, "warn");
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectWebSocket();
  }, reconnectDelayMs);

  reconnectDelayMs = Math.min(reconnectDelayMs * 1.6, 10000);
}

function connectWebSocket() {
  if (!wsEnabled) {
    return;
  }

  setWsStatus("連線中...", "warn");

  try {
    ws = new WebSocket(WS_URL);
  } catch (error) {
    setLog(`WebSocket 建立失敗: ${error.message}`, true);
    scheduleReconnect();
    return;
  }

  ws.addEventListener("open", () => {
    reconnectDelayMs = 1200;
    setWsStatus("已連線", "ok");
    setLog("已連線至後端整合 WebSocket 伺服器");

    if (lastDisplayedValue !== null && lastDisplayedValue !== lastSentValue) {
      sendValueIfChanged(lastDisplayedValue);
    }
  });

  ws.addEventListener("close", () => {
    if (!wsEnabled) {
      setWsStatus("手動中斷", "warn");
      setLog("WebSocket 已手動中斷");
      return;
    }

    setWsStatus("已斷線", "err");
    setLog("WebSocket 已中斷，準備自動重連", true);
    scheduleReconnect();
  });

  ws.addEventListener("error", () => {
    setWsStatus("錯誤", "err");
  });
}

function disconnectWebSocket() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  if (ws) {
    ws.close();
    ws = null;
  }
}

function toggleWebSocket() {
  wsEnabled = !wsEnabled;
  updateWsButtonLabel();

  if (wsEnabled) {
    setLog("手動啟用 WebSocket，正在連線");
    connectWebSocket();
  } else {
    disconnectWebSocket();
  }
}

function sendValueIfChanged(id, value) {
  if (value === null || value === undefined || value === "") {
    return;
  }

  if (value === lastSentValue[id]) {
    return;
  }

  if (!ws || ws.readyState !== WebSocket.OPEN) {
    return;
  }

  const payload = { id, value };
  ws.send(JSON.stringify(payload));
  lastSentValue[id] = value;
  setLog(`已送出: ${JSON.stringify(payload)}`);
}

function pushValueToGather(id, value) {
  const payload = {
    id,
    value,
    source: "index",
    ts: Date.now()
  };

  if (gatherChannel) {
    gatherChannel.postMessage(payload);
  }

  try {
    localStorage.setItem(GATHER_BRIDGE_KEY, JSON.stringify(payload));
  } catch (_) {
  }
}

function updateValue(rawValue) {
  const line = String(rawValue).trim();
  if (!line) return;

  // 支援逗號分隔五個值，或單一值（對應 A）
  let parts = line.split(/\s*,\s*/);

  if (parts.length === 1) {
    // single value -> assign to A
    parts = [parts[0]];
  }

  // 更新最多五個
  for (let i=0; i<Math.min(parts.length, SIGNAL_IDS.length); i++) {
    const id = SIGNAL_IDS[i];
    const value = String(parts[i]).trim();
    if (!value) continue;

    if (value === lastDisplayedValue[id]) continue;

    lastDisplayedValue[id] = value;
    const el = document.getElementById(`val${id}`);
    if (el) el.textContent = value;

    pushValueToGather(id, value);
    sendValueIfChanged(id, value);
  }
}

toggleWsBtn.addEventListener("click", toggleWebSocket);

loadChannels();
renderChannelButtons();
applyChannelDisplay();

updateWsButtonLabel();
connectWebSocket();
