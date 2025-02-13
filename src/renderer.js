const { ipcRenderer } = require('electron');
const mammoth = require('mammoth');

// Settings management
const defaultSettings = {
    model: 'llama3:latest',
    contextWindow: 4096,
    timeout: 120,
    stream: true,
    temperature: 0.75,
    seed: ''
};

function loadSettings() {
    try {
        const savedSettings = localStorage.getItem('settings');
        return savedSettings ? JSON.parse(savedSettings) : defaultSettings;
    } catch (error) {
        console.error('Error loading settings:', error);
        return defaultSettings;
    }
}

function saveSettings() {
    try {
        const settings = {
            model: modelSelect?.value || defaultSettings.model,
            contextWindow: parseInt(contextWindow?.value || defaultSettings.contextWindow),
            timeout: parseInt(timeout?.value || defaultSettings.timeout),
            stream: stream?.checked ?? defaultSettings.stream,
            temperature: parseFloat(temperature?.value || defaultSettings.temperature),
            seed: seed?.value || defaultSettings.seed
        };
        localStorage.setItem('settings', JSON.stringify(settings));
    } catch (error) {
        console.error('Error saving settings:', error);
    }
}

function applySettings(settings) {
    if (!settings) return;
    
    if (contextWindow) contextWindow.value = settings.contextWindow;
    if (timeout) timeout.value = settings.timeout;
    if (stream) stream.checked = settings.stream;
    if (temperature) temperature.value = settings.temperature;
    if (temperatureValue) temperatureValue.textContent = settings.temperature;
    if (seed && settings.seed) seed.value = settings.seed;
}

// Initialize settings first
const settings = loadSettings();

// DOM Elements
const settingsBtn = document.getElementById('settingsBtn');
const viewAllFeedbackBtn = document.getElementById('viewAllFeedbackBtn');
const mainView = document.getElementById('mainView');
const settingsView = document.getElementById('settingsView');
const allFeedbackView = document.getElementById('allFeedbackView');
const tabsList = document.getElementById('tabsList');
const modelSelect = document.getElementById('modelSelect');
const contextWindow = document.getElementById('contextWindow');
const timeout = document.getElementById('timeout');
const stream = document.getElementById('stream');
const temperature = document.getElementById('temperature');
const temperatureValue = document.getElementById('temperatureValue');
const seed = document.getElementById('seed');
const systemPrompt = document.getElementById('systemPrompt');

// Apply settings after DOM elements are initialized
applySettings(settings);

// Store raw LLM responses for debugging
let rawResponses = {};

// Add Save and Close button to Settings
const saveCloseBtn = document.createElement('button');
saveCloseBtn.textContent = 'Save and Close';
saveCloseBtn.style.cssText = `
    padding: 10px 20px;
    background-color: #4CAF50;
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 14px;
    margin-top: 20px;
    display: block;
    width: 100%;
`;
saveCloseBtn.addEventListener('mouseover', () => {
    saveCloseBtn.style.backgroundColor = '#45a049';
});
saveCloseBtn.addEventListener('mouseout', () => {
    saveCloseBtn.style.backgroundColor = '#4CAF50';
});
saveCloseBtn.addEventListener('click', () => {
    saveSettings();
    if (mainView) mainView.classList.remove('hidden');
    if (settingsView) settingsView.classList.add('hidden');
});
settingsView.appendChild(saveCloseBtn);

// Feedback state
let currentText = '';
let feedbackData = {};
let debugMode = {};

// Persona Management
const PERSONAS = {
    management: 'Senior Management',
    technical: 'Technical Project Manager',
    hr: 'HR',
    legal: 'Legal',
    junior: 'New Junior Team Member'
};

let activeTabId = 'documents';

async function getDefaultSystemPrompt() {
    try {
        return await ipcRenderer.invoke('read-prompt', { type: 'systemPrompt', isDefault: true });
    } catch (error) {
        console.error('Error reading default system prompt:', error);
        return '';
    }
}

