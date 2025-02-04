const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
require('@electron/remote/main').initialize();

function createWindow() {
    const win = new BrowserWindow({
        width: 800,
        height: 600,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            enableRemoteModule: true
        }
    });

    win.loadFile('src/index.html');
    require("@electron/remote/main").enable(win.webContents);
}

app.whenReady().then(() => {
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

// Handle text processing with Ollama
ipcMain.handle('process-text', async (event, text) => {
    try {
        const response = await fetch('http://localhost:11434/api/generate', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: 'llama3',
                prompt: text,
                stream: false
            })
        });

        const data = await response.json();
        return data.response;
    } catch (error) {
        console.error('Error:', error);
        throw error;
    }
});
