import { app, BrowserWindow, ipcMain, desktopCapturer } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import fetch from 'node-fetch';
import { execFile } from 'child_process';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CHAT_MODEL = process.env.CHAT_MODEL || 'llama2';
const CAPTURE_WIDTH = 1280;
const CAPTURE_HEIGHT = 720;
const YOLO_MODEL_PATH = path.join(path.resolve(__dirname, '..'), 'best (1).pt');
const YOLO_DETECT_SCRIPT = path.join(path.resolve(__dirname, '..'), 'scripts', 'detect_ui.py');
const PYTHON_EXE = path.join(path.resolve(__dirname, '..'), '.venv', 'Scripts', 'python.exe');
let win;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeCommandText(message) {
  const raw = String(message || '').trim();
  const withoutPrefix = raw.replace(/^(please\s+|can\s+you\s+|could\s+you\s+|would\s+you\s+|hey\s+|hi\s+|assistant\s+)+/i, '');
  return withoutPrefix.trim();
}

function mapAppNameToDetectorLabels(name) {
  const n = String(name || '').trim().toLowerCase();
  const map = {
    brave: ['brave'],
    browser: ['brave', 'chrome', 'edge'],
    chrome: ['chrome'],
    'google chrome': ['chrome'],
    edge: ['edge'],
    'microsoft edge': ['edge'],
    vscode: ['vscode'],
    'vs code': ['vscode'],
    'visual studio code': ['vscode'],
    youtube: ['yt'],
    yt: ['yt']
  };
  return map[n] || [n];
}

function normalizeLabel(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isLabelMatch(label, wantedLabels) {
  const a = normalizeLabel(label);
  for (const w of wantedLabels || []) {
    const b = normalizeLabel(w);
    if (!a || !b) continue;
    if (a === b || a.includes(b) || b.includes(a)) return true;
  }
  return false;
}

function parseAutomationCommand(message) {
  const text = normalizeCommandText(message);

 
  const BROWSER_PATTERN = '(brave|edge|chrome|firefox|browser)';
  let match = text.match(new RegExp(`\\bopen\\s+${BROWSER_PATTERN}(?:\\s+browser)?\\s+(?:search|find|look\\s*up|go\\s+to|visit)\\s+(.+?)\\s+and\\s+click\\s+(?:first|top)\\s+(?:video|result|link)\\b`, 'i'));
  if (match) {
    const browser = match[1].trim().toLowerCase();
    const query = match[2].replace(/[?.!]+$/g, '').trim();
    if (query) {
      return { action: 'openBrowserAndClickFirst', args: [browser, query], summary: `open ${browser}, search "${query}", and click first result` };
    }
  }

  match = text.match(new RegExp(`\\bopen\\s+${BROWSER_PATTERN}(?:\\s+browser)?\\s+(?:search|find|look\\s*up|go\\s+to|visit)\\s+(.+)$`, 'i'));
  if (match) {
    const browser = match[1].trim().toLowerCase();
    const query = match[2].replace(/[?.!]+$/g, '').trim();
    if (query) {
      return { action: 'openBrowserAndSearch', args: [browser, query], summary: `open ${browser} and search ${query}` };
    }
  }

  match = text.match(/^\/brave\s+(.+)$/i);
  if (match) {
    const query = match[1].trim();
    if (query) {
      return { action: 'openBrowserAndSearch', args: ['brave', query], summary: `open brave and search ${query}` };
    }
  }

  match = text.match(/^\/open\s+(.+)$/i) || text.match(/^(?:open|launch|start)\s+(.+)$/i);
  if (match) {
    const target = match[1].trim();
    if (target) {
      return { action: 'launchApp', args: [target], summary: `open ${target}` };
    }
  }

  match = text.match(/^\/close\s+(.+)$/i) || text.match(/^(?:close|quit|exit|stop)\s+(.+)$/i);
  if (match) {
    const target = match[1].trim();
    if (target) {
      return { action: 'closeApp', args: [target], summary: `close ${target}` };
    }
  }

  match = text.match(/^\/type\s+(.+)$/i) || text.match(/^type\s+(.+)$/i);
  if (match) {
    return { action: 'type', args: [match[1]], summary: `type "${match[1]}"` };
  }

  match = text.match(/^\/move\s+(-?\d+)\s+(-?\d+)$/i) || text.match(/^move\s+mouse\s+to\s+(-?\d+)\s+(-?\d+)$/i);
  if (match) {
    return { action: 'moveMouse', args: [Number(match[1]), Number(match[2])], summary: `move mouse to ${match[1]}, ${match[2]}` };
  }

  if (/^\/click$/i.test(text) || /^click(\s+mouse)?$/i.test(text)) {
    return { action: 'mouseClick', args: [], summary: 'left click' };
  }

  
  if (/\bclick\s+(?:first|top)\s+(?:video|result|link)\b/i.test(text)) {
    return { action: 'clickFirstResult', args: [], summary: 'click first video result' };
  }

  
  if (/^fend$/i.test(text)) {
    return { action: 'shutdownPC', args: [], summary: 'shutdown computer' };
  }


  if (/^end$/i.test(text)) {
    return { action: 'quitApp', args: [], summary: 'quit app' };
  }

  return null;
}

async function ollamaGenerate(prompt) {
  const res = await fetch('http://localhost:11434/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: CHAT_MODEL, prompt, stream: false })
  });

  if (!res.ok) {
    const errText = await res.text();
    return { error: `Ollama HTTP ${res.status}: ${errText}` };
  }

  const data = await res.json();
  return { response: data?.response || '' };
}