async function getDefaultPersonaPrompt(persona) {
    try {
        return await ipcRenderer.invoke('read-prompt', { type: persona, isDefault: true });
    } catch (error) {
        console.error('Error reading default persona prompt:', error);
        return '';
    }
}

async function getPrompt(persona) {
    try {
        const [systemPrompt, personaPrompt] = await Promise.all([
            ipcRenderer.invoke('read-prompt', { type: 'systemPrompt' })
                .catch(() => ipcRenderer.invoke('read-prompt', { type: 'systemPrompt', isDefault: true })),
            ipcRenderer.invoke('read-prompt', { type: persona })
                .catch(() => ipcRenderer.invoke('read-prompt', { type: persona, isDefault: true }))
        ]);
        return `${systemPrompt}\n\n${personaPrompt}`;
    } catch (error) {
        console.error('Error reading prompts:', error);
        return '';
    }
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

    // Hide document controls in non-document tabs
    document.querySelectorAll('.document-controls').forEach(controls => {
        if (controls.closest('#documents')) {
            controls.style.display = 'flex';
        } else {
            controls.style.display = 'none';
        }
    });

    // If switching to a persona tab, refresh its feedback display
    if (PERSONAS[tabId] && feedbackData[tabId]) {
        createFeedbackDisplay(feedbackData[tabId], tabId);
    }
}

// File upload handler
function setupFileUploadHandlers() {
    document.querySelectorAll('.file-input').forEach(fileInput => {
        fileInput.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;

            const panel = fileInput.closest('.tab-panel');
            if (!panel) return;

            const input = panel.querySelector('.input-text');
            if (!input) return;

            try {
                const fileExtension = file.name.split('.').pop().toLowerCase();
                let text = '';

                switch (fileExtension) {
                    case 'txt':
                        text = await new Promise((resolve, reject) => {
                            const reader = new FileReader();
                            reader.onload = (e) => resolve(e.target.result);
                            reader.onerror = (e) => reject(new Error('Failed to read text file'));
                            reader.readAsText(file);
                        });
                        break;

                    case 'pdf':
                        try {
                            showError(panel, 'Reading PDF file...');

                            const pdfBuffer = await new Promise((resolve, reject) => {
                                const reader = new FileReader();
                                reader.onload = (e) => {
                                    showError(panel, 'PDF file loaded, preparing to send to main process...');
                                    resolve(e.target.result);
                                };
                                reader.onerror = (e) => {
                                    console.error('Failed to read PDF file:', e.target.error);
                                    reject(new Error('Failed to read PDF file: ' + e.target.error));
                                };
                                reader.readAsArrayBuffer(file);
                            });

                            showError(panel, 'Sending file data to main process...');
                            const result = await ipcRenderer.invoke('parse-pdf', pdfBuffer);

                            if (result.error) {
                                throw new Error(result.error);
                            }

                            showError(panel, `PDF parsed successfully`);
                            text = result;

                        } catch (error) {
                            console.error('PDF parsing error:', {
                                error: error.message,
                                stack: error.stack,
                                name: error.name
                            });
                            throw new Error(`PDF import failed: ${error.message}`);
                        }
                        break;

                    case 'doc':
                    case 'docx':
                        const docBuffer = await new Promise((resolve, reject) => {
                            const reader = new FileReader();
                            reader.onload = (e) => resolve(e.target.result);
                            reader.onerror = (e) => reject(new Error('Failed to read Word document'));
                            reader.readAsArrayBuffer(file);
                        });
                        const result = await mammoth.extractRawText({
                            buffer: Buffer.from(docBuffer)
                        });
                        text = result.value;
                        break;

                    default:
                        throw new Error('Unsupported file type');
                }

                // Set the text in all panels
                document.querySelectorAll('.input-text').forEach(textArea => {
                    textArea.value = text;
                });
                
                // Reset progress when text changes
                resetProgress();
            } catch (error) {
                console.error('Error reading file:', error);
                showError(panel, 'Error reading file: ' + error.message);
            }
        });
    });
}

