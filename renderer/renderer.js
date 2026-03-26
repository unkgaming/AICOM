const chatLog = document.getElementById("chatLog");
const userInput = document.getElementById("userInput");

const sendBtn = document.getElementById("sendBtn");
const screenshotBtn = document.getElementById("screenshotBtn");
const voiceBtn = document.getElementById("voiceBtn");
const voiceLang = document.getElementById("voiceLang");

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;
let isListening = false;

if (SpeechRecognition) {
  recognition = new SpeechRecognition();
  const savedLang = localStorage.getItem("voiceLang") || "en-US";
  if (voiceLang) {
    voiceLang.value = savedLang;
  }
  recognition.lang = savedLang;
  recognition.interimResults = true;
  recognition.continuous = false;

  recognition.onstart = () => {
    isListening = true;
    if (voiceBtn) {
      voiceBtn.classList.add("listening");
      voiceBtn.textContent = "⏹";
      voiceBtn.title = "Stop listening";
    }
  };

  recognition.onresult = (event) => {
    let transcript = "";
    let finalText = "";
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const chunk = event.results[i][0].transcript;
      transcript += chunk;
      if (event.results[i].isFinal) {
        finalText += chunk;
      }
    }
    userInput.value = transcript.trim();

    if (finalText.trim()) {
      userInput.value = finalText.trim();
      sendMessage();
    }
  };

  recognition.onend = () => {
    isListening = false;
    if (voiceBtn) {
      voiceBtn.classList.remove("listening");
      voiceBtn.textContent = "🎤";
      voiceBtn.title = "Voice command";
    }
  };

  recognition.onerror = (event) => {
    appendMsg("Voice error: " + event.error, "bot");
  };
}


sendBtn.addEventListener("click", sendMessage);
userInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") sendMessage();
});

if (screenshotBtn) {
  screenshotBtn.addEventListener("click", async () => {
    const res = await window.electronAPI.captureScreenshot();
    if (res.dataUrl) {
      console.log("Screenshot captured (base64 PNG):", res.dataUrl.slice(0, 100) + "...");
      alert("Screenshot captured! Check console for base64 data.");
    } else {
      alert("Screenshot failed: " + (res.error || "unknown error"));
    }
  });
}

if (voiceBtn) {
  voiceBtn.addEventListener("click", () => {
    if (!recognition) {
      appendMsg("Voice command is not supported in this environment.", "bot");
      return;
    }

    if (isListening) {
      recognition.stop();
      return;
    }

    recognition.start();
  });
}

if (voiceLang) {
  voiceLang.addEventListener("change", () => {
    const lang = voiceLang.value || "en-US";
    localStorage.setItem("voiceLang", lang);
    if (recognition && !isListening) {
      recognition.lang = lang;
    }
  });
}

async function sendMessage() {
  const text = userInput.value.trim();
  if (!text) return;
  appendMsg(text, "user");
  userInput.value = "";

  console.log("📤 Sending to main:", text);
  try {
    const res = await window.electronAPI.sendChat(text);
    console.log("📥 Response from main:", res);
    const annotatedFrames = [];
    if (Array.isArray(res.screenshotFrames)) {
      for (const frame of res.screenshotFrames) {
        if (isAnnotatedDetectionFrame(frame)) annotatedFrames.push(frame);
      }
    }
    if (annotatedFrames.length === 0 && isAnnotatedDetectionFrame(res.screenshotDataUrl)) {
      annotatedFrames.push(res.screenshotDataUrl);
    }
    for (const frame of annotatedFrames) {
      appendImage(frame, "bot");
    }
    if (Array.isArray(res.detectionResults) && res.detectionResults.length > 0) {
      appendMsg(formatDetectionResults(res.detectionResults), "bot");
    }
    if (res.error) appendMsg("Error: " + res.error, "bot");
    else appendMsg(res.reply, "bot");
  } catch (err) {
    console.error("IPC error:", err);
    appendMsg("IPC failed: " + err.message, "bot");
  }
}

function isAnnotatedDetectionFrame(dataUrl) {
  if (typeof dataUrl !== "string") return false;
  return /^data:image\/(jpeg|jpg);base64,/i.test(dataUrl);
}

function formatDetectionResults(results) {
  const lines = ["YOLO detections:"];
  for (const item of results) {
    const stage = item?.stage ? String(item.stage) : "step";
    const picked = item?.picked || null;
    const seen = Array.isArray(item?.seenLabels) ? item.seenLabels : [];
    if (picked) {
      const label = String(picked.label || "unknown");
      const conf = Number(picked.conf || 0);
      const x = Number(picked.x || 0);
      const y = Number(picked.y || 0);
      lines.push(`- ${stage}: ${label} conf=${conf.toFixed(3)} at (${x}, ${y})`);
    } else {
      lines.push(`- ${stage}: no picked target`);
    }
    if (seen.length > 0) {
      lines.push(`  seen: ${seen.join(", ")}`);
    }
  }
  return lines.join("\n");
}

function appendMsg(text, who = "bot") {
  const div = document.createElement("div");
  div.className = "msg " + who;
  div.textContent = text;
  chatLog.appendChild(div);
  chatLog.scrollTop = chatLog.scrollHeight;
}

function appendImage(dataUrl, who = "bot") {
  const wrap = document.createElement("div");
  wrap.className = "msg " + who;

  const img = document.createElement("img");
  img.src = dataUrl;
  img.alt = "detection";
  img.style.maxWidth = "100%";
  img.style.borderRadius = "8px";
  img.style.marginTop = "6px";
  img.style.border = "1px solid #dcdcdc";

  wrap.appendChild(img);
  chatLog.appendChild(wrap);
  chatLog.scrollTop = chatLog.scrollHeight;
}

