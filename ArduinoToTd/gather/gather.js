const GATHER_BRIDGE_KEY = "td:gather:incoming";
const GATHER_RECORDS_KEY = "td:gather:records";

const bridgeStatusEl = document.getElementById("bridgeStatus");
const tdStatusEl = document.getElementById("tdStatus");
const tdWsUrlEl = document.getElementById("tdWsUrl");
const toggleTdBtn = document.getElementById("toggleTdBtn");
const sendPendingBtn = document.getElementById("sendPendingBtn");
const clearBtn = document.getElementById("clearBtn");
const statsEl = document.getElementById("stats");
const recordBody = document.getElementById("recordBody");
const logEl = document.getElementById("log");

const gatherChannel = "BroadcastChannel" in window
  ? new BroadcastChannel("td-gather-channel")
  : null;

const CHANNELS_KEY = 'td:channels';
let uiChannels = 5;

function loadUiChannels(){
  try{ const v = localStorage.getItem(CHANNELS_KEY); if(v) uiChannels = Math.max(1, Math.min(5, Number(v))); }catch(_){ }
  document.getElementById('channelsDisplay').textContent = uiChannels;
}

function setUiChannels(n, persist=true){
  uiChannels = Math.max(1, Math.min(5, Number(n)));
  document.getElementById('channelsDisplay').textContent = uiChannels;
  if (persist) try{ localStorage.setItem(CHANNELS_KEY, String(uiChannels)); }catch(_){ }
}

let records = [];
let tdWs = null;
let tdWsEnabled = false;
let tdReconnectDelayMs = 1200;
let tdReconnectTimer = null;
let lastIncomingSignature = "";

function setLog(message, isError = false) {
  const time = new Date().toLocaleTimeString();
  logEl.textContent = `[${time}] ${message}`;
  logEl.classList.toggle("err", isError);
}

function setTdStatus(text, level) {
  tdStatusEl.textContent = `TD WebSocket: ${text}`;
  tdStatusEl.classList.remove("ok", "warn", "err");
  tdStatusEl.classList.add(level);
}

function updateTdButtonLabel() {
  toggleTdBtn.textContent = tdWsEnabled ? "中斷 TD WebSocket" : "連接 TD WebSocket";
}

function saveRecords() {
  try {
    localStorage.setItem(GATHER_RECORDS_KEY, JSON.stringify(records));
  } catch (_) {
  }
}

function loadRecords() {
  try {
    const raw = localStorage.getItem(GATHER_RECORDS_KEY);
    if (!raw) {
      return;
    }

    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      records = parsed;
    }
  } catch (_) {
  }
}

function renderStats() {
  const total = records.length;
  const sent = records.filter((item) => item.sentTd).length;
  const pending = total - sent;
  statsEl.textContent = `總筆數: ${total} | 已送 TD: ${sent} | 未送 TD: ${pending}`;
}

function renderTable() {
  recordBody.innerHTML = "";

  for (const item of records.slice().reverse()) {
    const tr = document.createElement("tr");
    const time = new Date(item.ts).toLocaleString();
    tr.innerHTML = `
      <td>${time}</td>
      <td>${item.id}</td>
      <td>${item.value}</td>
      <td>${item.source || "index"}</td>
      <td>${item.sentTd ? "已送出" : "待送出"}</td>
    `;
    recordBody.appendChild(tr);
  }
}

function rerender() {
  renderStats();
  renderTable();
  saveRecords();
}

function markAsSent(signatureSet) {
  let changed = false;
  for (const item of records) {
    const signature = `${item.id}|${item.value}|${item.ts}`;
    if (!item.sentTd && signatureSet.has(signature)) {
      item.sentTd = true;
      changed = true;
    }
  }

  if (changed) {
    rerender();
  }
}

function sendPendingToTd() {
  if (!tdWs || tdWs.readyState !== WebSocket.OPEN) {
    return;
  }

  const pending = records.filter((item) => !item.sentTd);
  if (pending.length === 0) {
    return;
  }

  const sentSignatures = new Set();

  for (const item of pending) {
    const payload = { id: item.id, value: item.value };
    tdWs.send(JSON.stringify(payload));
    sentSignatures.add(`${item.id}|${item.value}|${item.ts}`);
  }

  markAsSent(sentSignatures);
  setLog(`已轉送 ${pending.length} 筆資料到 TD WebSocket`);
}

function scheduleTdReconnect() {
  if (!tdWsEnabled || tdReconnectTimer) {
    return;
  }

  setTdStatus(`斷線，${Math.round(tdReconnectDelayMs / 1000)} 秒後重連`, "warn");
  tdReconnectTimer = setTimeout(() => {
    tdReconnectTimer = null;
    connectTdWebSocket();
  }, tdReconnectDelayMs);

  tdReconnectDelayMs = Math.min(tdReconnectDelayMs * 1.6, 10000);
}