function runInputAction(action, args = []) {
  return new Promise((resolve) => {
    const scriptPath = path.join(__dirname, '..', 'scripts', 'input-control.ps1');
    const powershell = process.platform === 'win32' ? 'powershell.exe' : 'pwsh';
    const execArgs = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, action, ...args.map(String)];
    execFile(powershell, execArgs, (error, stdout, stderr) => {
      if (error) {
        resolve({ error: stderr?.trim() || error.message });
        return;
      }
      resolve({ result: (stdout || '').trim() });
    });
  });
}

async function clickAtPoint(x, y, doubleClick = false) {
  const primaryAction = doubleClick ? 'doubleClickAt' : 'clickAt';
  const primary = await runInputAction(primaryAction, [x, y]);
  if (!primary.error) {
    return { ok: true, strategy: primaryAction };
  }

  
  const moved = await runInputAction('moveMouse', [x, y]);
  if (moved.error) {
    return { ok: false, error: `moveMouse failed: ${moved.error}` };
  }

  const c1 = await runInputAction('mouseClick', []);
  if (c1.error) {
    return { ok: false, error: `mouseClick failed: ${c1.error}` };
  }

  if (doubleClick) {
    await sleep(80);
    const c2 = await runInputAction('mouseClick', []);
    if (c2.error) {
      return { ok: false, error: `second mouseClick failed: ${c2.error}` };
    }
  }

  return { ok: true, strategy: 'move+click' };
}

function runYoloDetection(labels = ['searchbar'], conf = 0.25) {
  return new Promise((resolve) => {
    const args = [
      YOLO_DETECT_SCRIPT,
      '--model',
      YOLO_MODEL_PATH,
      '--labels',
      labels.join(','),
      '--conf',
      String(conf)
    ];

    execFile(PYTHON_EXE, args, { maxBuffer: 20 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        resolve({
          ok: false,
          error: stderr?.trim() || error.message,
          detections: [],
          allDetections: [],
          seenLabels: [],
          annotatedDataUrl: null
        });
        return;
      }
      try {
        const parsed = JSON.parse(String(stdout || '{}'));
        resolve({
          ok: Boolean(parsed.ok),
          error: parsed.error || null,
          detections: Array.isArray(parsed.detections) ? parsed.detections : [],
          allDetections: Array.isArray(parsed.allDetections) ? parsed.allDetections : [],
          seenLabels: Array.isArray(parsed.seenLabels) ? parsed.seenLabels : [],
          annotatedDataUrl: typeof parsed.annotatedDataUrl === 'string' ? parsed.annotatedDataUrl : null
        });
      } catch {
        resolve({
          ok: false,
          error: 'Invalid detector JSON output',
          detections: [],
          allDetections: [],
          seenLabels: [],
          annotatedDataUrl: null
        });
      }
    });
  });
}

async function clickBestDetection(labels, conf = 0.30, doubleClick = false, attempts = 5, delayMs = 250) {
  let lastAnnotatedFrame = null;
  const seenLabels = new Set();
  for (let i = 0; i < attempts; i += 1) {
    const detected = await runYoloDetection(labels, conf);
    if (detected.annotatedDataUrl) {
      lastAnnotatedFrame = detected.annotatedDataUrl;
    }
    for (const name of detected.seenLabels || []) {
      seenLabels.add(String(name));
    }
    if (!detected.seenLabels?.length) {
      for (const d of detected.allDetections || []) {
        if (d?.label) seenLabels.add(String(d.label));
      }
    }

    if (detected.ok && detected.detections.length > 0) {
      const best = detected.detections[0];
      const x = Math.max(0, Math.round(Number(best.cx || 0)));
      const y = Math.max(0, Math.round(Number(best.cy || 0)));
      if (Number.isFinite(x) && Number.isFinite(y) && (x > 0 || y > 0)) {
        const action = doubleClick ? 'doubleClickAt' : 'clickAt';
        const clicked = await runInputAction(action, [x, y]);
        if (!clicked.error) {
          return { ok: true, x, y, label: best.label, frame: lastAnnotatedFrame, seenLabels: [...seenLabels] };
        }
      }
    }
    await sleep(delayMs);
  }
  return { ok: false, frame: lastAnnotatedFrame, seenLabels: [...seenLabels] };
}