// Submit handler
function setupSubmitHandlers() {
    document.querySelectorAll('.submit-btn').forEach(submitBtn => {
        submitBtn.addEventListener('click', async () => {
            const panel = submitBtn.closest('.tab-panel');
            if (!panel) return;

            const input = panel.querySelector('.input-text');
            if (!input) return;

            const text = input.value.trim();
            if (!text) {
                showError(document.getElementById('documents'), 'Please enter some text or upload a file.');
                return;
            }

            currentText = text;
            feedbackData = {};
            resetProgress();

            // Process text for all personas
            for (const persona of Object.keys(PERSONAS)) {
                const personaPanel = document.getElementById(persona);
                if (!personaPanel) continue;

                const personaLoading = personaPanel.querySelector('.loading');
                const inputView = personaPanel.querySelector('.input-view');
                const feedbackView = personaPanel.querySelector('.feedback-view');

                if (!personaLoading || !inputView || !feedbackView) continue;

                try {
                    personaLoading.classList.remove('hidden');
                    inputView.classList.add('hidden');
                    feedbackView.classList.add('hidden');

                    const systemPrompt = await getPrompt(persona);
                    const currentSettings = {
                        model: modelSelect.value,
                        contextWindow: parseInt(contextWindow.value),
                        timeout: parseInt(timeout.value),
                        stream: false,
                        temperature: parseFloat(temperature.value),
                        systemPrompt: systemPrompt,
                        persona: persona
                    };

                    // Update progress indicator
                    const progressItem = document.querySelector(`.progress-item.${persona}`);
                    if (progressItem) {
                        progressItem.textContent = `${PERSONAS[persona]} Feedback (Processing...)`;
                    }

                    const response = await ipcRenderer.invoke('process-text', {
                        text,
                        settings: {
                            ...currentSettings,
                            seed: seed?.value ? parseInt(seed.value) : undefined
                        }
                    });

                    // Store raw response for debugging
                    rawResponses[persona] = response;

                    try {
                        // Parse and validate JSON
                        const parsedResponse = JSON.parse(response);
                        feedbackData[persona] = parsedResponse;
                        
                        // Update feedback display
                        createFeedbackDisplay(parsedResponse, persona);
                        
                        // Update progress and enable tab
                        markPersonaComplete(persona, false);
                    } catch (error) {
                        console.error('Error processing text:', error);
                        
                        // Create retry button
                        const retryBtn = document.createElement('button');
                        retryBtn.textContent = 'Retry';
                        retryBtn.style.cssText = `
                            padding: 8px 16px;
                            background: #4CAF50;
                            color: white;
                            border: none;
                            border-radius: 4px;
                            cursor: pointer;
                            margin-top: 10px;
                        `;
                        
                        // Handle different error types
                        let errorMessage;
                        if (error.message.includes('timeout')) {
                            errorMessage = `${PERSONAS[persona]} was in a meeting.`;
                        } else if (error.message.includes('JSON') || error.message.includes('Unexpected')) {
                            errorMessage = `I can't understand ${PERSONAS[persona]}'s feedback.`;
                        } else if (error.message.includes('ECONNREFUSED') || error.message.includes('ECONNRESET')) {
                            errorMessage = `${PERSONAS[persona]} was in a meeting.`;
                        } else {
                            errorMessage = error.message;
                        }
                        
                        // Show error with retry button
                        const errorContainer = document.createElement('div');
                        errorContainer.className = 'error-message';
                        const messageEl = document.createElement('div');
                        messageEl.textContent = errorMessage;
                        messageEl.style.marginBottom = '10px';
                        errorContainer.appendChild(messageEl);
                        errorContainer.appendChild(retryBtn);
                        
                        // Add retry functionality
                        retryBtn.addEventListener('click', async () => {
                            try {
                                // Hide error and show loading
                                errorContainer.remove();
                                personaLoading.classList.remove('hidden');
                                
                                const response = await ipcRenderer.invoke('process-text', {
                                    text,
                                    settings: {
                                        ...currentSettings,
                                        seed: seed?.value ? parseInt(seed.value) : undefined
                                    }
                                });
                                
                                // Parse and validate JSON
                                const parsedResponse = JSON.parse(response);
                                feedbackData[persona] = parsedResponse;
                                
                                // Update feedback display
                                createFeedbackDisplay(parsedResponse, persona);
                                
                                // Update progress and enable tab
                                markPersonaComplete(persona, false);
                                
                            } catch (retryError) {
                                console.error('Error retrying:', retryError);
                                showError(personaPanel, errorMessage);
                            } finally {
                                personaLoading.classList.add('hidden');
                            }
                        });
                        
                        showError(personaPanel, errorContainer);
                    }
                    
                } finally {
                    // Always hide loading and show input view
                    personaLoading.classList.add('hidden');
                    inputView.classList.remove('hidden');
                }
            }

            // Update all feedback view
            updateAllFeedbackView();
        });
    });
}