function connectTdWebSocket() {
  if (!tdWsEnabled) {
    return;
  }

  const wsUrl = tdWsUrlEl.value.trim();
  if (!wsUrl) {
    setLog("TD WebSocket URL 不可為空", true);
    return;
  }

  setTdStatus("連線中...", "warn");

  try {
    tdWs = new WebSocket(wsUrl);
  } catch (error) {
    setLog(`TD WebSocket 建立失敗: ${error.message}`, true);
    scheduleTdReconnect();
    return;
  }

  tdWs.addEventListener("open", () => {
    tdReconnectDelayMs = 1200;
    setTdStatus("已連線", "ok");
    setLog("TD WebSocket 已連線");
    sendPendingToTd();
  });

  tdWs.addEventListener("close", () => {
    if (!tdWsEnabled) {
      setTdStatus("手動中斷", "warn");
      setLog("TD WebSocket 已手動中斷");
      return;
    }

    setTdStatus("已斷線", "err");
    setLog("TD WebSocket 已斷線，準備重連", true);
    scheduleTdReconnect();
  });

  tdWs.addEventListener("error", () => {
    setTdStatus("錯誤", "err");
  });
}

function disconnectTdWebSocket() {
  if (tdReconnectTimer) {
    clearTimeout(tdReconnectTimer);
    tdReconnectTimer = null;
  }

  if (tdWs) {
    tdWs.close();
    tdWs = null;
  }
}

function toggleTdWebSocket() {
  tdWsEnabled = !tdWsEnabled;
  updateTdButtonLabel();

  if (tdWsEnabled) {
    setLog("手動啟用 TD WebSocket，正在連線");
    connectTdWebSocket();
  } else {
    disconnectTdWebSocket();
  }
}

function appendIncomingRecord(payload) {
  if (!payload || payload.value === undefined || payload.value === null) {
    return;
  }

  const id = payload.id || "A";
  const value = String(payload.value).trim();
  const ts = Number(payload.ts) || Date.now();
  const source = payload.source || "index";

  if (!value) {
    return;
  }

  const signature = `${id}|${value}|${ts}`;
  if (signature === lastIncomingSignature) {
    return;
  }
  lastIncomingSignature = signature;

  records.push({
    id,
    value,
    ts,
    source,
    sentTd: false
  });

  rerender();
  setLog(`收到資料: ${JSON.stringify({ id, value, ts, source })}`);

  if (tdWs && tdWs.readyState === WebSocket.OPEN) {
    sendPendingToTd();
  }
}

function handleStorageEvent(event) {
  if (event.key !== GATHER_BRIDGE_KEY || !event.newValue) {
    return;
  }

  try {
    const payload = JSON.parse(event.newValue);
    appendIncomingRecord(payload);
  } catch (_) {
  }
}

function clearAllRecords() {
  records = [];
  rerender();
  setLog("已清空收集資料");
}

if (gatherChannel) {
  gatherChannel.addEventListener("message", (event) => {
    // channel config messages handled separately
    if (event.data && event.data.type === 'channels') {
      setUiChannels(event.data.value, false);
      setLog(`接收 channel 設定: ${event.data.value}`);
      return;
    }

    appendIncomingRecord(event.data);
  });
  bridgeStatusEl.textContent = "Bridge: BroadcastChannel + Storage 監聽中";
} else {
  bridgeStatusEl.textContent = "Bridge: Storage 監聽中";
  bridgeStatusEl.classList.remove("ok");
  bridgeStatusEl.classList.add("warn");
}

// listen for storage bridge payloads
window.addEventListener("storage", handleStorageEvent);

// listen for channel config changes pushed to storage
window.addEventListener('storage', (e)=>{
  if (e.key === 'td:channels' && e.newValue) {
    setUiChannels(Number(e.newValue), false);
    setLog(`Storage channel 設定變更: ${e.newValue}`);
  }
});

toggleTdBtn.addEventListener("click", toggleTdWebSocket);
sendPendingBtn.addEventListener("click", sendPendingToTd);
clearBtn.addEventListener("click", clearAllRecords);

// channel buttons (A=1 channel, B=2 channels, ..., E=5 channels)
function wireChannelButtons(){
  document.getElementById('chA').addEventListener('click', ()=>setUiChannels(1));
  document.getElementById('chB').addEventListener('click', ()=>setUiChannels(2));
  document.getElementById('chC').addEventListener('click', ()=>setUiChannels(3));
  document.getElementById('chD').addEventListener('click', ()=>setUiChannels(4));
  document.getElementById('chE').addEventListener('click', ()=>setUiChannels(5));
}

wireChannelButtons();

loadRecords();
rerender();
updateTdButtonLabel();
loadUiChannels();
setLog("Gather 已啟動，等待 index 輸入");
