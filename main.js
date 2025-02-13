const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const isDev = !app.isPackaged;
const fetch = require('node-fetch');
const pdfParse = require('pdf-parse');
const fs = require('fs').promises;
const fsSync = require('fs');
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

    // In development, load from src directory
    // In production, load from installation directory
    const indexPath = isDev ? 
        path.join(__dirname, 'src', 'index.html') : 
        path.join(process.resourcesPath, 'app', 'src', 'index.html');
    win.loadFile(indexPath);
    require("@electron/remote/main").enable(win.webContents);
}

ipcMain.handle('parse-pdf', async (event, pdfBuffer) => {
    try {
        const buffer = Buffer.from(new Uint8Array(pdfBuffer));
        const pdfData = await pdfParse(buffer);
        if (!pdfData || !pdfData.text) {
            throw new Error('No text content found in PDF');
        }
        return pdfData.text;
    } catch (error) {
        console.error('PDF parsing error in main.js:', error);
        return { error: error.message }; // Return error message to renderer
    }
});

// Ensure prompt directories exist
async function ensurePromptDirectories() {
    const dirs = ['Prompts', 'Prompts/Defaults'];
    for (const dir of dirs) {
        try {
            await fs.access(dir);
        } catch {
            await fs.mkdir(dir, { recursive: true });
        }
    }
}

// Copy default prompts if user prompts don't exist
async function ensureUserPrompts() {
    const prompts = ['systemPrompt', 'management', 'technical', 'hr', 'legal', 'junior'];
    for (const prompt of prompts) {
        const userPath = `Prompts/${prompt}.txt`;
        try {
            await fs.access(userPath);
        } catch {
            const defaultPath = `Prompts/Defaults/${prompt}.txt`;
            if (fsSync.existsSync(defaultPath)) {
                await fs.copyFile(defaultPath, userPath);
            }
        }
    }
}

// Handle reading prompts
ipcMain.handle('read-prompt', async (event, { type, isDefault = false }) => {
    try {
        const dir = isDefault ? 'Prompts/Defaults' : 'Prompts';
        const content = await fs.readFile(`${dir}/${type}.txt`, 'utf8');
        return content;
    } catch (error) {
        console.error('Error reading prompt:', error);
        throw error;
    }
});

// Handle writing prompts
ipcMain.handle('write-prompt', async (event, { type, content }) => {
    try {
        await fs.writeFile(`Prompts/${type}.txt`, content);
        return true;
    } catch (error) {
        console.error('Error writing prompt:', error);
        throw error;
    }
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

// Initialize prompt system when app is ready
app.whenReady().then(async () => {
    await ensurePromptDirectories();
    await ensureUserPrompts();
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

// Handle opening external URLs
ipcMain.handle('open-external-url', (event, url) => {
    shell.openExternal(url);
});

// Handle text processing with OpenRouter
ipcMain.handle('process-text', async (event, { text, settings }) => {
    try {
        let response;
        let data;
        if (!settings.openrouterKey) {
            throw new Error('No auth credentials found - please enter your OpenRouter API key in Settings');
        }
        response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${settings.openrouterKey}`,
                'HTTP-Referer': 'http://localhost:3000',
                'X-Title': 'Sideview.AI'
            },
            body: JSON.stringify({
                model: settings.openrouterModel,
                messages: [
                    { role: "system", content: settings.systemPrompt },
                    { role: "user", content: text }
                ],
                temperature: settings.temperature,
                max_tokens: settings.contextWindow
            })
        });
        const openRouterResponse = await response.json();
        if (!response.ok) {
            throw new Error(openRouterResponse.error?.message || 'OpenRouter API error');
        }
        data = openRouterResponse.choices[0].message.content;
        
        // Validate JSON structure
        try {
            const parsedResponse = JSON.parse(data);
            
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
            
            return data; // Return the original JSON string for parsing in renderer
        } catch (parseError) {
            console.error('Invalid response format:', parseError);
            throw new Error(`The model response was not in the correct format: ${parseError.message}`);
        }
    } catch (error) {
        console.error('Error:', error);
        throw error;
    }
});