async function detectAndClickOneTask(labels, conf = 0.25, doubleClick = false, attempts = 5, delayMs = 250) {
  let frame = null;
  const seenLabels = new Set();
  let lastError = 'not found';
  let lastPicked = null;

  for (let i = 0; i < attempts; i += 1) {
    const attemptConf = Math.max(0.03, conf * Math.pow(0.85, i));
    const detected = await runYoloDetection(labels, attemptConf);
    if (detected.annotatedDataUrl) {
      frame = detected.annotatedDataUrl;
    }
    for (const name of detected.seenLabels || []) {
      seenLabels.add(String(name));
    }
    if (!detected.seenLabels?.length) {
      for (const d of detected.allDetections || []) {
        if (d?.label) seenLabels.add(String(d.label));
      }
    }

    if (detected.ok) {
      let best = (detected.detections || [])[0] || null;

      
      if (!best && Array.isArray(detected.allDetections) && detected.allDetections.length > 0) {
        const matched = detected.allDetections
          .filter((d) => isLabelMatch(d?.label, labels))
          .sort((x, y) => Number(y?.conf || 0) - Number(x?.conf || 0));
        best = matched[0] || null;
      }

      if (best) {
        const x = Math.max(0, Math.round(Number(best.cx || 0)));
        const y = Math.max(0, Math.round(Number(best.cy || 0)));
        if (Number.isFinite(x) && Number.isFinite(y) && (x > 0 || y > 0)) {
          lastPicked = { label: String(best.label || ''), conf: Number(best.conf || 0), x, y };
          const clicked = await clickAtPoint(x, y, doubleClick);
          if (clicked.ok) {
            return { ok: true, frame, seenLabels: [...seenLabels], picked: lastPicked, clickStrategy: clicked.strategy };
          }
          lastError = clicked.error || 'click failed';
        } else {
          lastError = 'invalid target coordinates';
        }
      } else {
        lastError = `no matched boxes at conf=${attemptConf.toFixed(3)}`;
      }
    } else {
      lastError = detected.error || 'detector error';
    }

    await sleep(delayMs);
  }

  return { ok: false, frame, seenLabels: [...seenLabels], picked: lastPicked, error: lastError };
}

async function captureScreenDataUrl() {
  await sleep(1000);
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: CAPTURE_WIDTH, height: CAPTURE_HEIGHT }
  });
  const first = sources?.[0];
  return first ? first.thumbnail.toDataURL() : null;
}