function markPersonaComplete(persona, isBasic = false) {
    const progressItem = document.querySelector(`.progress-item.${persona}`);
    if (progressItem) {
        progressItem.classList.add('complete');
        progressItem.textContent = `${PERSONAS[persona]} Feedback (${isBasic ? 'Basic Feedback' : 'Complete'})`;
    }

    const tab = document.querySelector(`.tab.${persona}`);
    if (tab) {
        tab.classList.remove('disabled');
    }

    // Only count properly parsed responses for enabling the All tab
    const allComplete = Object.keys(PERSONAS).some(p => 
        document.querySelector(`.progress-item.${p}`)?.classList.contains('complete')
    );
    if (allComplete) {
        const allTab = document.querySelector('.tab.all');
        if (allTab) {
            allTab.classList.remove('disabled');
        }
    }

    // If basic feedback, disable the checkbox in All view
    if (isBasic) {
        const checkbox = document.querySelector(`.persona-filters input[data-persona="${persona}"]`);
        if (checkbox) {
            checkbox.checked = false;
            checkbox.disabled = true;
            checkbox.parentElement.classList.add('disabled');
        }
    }
}

function createBasicFeedbackDisplay(rawResponse, persona) {
    const panel = document.getElementById(persona);
    if (!panel) return;

    const inputView = panel.querySelector('.input-view');
    const feedbackView = panel.querySelector('.feedback-view');
    const basicFeedbackView = panel.querySelector('.basic-feedback-view');
    const detailedFeedbackView = panel.querySelector('.detailed-feedback-view');
    const basicFeedbackHeader = panel.querySelector('.basic-feedback-header');
    const basicFeedbackContent = panel.querySelector('.basic-feedback-content');

    if (!inputView || !feedbackView || !basicFeedbackView || !detailedFeedbackView || 
        !basicFeedbackHeader || !basicFeedbackContent) return;

    // Hide input view and detailed feedback view, show basic feedback view
    inputView.classList.add('hidden');
    feedbackView.classList.remove('hidden');
    basicFeedbackView.classList.remove('hidden');
    detailedFeedbackView.classList.add('hidden');

    // Set header and content
    basicFeedbackHeader.textContent = `${PERSONAS[persona]} was unable to give detailed feedback, however their comments are below:`;
    basicFeedbackContent.textContent = rawResponse;

    // Setup debug button
    const debugBtn = panel.querySelector('.debug-btn');
    if (debugBtn) {
        // Remove any existing listeners
        const newDebugBtn = debugBtn.cloneNode(true);
        debugBtn.parentNode.replaceChild(newDebugBtn, debugBtn);
        
        newDebugBtn.addEventListener('click', () => {
            debugMode[persona] = !debugMode[persona];
            newDebugBtn.textContent = debugMode[persona] ? 'Hide Debug Info' : 'Show Debug Info';
            
            const existingDebug = panel.querySelector('.debug-info');
            if (debugMode[persona]) {
                if (!existingDebug) {
                    const debugInfo = document.createElement('div');
                    debugInfo.className = 'debug-info';
                    debugInfo.innerHTML = `
                        <h3>Raw LLM Response:</h3>
                        <pre>${rawResponses[persona] || 'No raw response available'}</pre>
                    `;
                    feedbackView.insertBefore(debugInfo, feedbackView.firstChild);
                }
            } else if (existingDebug) {
                existingDebug.remove();
            }
        });
    }
}

