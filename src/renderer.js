const { ipcRenderer } = require('electron');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const fs = require('fs');

// DOM Elements
const settingsBtn = document.getElementById('settingsBtn');
const mainView = document.getElementById('mainView');
const settingsView = document.getElementById('settingsView');
const tabsList = document.getElementById('tabsList');
const newTabBtn = document.getElementById('newTabBtn');
const modelSelect = document.getElementById('modelSelect');
const contextWindow = document.getElementById('contextWindow');
const timeout = document.getElementById('timeout');
const stream = document.getElementById('stream');
const temperature = document.getElementById('temperature');
const temperatureValue = document.getElementById('temperatureValue');
const systemPrompt = document.getElementById('systemPrompt');

// Tab Management
let tabCounter = 1;
let activeTabId = 'tab1';

function createTabPanel(id, cloneContent = '') {
    const panel = document.createElement('div');
    panel.className = 'tab-panel';
    panel.id = id;
    panel.innerHTML = `
        <div class="split-pane">
            <div class="input-pane">
                <div class="input-section">
                    <textarea class="input-text" placeholder="Type your text here or upload a file...">${cloneContent}</textarea>
                    <div class="controls">
                        <input type="file" class="file-input" accept=".txt,.pdf,.doc,.docx">
                        <button class="submit-btn">Process Text</button>
                        <button class="clone-btn">Clone Tab</button>
                    </div>
                </div>
            </div>
            <div class="output-pane">
                <div class="loading hidden">Processing...</div>
                <div class="output"></div>
            </div>
        </div>
    `;
    return panel;
}

function addTab(cloneContent = '') {
    tabCounter++;
    const tabId = `tab${tabCounter}`;
    
    // Create and add tab button
    const tabButton = document.createElement('button');
    tabButton.className = 'tab';
    tabButton.textContent = `Tab ${tabCounter}`;
    tabButton.dataset.tab = tabId;
    tabsList.insertBefore(tabButton, newTabBtn);
    
    // Create and add tab panel
    const tabPanel = createTabPanel(tabId, cloneContent);
    document.querySelector('.tabs-content').appendChild(tabPanel);
    
    // Setup event listeners for the new tab
    setupTabEventListeners(tabId);
    
    // Switch to the new tab
    switchTab(tabId);
}

function switchTab(tabId) {
    // Update active states
    document.querySelectorAll('.tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.tab === tabId);
    });
    document.querySelectorAll('.tab-panel').forEach(panel => {
        panel.classList.toggle('active', panel.id === tabId);
    });
    activeTabId = tabId;
}

function setupTabEventListeners(tabId) {
    const panel = document.getElementById(tabId);
    const input = panel.querySelector('.input-text');
    const fileInput = panel.querySelector('.file-input');
    const submitBtn = panel.querySelector('.submit-btn');
    const cloneBtn = panel.querySelector('.clone-btn');
    const loading = panel.querySelector('.loading');
    const output = panel.querySelector('.output');

    // File upload handler
    fileInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        try {
            const fileExtension = file.name.split('.').pop().toLowerCase();
            let text = '';

            switch (fileExtension) {
                case 'txt':
                    text = await file.text();
                    break;

                case 'pdf':
                    const pdfBuffer = await file.arrayBuffer();
                    const pdfData = await pdfParse(Buffer.from(pdfBuffer));
                    text = pdfData.text;
                    break;

                case 'doc':
                case 'docx':
                    const docBuffer = await file.arrayBuffer();
                    const result = await mammoth.extractRawText({
                        buffer: Buffer.from(docBuffer)
                    });
                    text = result.value;
                    break;

                default:
                    throw new Error('Unsupported file type');
            }

            input.value = text;
        } catch (error) {
            console.error('Error reading file:', error);
            output.textContent = 'Error reading file: ' + error.message;
        }
    });

    // Submit handler
    submitBtn.addEventListener('click', async () => {
        const text = input.value.trim();
        if (!text) {
            output.textContent = 'Please enter some text or upload a file.';
            return;
        }

        try {
            loading.classList.remove('hidden');
            output.textContent = '';
            
            const currentSettings = {
                model: modelSelect.value,
                contextWindow: parseInt(contextWindow.value),
                timeout: parseInt(timeout.value),
                stream: stream.checked,
                temperature: parseFloat(temperature.value),
                systemPrompt: systemPrompt.value
            };
            
            if (currentSettings.stream) {
                output.textContent = '';
            }
            
            const response = await ipcRenderer.invoke('process-text', {
                text,
                settings: currentSettings
            });

            if (!currentSettings.stream) {
                output.textContent = response;
            }
        } catch (error) {
            console.error('Error processing text:', error);
            output.textContent = 'Error processing text: ' + error.message;
        } finally {
            loading.classList.add('hidden');
        }
    });

    // Clone handler
    cloneBtn.addEventListener('click', () => {
        addTab(input.value);
    });
}

// Initialize first tab
setupTabEventListeners('tab1');

// Tab switching
tabsList.addEventListener('click', (e) => {
    if (e.target.classList.contains('tab')) {
        switchTab(e.target.dataset.tab);
    }
});

// New tab button
newTabBtn.addEventListener('click', () => addTab());

// Handle streaming responses
ipcRenderer.on('stream-response', (event, chunk) => {
    const activePanel = document.getElementById(activeTabId);
    const output = activePanel.querySelector('.output');
    if (output.textContent === '') {
        output.textContent = chunk;
    } else {
        output.textContent += chunk;
    }
});

// Settings management
const defaultSettings = {
    model: 'llama2',
    contextWindow: 4096,
    timeout: 120,
    stream: true,
    temperature: 0.75,
    systemPrompt: ''
};

function loadSettings() {
    const savedSettings = localStorage.getItem('settings');
    return savedSettings ? JSON.parse(savedSettings) : defaultSettings;
}

function saveSettings() {
    const settings = {
        model: modelSelect.value,
        contextWindow: parseInt(contextWindow.value),
        timeout: parseInt(timeout.value),
        stream: stream.checked,
        temperature: parseFloat(temperature.value),
        systemPrompt: systemPrompt.value
    };
    localStorage.setItem('settings', JSON.stringify(settings));
}

// Apply settings to UI
function applySettings(settings) {
    contextWindow.value = settings.contextWindow;
    timeout.value = settings.timeout;
    stream.checked = settings.stream;
    temperature.value = settings.temperature;
    temperatureValue.textContent = settings.temperature;
    systemPrompt.value = settings.systemPrompt;
}

// View switching
settingsBtn.addEventListener('click', () => {
    const isSettingsVisible = !settingsView.classList.contains('hidden');
    mainView.classList.toggle('hidden', !isSettingsVisible);
    settingsView.classList.toggle('hidden', isSettingsVisible);
});

// Settings change handlers
[contextWindow, timeout, stream, temperature, systemPrompt].forEach(element => {
    element.addEventListener('change', saveSettings);
});

temperature.addEventListener('input', (e) => {
    temperatureValue.textContent = e.target.value;
});


// Load models from Ollama
async function loadModels() {
    try {
        const models = await ipcRenderer.invoke('get-models');
        modelSelect.innerHTML = models.map(model => 
            `<option value="${model.name}" ${model.name === settings.model ? 'selected' : ''}>${model.name}</option>`
        ).join('');
    } catch (error) {
        console.error('Error loading models:', error);
        modelSelect.innerHTML = `<option value="${settings.model}">${settings.model}</option>`;
    }
}

// Initialize settings and load models
const settings = loadSettings();
applySettings(settings);
loadModels();
modelSelect.addEventListener('change', saveSettings);