function createWindow() {
  win = new BrowserWindow({
    width: 400,
    height: 600,
    webPreferences: {
      preload: path.resolve(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      devTools: true
    }
  });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('input:action', async (_, action, ...args) => {
  const allowedActions = new Set(['type', 'moveMouse', 'mouseClick', 'clickAt', 'doubleClickAt', 'launchApp', 'openInBrave', 'closeApp']);
  if (!allowedActions.has(action)) return { error: 'Unknown action' };
  return runInputAction(action, args);
});

ipcMain.handle('screenshot:capture', async () => {
  try {
    const dataUrl = await captureScreenDataUrl();
    if (!dataUrl) return { error: 'No screen source found' };
    return { dataUrl };
  } catch (error) {
    return { error: error.message };
  }
});

ipcMain.handle('chat:send', async (_, message) => {
  try {
    const parsedAction = parseAutomationCommand(message);

    if (parsedAction) {
      if (parsedAction.action === 'openBrowserAndSearch' || parsedAction.action === 'openBrowserAndClickFirst') {
        const browserName = String(parsedAction.args?.[0] || 'brave').trim();
        const query = String(parsedAction.args?.[1] || '').trim();
        const browserLabels = mapAppNameToDetectorLabels(browserName);
        const frames = [];
        const clickFirst = parsedAction.action === 'openBrowserAndClickFirst';

        const openByMouse = await detectAndClickOneTask(browserLabels, 0.25, false, 6, 300);
        if (openByMouse.frame) frames.push(openByMouse.frame);
        if (!openByMouse.ok) {
          return {
            error: `Mouse open failed: classes [${browserLabels.join(', ')}] not detected. seen=[${(openByMouse.seenLabels || []).join(', ')}]`,
            screenshotUsed: frames.length > 0,
            screenshotDataUrl: frames[frames.length - 1],
            screenshotFrames: frames
          };
        }

        await sleep(3500);
        const searchByMouse = await detectAndClickOneTask(['searchbar', 'addressbar', 'urlbar'], 0.10, false, 20, 700);
        if (searchByMouse.frame) frames.push(searchByMouse.frame);
        if (!searchByMouse.frame) {
          const fallbackTaskShot = await captureScreenDataUrl();
          if (fallbackTaskShot) frames.push(fallbackTaskShot);
        }

        if (!searchByMouse.ok) {
          return {
            error: `Mouse search failed: searchbar not clicked. seen=[${(searchByMouse.seenLabels || []).join(', ')}] reason=${searchByMouse.error || 'not found'}`,
            screenshotUsed: frames.length > 0,
            screenshotDataUrl: frames[frames.length - 1],
            screenshotFrames: frames
          };
        }

        await sleep(120);
        await runInputAction('type', [query]);
        await sleep(120);
        const enterResult = await runInputAction('type', ['{ENTER}']);
        if (enterResult.error) {
          return { error: `Input action failed: ${enterResult.error}` };
        }

        if (clickFirst) {
          await sleep(3500);
            const firstVideoClick = await clickAtPoint(300, 280, true);
          if (firstVideoClick.error) {
            const diagShot = await captureScreenDataUrl();
            if (diagShot) frames.push(diagShot);
            return {
              error: `Failed to click first video: ${firstVideoClick.error}`,
              screenshotUsed: frames.length > 0,
              screenshotDataUrl: frames[frames.length - 1],
              screenshotFrames: frames
            };
          }
          await sleep(2500);
          const resultShot = await captureScreenDataUrl();
          if (resultShot) frames.push(resultShot);
        }

        return {
          reply: `Executed: ${parsedAction.summary}`,
          screenshotUsed: frames.length > 0,
          screenshotDataUrl: frames[frames.length - 1],
          screenshotFrames: frames
        };
      }

      if (parsedAction.action === 'clickFirstResult') {
        
        const clicked = await clickAtPoint(300, 280, false);
        if (clicked.error) {
          const shot = await captureScreenDataUrl();
          return {
            error: `Failed to click first video: ${clicked.error}`,
            screenshotUsed: Boolean(shot),
            screenshotDataUrl: shot || undefined,
            screenshotFrames: shot ? [shot] : []
          };
        }
        await sleep(2500);
        const shotUrl = await captureScreenDataUrl();
        return {
          reply: `Executed: ${parsedAction.summary}`,
          screenshotUsed: Boolean(shotUrl),
          screenshotDataUrl: shotUrl || undefined,
          screenshotFrames: shotUrl ? [shotUrl] : []
        };
      }

      if (parsedAction.action === 'launchApp') {
        const target = String(parsedAction.args?.[0] || '').trim();
        const labels = mapAppNameToDetectorLabels(target);
        const openByMouse = await clickBestDetection(labels, 0.25, false, 6, 300);
        if (!openByMouse.ok) {
          return {
            error: `Mouse open failed: no detection for classes ${labels.join(', ')}. seen=[${(openByMouse.seenLabels || []).join(', ')}]`,
            screenshotUsed: Boolean(openByMouse.frame),
            screenshotDataUrl: openByMouse.frame || undefined,
            screenshotFrames: openByMouse.frame ? [openByMouse.frame] : []
          };
        }
        return {
          reply: `Executed: ${parsedAction.summary}`,
          screenshotUsed: Boolean(openByMouse.frame),
          screenshotDataUrl: openByMouse.frame || undefined,
          screenshotFrames: openByMouse.frame ? [openByMouse.frame] : []
        };
      }

      if (parsedAction.action === 'quitApp') {
        setTimeout(() => app.quit(), 500);
        return { reply: 'Goodbye! Closing app...' };
      }

      if (parsedAction.action === 'shutdownPC') {
        setTimeout(() => {
          execFile('shutdown', ['/s', '/t', '0'], { shell: true }, () => {});
        }, 1000);
        return { reply: 'Shutting down computer...' };
      }

      const actionResult = await runInputAction(parsedAction.action, parsedAction.args);
      if (actionResult.error) {
        return { error: `Input action failed: ${actionResult.error}` };
      }
      return { reply: `Executed: ${parsedAction.summary}` };
    }

    const textResult = await ollamaGenerate(message);
    if (textResult.error) {
      return { error: textResult.error };
    }
    return { reply: textResult.response || 'No reply.' };
  } catch (e) {
    return { error: e.message };
  }
});