function createFeedbackDisplay(feedback, persona) {
    const panel = document.getElementById(persona);
    if (!panel) return;

    const inputView = panel.querySelector('.input-view');
    const feedbackView = panel.querySelector('.feedback-view');
    const basicFeedbackView = panel.querySelector('.basic-feedback-view');
    const detailedFeedbackView = panel.querySelector('.detailed-feedback-view');
    const documentContent = panel.querySelector('.document-content');
    const snippetCommentsContent = panel.querySelector('.snippet-comments-content');
    const scoresContent = panel.querySelector('.scores-content');
    const generalCommentsContent = panel.querySelector('.general-comments-content');

    if (!inputView || !feedbackView || !basicFeedbackView || !detailedFeedbackView || 
        !documentContent || !snippetCommentsContent || !scoresContent || !generalCommentsContent) return;

    // Hide input view and basic feedback view, show detailed feedback view
    inputView.classList.add('hidden');
    feedbackView.classList.remove('hidden');
    basicFeedbackView.classList.add('hidden');
    detailedFeedbackView.classList.remove('hidden');

    // Display document content
    documentContent.innerHTML = currentText;

    // Add score bars
    scoresContent.innerHTML = '';
    for (const [criterion, score] of Object.entries(feedback.scores)) {
        const scoreClass = score < 70 ? 'low' : score < 85 ? 'medium' : 'high';
        scoresContent.innerHTML += `
            <div class="score-bar">
                <div class="score-label">
                    <span class="criterion-name">${criterion.charAt(0).toUpperCase() + criterion.slice(1)}</span>
                </div>
                <div class="score-progress">
                    <div class="score-fill ${scoreClass}" style="width: ${score}%"></div>
                    <div class="score-value">${score}%</div>
                </div>
            </div>
        `;
    }

    // Add general comments
    generalCommentsContent.innerHTML = '';
    if (feedback.generalComments) {
        feedback.generalComments.forEach(comment => {
            const commentEl = document.createElement('div');
            commentEl.className = `comment ${persona}`;
            commentEl.textContent = comment;
            generalCommentsContent.appendChild(commentEl);
        });
    }

    // Setup debug button
    const debugBtn = panel.querySelector('.debug-btn');
    if (debugBtn) {
        // Remove any existing listeners
        const newDebugBtn = debugBtn.cloneNode(true);
        debugBtn.parentNode.replaceChild(newDebugBtn, debugBtn);
        
        newDebugBtn.addEventListener('click', () => {
            debugMode[persona] = !debugMode[persona];
            newDebugBtn.textContent = debugMode[persona] ? 'Hide Debug Info' : 'Show Debug Info';
            
            const existingDebug = panel.querySelector('.debug-info');
            if (debugMode[persona]) {
                if (!existingDebug) {
                    const debugInfo = document.createElement('div');
                    debugInfo.className = 'debug-info';
                    debugInfo.innerHTML = `
                        <h3>Raw LLM Response:</h3>
                        <pre>${rawResponses[persona] || 'No raw response available'}</pre>
                    `;
                    feedbackView.insertBefore(debugInfo, feedbackView.firstChild);
                }
            } else if (existingDebug) {
                existingDebug.remove();
            }
        });
    }
}

