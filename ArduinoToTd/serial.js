const BAUD_RATE = 9600;
let serialPort = null;
let serialReader = null;

async function readSerialLoop() {
  while (serialPort && serialPort.readable) {
    const textDecoder = new TextDecoderStream();
    const readableStreamClosed = serialPort.readable.pipeTo(textDecoder.writable);
    const reader = textDecoder.readable.getReader();
    serialReader = reader;

    let buffer = "";

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          break;
        }

        buffer += value;

        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (typeof updateValue === 'function') updateValue(line);
        }
      }
    } catch (error) {
      if (typeof setLog === 'function') setLog(`序列埠讀取錯誤: ${error.message}`, true);
    } finally {
      try { reader.releaseLock(); } catch (_) {}
      serialReader = null;
    }

    try { await readableStreamClosed; } catch (_) {}
  }
}

async function connectSerialPort() {
  if (!("serial" in navigator)) {
    if (typeof setLog === 'function') setLog("此瀏覽器不支援 Web Serial API，請改用 Chromium 系列瀏覽器。", true);
    return;
  }

  try {
    serialPort = await navigator.serial.requestPort();
    await serialPort.open({ baudRate: BAUD_RATE });
    if (typeof setLog === 'function') setLog(`Arduino 已連接，Baud Rate: ${BAUD_RATE}`);
    const connectBtn = document.getElementById('connectSerialBtn');
    if (connectBtn) { connectBtn.disabled = true; connectBtn.textContent = 'Arduino 已連接'; }
    await readSerialLoop();
  } catch (error) {
    if (typeof setLog === 'function') setLog(`Arduino 連接失敗: ${error.message}`, true);
  }
}

// wire button if present
const _connectBtn = document.getElementById('connectSerialBtn');
if (_connectBtn) _connectBtn.addEventListener('click', connectSerialPort);
