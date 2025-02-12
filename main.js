const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const isDev = !app.isPackaged;
const fetch = require('node-fetch');
const pdfParse = require('pdf-parse');
const fs = require('fs').promises;
const { execSync, spawn } = require('child_process');
const fsSync = require('fs');
require('@electron/remote/main').initialize();

async function checkOllamaService() {
    try {
        await fetch('http://localhost:11434/api/tags');
        return true;
    } catch (error) {
        return false;
    }
}

async function ensureOllamaRunning() {
    const isRunning = await checkOllamaService();
    if (!isRunning) {
        await dialog.showErrorBox(
            'Ollama Not Running',
            'Ollama service is not running. Please start the Ollama service and try again.'
        );
        app.quit();
        return;
    }

    // Check if llama3 model is available
    try {
        const response = await fetch('http://localhost:11434/api/tags');
        const data = await response.json();
        const hasLlama3 = data.models.some(model => model.name.startsWith('llama3:'));
        if (!hasLlama3) {
            await dialog.showErrorBox(
                'Model Not Found',
                'The llama3 model is not installed. Please run "ollama pull llama3:latest" to install it.'
            );
            app.quit();
            return;
        }
    } catch (error) {
        console.error('Error checking models:', error);
        await dialog.showErrorBox(
            'Error',
            'Failed to check available models. Please ensure Ollama is running correctly.'
        );
        app.quit();
        return;
    }
}

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
    await ensureOllamaRunning();
    createWindow();

    app.on('activate', async () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            await ensureOllamaRunning();
            createWindow();
        }
    });
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