function resetProgress() {
    document.querySelectorAll('.progress-item').forEach(item => {
        const persona = item.classList[1];
        item.classList.remove('complete');
        item.textContent = `${PERSONAS[persona]} Feedback`;
    });

    document.querySelectorAll('.tab:not(.documents)').forEach(tab => {
        tab.classList.add('disabled');
    });

    switchTab('documents');
    const documentsTab = document.getElementById('documents');
    if (documentsTab) {
        const inputSection = documentsTab.querySelector('.input-section');
        const controls = documentsTab.querySelector('.controls');
        if (inputSection) inputSection.style.display = 'flex';
        if (controls) controls.style.display = 'flex';
    }
}

function showError(panel, message) {
    if (!panel) return;

    const inputView = panel.querySelector('.input-view');
    const feedbackView = panel.querySelector('.feedback-view');
    const documentContent = panel.querySelector('.document-content');
    
    if (inputView) inputView.classList.remove('hidden');
    if (feedbackView) feedbackView.classList.add('hidden');
    
    const errorEl = document.createElement('div');
    errorEl.className = 'error-message';
    if (message instanceof Element) {
        errorEl.appendChild(message);
    } else {
        errorEl.textContent = message;
    }
    
    if (documentContent) {
        documentContent.innerHTML = '';
        documentContent.appendChild(errorEl);
    }
}

function setupDocumentControls() {
    // Tab switching
    if (tabsList) {
        tabsList.addEventListener('click', (e) => {
            if (e.target.classList.contains('tab')) {
                switchTab(e.target.dataset.tab);
            }
        });
    }

    // Setup persona filters
    document.querySelectorAll('.persona-filters input[type="checkbox"]').forEach(checkbox => {
        checkbox.addEventListener('change', () => {
            const persona = checkbox.dataset.persona;
            const isVisible = checkbox.checked;
            
            // Toggle visibility of highlights and comments
            document.querySelectorAll(`.highlight[data-personas*="${persona}"]`).forEach(el => {
                el.style.opacity = isVisible ? '1' : '0';
                el.style.pointerEvents = isVisible ? 'auto' : 'none';
            });
            
            document.querySelectorAll(`.comment.${persona}`).forEach(el => {
                el.style.display = isVisible ? '' : 'none';
            });
        });
    });

    // Setup general comments tabs
    const generalCommentsTabs = document.getElementById('generalCommentsTabs');
    if (generalCommentsTabs) {
        generalCommentsTabs.addEventListener('click', (e) => {
            if (e.target.classList.contains('tab')) {
                document.querySelectorAll('#generalCommentsTabs .tab').forEach(tab => {
                    tab.classList.remove('active');
                });
                e.target.classList.add('active');
                updateGeneralComments(e.target.dataset.persona);
            }
        });
    }

    // Initialize prompts
    initializePrompts();
    setupPromptHandlers();

    // Handle streaming responses
    ipcRenderer.on('stream-response', (event, { chunk, persona }) => {
        const panel = document.getElementById(persona);
        if (!panel) return;

        const documentContent = panel.querySelector('.document-content');
        if (!documentContent) return;

        if (documentContent.textContent === '') {
            documentContent.textContent = chunk;
        } else {
            documentContent.textContent += chunk;
        }
    });
}

// Settings button handler
if (settingsBtn) {
    settingsBtn.addEventListener('click', () => {
        if (mainView) mainView.classList.add('hidden');
        if (settingsView) settingsView.classList.remove('hidden');
    });
}

// Initialize UI
document.addEventListener('DOMContentLoaded', () => {
    setupFileUploadHandlers();
    setupSubmitHandlers();
    setupDocumentControls();
    initializePrompts();
    setupPromptHandlers();
    
    // Load models after UI is ready
    loadModels();
    
    // Add settings change handlers
    if (modelSelect) {
        modelSelect.addEventListener('change', saveSettings);
    }
    
    [contextWindow, timeout, stream, temperature].forEach(element => {
        if (element) {
            element.addEventListener('change', saveSettings);
        }
    });

    if (temperature) {
        temperature.addEventListener('input', (e) => {
            if (temperatureValue) {
                temperatureValue.textContent = e.target.value;
            }
        });
    }
});

