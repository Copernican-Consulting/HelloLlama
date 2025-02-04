const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
require('@electron/remote/main').initialize();

function createWindow() {
    const win = new BrowserWindow({
        width: 1200,
        height: 800,
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

// Fetch available models from Ollama
ipcMain.handle('get-models', async () => {
    try {
        const response = await fetch('http://localhost:11434/api/tags');
        const data = await response.json();
        return data.models.map(model => ({
            name: model.name,
            modified_at: model.modified_at
        }));
    } catch (error) {
        console.error('Error fetching models:', error);
        throw error;
    }
});

// Handle text processing with Ollama
ipcMain.handle('process-text', async (event, { text, settings }) => {
    try {
        const response = await fetch('http://localhost:11434/api/generate', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: settings.model,
                prompt: text,
                system: settings.systemPrompt,
                context_window: settings.contextWindow,
                timeout: settings.timeout * 1000, // convert to milliseconds
                stream: settings.stream,
                temperature: settings.temperature
            })
        });

        if (settings.stream) {
            // For streaming responses, we'll send chunks back to the renderer
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let fullResponse = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                let chunk = decoder.decode(value);
                
                // Handle partial chunks by buffering
                chunk = chunk.replace(/}\s*{/g, '}\n{');  // Ensure proper line separation
                const lines = chunk.split('\n');
                
                for (const line of lines) {
                    const trimmedLine = line.trim();
                    if (!trimmedLine) continue;
                    
                    try {
                        // Extract response text using regex to avoid JSON parse errors
                        const match = trimmedLine.match(/"response"\s*:\s*"([^"]*)"[,}]/);
                        if (match && match[1]) {
                            const response = match[1].replace(/\\n/g, '\n').replace(/\\/g, '');
                            fullResponse += response;
                            event.sender.send('stream-response', response);
                        }
                    } catch (error) {
                        console.error('Error processing chunk:', error);
                        continue;
                    }
                }
            }
            return fullResponse;
        } else {
            const data = await response.json();
            return data.response;
        }
    } catch (error) {
        console.error('Error:', error);
        throw error;
    }
});
