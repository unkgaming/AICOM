const { contextBridge, ipcRenderer } = require("electron");
console.log("✅ preload.js loaded in", process.type);

contextBridge.exposeInMainWorld("electronAPI", {
  sendChat: async (msg) => {
    console.log("Renderer → main message:", msg);
    return await ipcRenderer.invoke("chat:send", msg);
  },
  captureScreenshot: async () => {
    return await ipcRenderer.invoke("screenshot:capture");
  }
});