// Add error message styles
const style = document.createElement('style');
style.textContent = `
    .error-message {
        color: #d0021b;
        padding: 15px;
        background: #fff;
        border-radius: 4px;
        border-left: 4px solid #d0021b;
        margin: 10px 0;
    }
`;
document.head.appendChild(style);

// Sync text across panels
document.querySelectorAll('.input-text').forEach(textarea => {
    textarea.addEventListener('input', (e) => {
        const text = e.target.value;
        document.querySelectorAll('.input-text').forEach(otherTextarea => {
            if (otherTextarea !== e.target) {
                otherTextarea.value = text;
            }
        });
        resetProgress();
    });
});

// Initialize prompts
async function initializePrompts() {
    try {
        const systemPromptText = await getDefaultSystemPrompt();
        if (systemPrompt) {
            systemPrompt.value = systemPromptText;
        }

        for (const persona of Object.keys(PERSONAS)) {
            const promptTextarea = document.getElementById(`${persona}Prompt`);
            if (promptTextarea) {
                const promptText = await getDefaultPersonaPrompt(persona);
                promptTextarea.value = promptText;
            }
        }
    } catch (error) {
        console.error('Error initializing prompts:', error);
    }
}

function setupPromptHandlers() {
    // Reset prompt buttons
    document.querySelectorAll('.reset-prompt').forEach(button => {
        button.addEventListener('click', async () => {
            const persona = button.dataset.persona;
            const promptType = persona || button.dataset.prompt;
            if (!promptType) return;

            try {
                const defaultPrompt = await ipcRenderer.invoke('read-prompt', {
                    type: promptType,
                    isDefault: true
                });

                const textarea = document.getElementById(`${promptType}Prompt`);
                if (textarea) {
                    textarea.value = defaultPrompt;
                }
            } catch (error) {
                console.error('Error resetting prompt:', error);
            }
        });
    });

    // Save prompts when changed
    document.querySelectorAll('.system-prompt').forEach(textarea => {
        textarea.addEventListener('change', async () => {
            const persona = textarea.dataset.persona;
            const promptType = persona || textarea.id.replace('Prompt', '');
            
            try {
                await ipcRenderer.invoke('write-prompt', {
                    type: promptType,
                    content: textarea.value
                });
            } catch (error) {
                console.error('Error saving prompt:', error);
            }
        });
    });
}

function updateAllFeedbackView() {
    const documentContent = document.querySelector('#all .document-content');
    const snippetCommentsContent = document.querySelector('#all .snippet-comments-content');
    const generalCommentsContent = document.querySelector('#all .general-comments-content');

    if (!documentContent || !snippetCommentsContent || !generalCommentsContent) return;

    // Display document content
    documentContent.innerHTML = currentText;

    // Clear existing comments
    snippetCommentsContent.innerHTML = '';
    generalCommentsContent.innerHTML = '';

    // Add comments from each persona
    for (const persona of Object.keys(PERSONAS)) {
        const feedback = feedbackData[persona];
        if (!feedback) continue;

        // Add general comments
        if (feedback.generalComments) {
            const personaHeader = document.createElement('div');
            personaHeader.className = `persona-header ${persona}`;
            personaHeader.textContent = PERSONAS[persona];
            generalCommentsContent.appendChild(personaHeader);

            feedback.generalComments.forEach(comment => {
                const commentEl = document.createElement('div');
                commentEl.className = `comment ${persona}`;
                commentEl.textContent = comment;
                generalCommentsContent.appendChild(commentEl);
            });
        }
    }
}

// Load models
loadModels();
if (modelSelect) {
    modelSelect.addEventListener('change', saveSettings);
}
