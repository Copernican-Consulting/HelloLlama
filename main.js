const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fetch = require('node-fetch');
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

        const data = await response.json();
        
        // Validate JSON structure
        try {
            const parsedResponse = JSON.parse(data.response);
            
            // Validate required fields and data types
            if (!parsedResponse.scores || typeof parsedResponse.scores !== 'object') {
                throw new Error('Missing or invalid scores object');
            }
            
            const requiredScores = ['clarity', 'tone', 'alignment', 'efficiency', 'completeness'];
            for (const score of requiredScores) {
                if (typeof parsedResponse.scores[score] !== 'number' || 
                    parsedResponse.scores[score] < 0 || 
                    parsedResponse.scores[score] > 100) {
                    throw new Error(`Invalid score for ${score}. Must be a number between 0 and 100`);
                }
            }
            
            if (!Array.isArray(parsedResponse.snippetFeedback)) {
                throw new Error('snippetFeedback must be an array');
            }
            
            parsedResponse.snippetFeedback.forEach((feedback, index) => {
                if (!feedback.snippet || typeof feedback.snippet !== 'string') {
                    throw new Error(`Invalid snippet at index ${index}`);
                }
                if (!feedback.comment || typeof feedback.comment !== 'string') {
                    throw new Error(`Invalid comment at index ${index}`);
                }
            });
            
            if (!Array.isArray(parsedResponse.generalComments)) {
                throw new Error('generalComments must be an array');
            }
            
            parsedResponse.generalComments.forEach((comment, index) => {
                if (typeof comment !== 'string') {
                    throw new Error(`Invalid general comment at index ${index}`);
                }
            });
            
            return data.response; // Return the original JSON string for parsing in renderer
        } catch (parseError) {
            console.error('Invalid response format:', parseError);
            throw new Error(`The model response was not in the correct format: ${parseError.message}`);
        }
    } catch (error) {
        console.error('Error:', error);
        throw error;
    }
});
