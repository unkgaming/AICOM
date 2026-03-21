import { contextBridge, ipcRenderer } from "electron";
console.log("✅ preload.js loaded in", process.type);
console.log("preload absolute path:", __filename);

contextBridge.exposeInMainWorld("electronAPI", {
  sendChat: async (msg) => {
    console.log("Renderer → main message:", msg);
    return await ipcRenderer.invoke("chat:send", msg);
  },
  captureScreenshot: async () => {
    return await ipcRenderer.invoke("screenshot:capture");
  }
});
