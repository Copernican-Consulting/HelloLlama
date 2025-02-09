const { ipcRenderer } = require('electron');
const mammoth = require('mammoth');

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

function getDefaultPrompt(persona) {
    return `You are a ${PERSONAS[persona]}. Analyze the following document and respond ONLY with a JSON object in this exact format:

{
    "scores": {
        "clarity": 85,
        "tone": 90,
        "alignment": 75,
        "efficiency": 80,
        "completeness": 95
    },
    "snippetFeedback": [
        {
            "snippet": "paste the exact text you're commenting on here",
            "comment": "your specific feedback about this text"
        }
    ],
    "generalComments": [
        "Your first general comment about the document",
        "Your second general comment if needed"
    ]
}

Important rules:
1. Your entire response must be valid JSON - do not include any text before or after the JSON
2. All scores must be numbers between 0 and 100
3. snippetFeedback must contain exact quotes from the document
4. Do not use line breaks within comment strings
5. Escape any quotes within strings
6. Keep snippet selections focused and specific
7. Provide 2-4 general comments
8. Include 2-5 snippet feedback items

Remember: Respond ONLY with the JSON object - no other text.`;
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
            const input = panel.querySelector('.input-text');

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
            const text = panel.querySelector('.input-text').value.trim();
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

                    const currentSettings = {
                        model: modelSelect.value,
                        contextWindow: parseInt(contextWindow.value),
                        timeout: parseInt(timeout.value),
                        stream: false,
                        temperature: parseFloat(temperature.value),
                        systemPrompt: document.getElementById(`${persona}Prompt`)?.value || getDefaultPrompt(persona),
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
                    const parsedResponse = JSON.parse(response);
                    feedbackData[persona] = parsedResponse;
                    
                    // Update feedback display
                    createFeedbackDisplay(parsedResponse, persona);
                    
                    // Update progress and enable tab
                    markPersonaComplete(persona);
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
                        errorMessage = 'Error processing text: ' + error.message;
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
                            
                            // Store raw response for debugging
                            rawResponses[persona] = response;
                            const parsedResponse = JSON.parse(response);
                            feedbackData[persona] = parsedResponse;
                            
                            // Update feedback display
                            createFeedbackDisplay(parsedResponse, persona);
                            
                            // Update progress and enable tab
                            markPersonaComplete(persona);
                            
                            // Update all feedback view if all personas are complete
                            const allComplete = Object.keys(PERSONAS).every(p => 
                                document.querySelector(`.progress-item.${p}`)?.classList.contains('complete')
                            );
                            if (allComplete) {
                                updateAllFeedbackView();
                            }
                        } catch (retryError) {
                            console.error('Error retrying:', retryError);
                            showError(personaPanel, errorMessage);
                        } finally {
                            personaLoading.classList.add('hidden');
                        }
                    });
                    
                    showError(personaPanel, errorContainer);
                } finally {
                    personaLoading.classList.add('hidden');
                    inputView.classList.remove('hidden');
                }
            }

            // Update all feedback view
            updateAllFeedbackView();
        });
    });
}

function createFeedbackDisplay(feedback, persona, rawResponse = null) {
    const panel = document.getElementById(persona);
    if (!panel) return;

    const inputView = panel.querySelector('.input-view');
    const feedbackView = panel.querySelector('.feedback-view');
    const documentContent = panel.querySelector('.document-content');
    const snippetCommentsContent = panel.querySelector('.snippet-comments-content');
    const scoresContent = panel.querySelector('.scores-content');
    const generalCommentsContent = panel.querySelector('.general-comments-content');

    if (!inputView || !feedbackView || !documentContent || !snippetCommentsContent || 
        !scoresContent || !generalCommentsContent) return;

    // Hide input view and show feedback view
    inputView.classList.add('hidden');
    feedbackView.classList.remove('hidden');

    // Calculate line heights and positions
    const tempSpan = document.createElement('span');
    tempSpan.style.visibility = 'hidden';
    tempSpan.style.whiteSpace = 'pre-wrap';
    tempSpan.textContent = 'X';
    documentContent.appendChild(tempSpan);
    const lineHeight = tempSpan.offsetHeight;
    tempSpan.remove();

    // Setup debug button
    const debugBtn = panel.querySelector('.debug-btn');
    if (debugBtn) {
        // Remove any existing listeners
        const newDebugBtn = debugBtn.cloneNode(true);
        debugBtn.parentNode.replaceChild(newDebugBtn, debugBtn);
        
        newDebugBtn.addEventListener('click', () => {
            debugMode[persona] = !debugMode[persona];
            newDebugBtn.textContent = debugMode[persona] ? 'Hide Debug Info' : 'Show Debug Info';
            
            // Toggle debug info display
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

    // Display document with highlights
    documentContent.innerHTML = currentText;
    
    // Add snippet comments with vertical positioning
    snippetCommentsContent.innerHTML = '';
    if (feedback.snippetFeedback) {
        const sortedSnippets = feedback.snippetFeedback
            .map(({ snippet, comment }) => {
                const index = currentText.indexOf(snippet);
                // Calculate vertical position based on text before the snippet
                const textBefore = currentText.substring(0, index);
                const lines = textBefore.split('\n');
                const verticalOffset = lines.length * lineHeight;
                
                return {
                    snippet,
                    comment,
                    index,
                    verticalOffset
                };
            })
            .filter(item => item.index !== -1)
            .sort((a, b) => a.index - b.index);

        let result = '';
        const highlights = [];
        
        sortedSnippets.forEach(({ snippet, comment, index, verticalOffset }) => {
            highlights.push({
                start: index,
                end: index + snippet.length,
                snippet,
                comment,
                persona,
                verticalOffset
            });

            // Create a temporary container to measure text height
            const tempContainer = document.createElement('div');
            tempContainer.style.cssText = `
                position: absolute;
                visibility: hidden;
                width: ${documentContent.clientWidth}px;
                white-space: pre-wrap;
                line-height: 1.6;
                padding: 20px;
                font-family: inherit;
                font-size: inherit;
            `;
            documentContent.appendChild(tempContainer);
            
            // Calculate the highlight's position
            const textBefore = currentText.substring(0, index);
            tempContainer.textContent = textBefore;
            const highlightTop = tempContainer.offsetHeight;
            
            // Get the total height of the document
            tempContainer.textContent = currentText;
            const documentHeight = tempContainer.offsetHeight;
            
            // Calculate percentage position
            const highlightPosition = (highlightTop / documentHeight) * 100;
            
            // Clean up
            tempContainer.remove();
            
            // Create and position the comment
            const commentEl = document.createElement('div');
            commentEl.className = `comment ${persona}`;
            commentEl.setAttribute('data-highlight-id', `${persona}-${index}`);
            
            // Track the last comment's position
            const lastComment = snippetCommentsContent.lastElementChild;
            let topPosition = `${highlightPosition}%`;
            
            if (lastComment) {
                const lastRect = lastComment.getBoundingClientRect();
                const containerRect = snippetCommentsContent.getBoundingClientRect();
                const lastBottom = lastRect.bottom - containerRect.top;
                const newTop = (highlightPosition / 100) * containerRect.height;
                
                // If this comment would overlap with the previous one, position it below
                if (newTop < lastBottom + 15) {
                    topPosition = `${lastBottom + 15}px`;
                }
            }
            
            commentEl.style.top = topPosition;
            commentEl.innerHTML = `
                <div class="comment-text">${comment}</div>
                <div class="snippet-preview">Referenced text: "${snippet}"</div>
            `;
            snippetCommentsContent.appendChild(commentEl);
        });

        // Sort highlights by start position
        highlights.sort((a, b) => a.start - b.start);

        // Build the result text with all highlights
        let currentPosition = 0;
        
        highlights.forEach(highlight => {
            // Add text before this highlight
            if (highlight.start > currentPosition) {
                result += currentText.substring(currentPosition, highlight.start);
            }
            
            // Add the highlighted text
            result += `<span class="highlight ${persona}" data-comment-id="${persona}-${highlight.start}">${highlight.snippet}</span>`;
            
            // Update currentPosition only if this highlight extends beyond previous ones
            currentPosition = Math.max(currentPosition, highlight.end);
        });
        
        // Add any remaining text
        if (currentPosition < currentText.length) {
            result += currentText.substring(currentPosition);
        }
        documentContent.innerHTML = result;
    }

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

    // Add general comments with count
    generalCommentsContent.innerHTML = '';
    if (feedback.generalComments) {
        feedback.generalComments.forEach(comment => {
            const commentEl = document.createElement('div');
            commentEl.className = `comment ${persona}`;
            commentEl.textContent = comment;
            generalCommentsContent.appendChild(commentEl);
        });
    }

    // Update specific feedback count
    const snippetCommentsTitle = panel.querySelector('.snippet-comments h3');
    if (snippetCommentsTitle && feedback.snippetFeedback) {
        const validSnippets = feedback.snippetFeedback
            .filter(({ snippet }) => currentText.indexOf(snippet) !== -1);
        const count = validSnippets.length;
        snippetCommentsTitle.innerHTML = `Specific Feedback <span class="comment-count">(${count} comments)</span>`;
    }

    // Setup interactions with smooth scrolling
    setupFeedbackInteractions(panel, persona);
    
    // Add click-to-comment functionality
    panel.querySelectorAll('.highlight').forEach(highlight => {
        highlight.style.cursor = 'pointer';
        highlight.addEventListener('click', () => {
            const commentId = highlight.dataset.commentId;
            const comment = panel.querySelector(`.comment[data-highlight-id="${commentId}"]`);
            if (comment) {
                comment.scrollIntoView({ behavior: 'smooth', block: 'center' });
                comment.classList.add('active');
                setTimeout(() => comment.classList.remove('active'), 2000);
            }
        });
    });
}

function setupFeedbackInteractions(panel, persona) {
    // Highlight interactions
    panel.querySelectorAll('.highlight').forEach(highlight => {
        highlight.addEventListener('click', () => {
            const commentId = highlight.dataset.commentId;
            const comment = panel.querySelector(`.comment[data-highlight-id="${commentId}"]`);
            
            panel.querySelectorAll('.highlight.active, .comment.active').forEach(el => {
                el.classList.remove('active');
                el.removeAttribute('data-linked');
            });
            
            highlight.classList.add('active');
            highlight.setAttribute('data-linked', 'true');
            if (comment) {
                comment.classList.add('active');
                comment.setAttribute('data-linked', 'true');
                comment.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
        });
    });

    // Comment interactions
    panel.querySelectorAll('.comment').forEach(comment => {
        if (!comment.dataset.highlightId) return;
        
        comment.addEventListener('click', () => {
            const highlightId = comment.dataset.highlightId;
            const highlight = panel.querySelector(`.highlight[data-comment-id="${highlightId}"]`);
            
            panel.querySelectorAll('.highlight.active, .comment.active').forEach(el => {
                el.classList.remove('active');
                el.removeAttribute('data-linked');
            });
            
            comment.classList.add('active');
            comment.setAttribute('data-linked', 'true');
            if (highlight) {
                highlight.classList.add('active');
                highlight.setAttribute('data-linked', 'true');
                highlight.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        });
    });
}

function updateAllFeedbackView() {
    const panel = document.getElementById('all');
    if (!panel) return;

    const documentContent = panel.querySelector('.document-content');
    const snippetCommentsContent = panel.querySelector('.snippet-comments-content');
    const generalCommentsContent = panel.querySelector('.general-comments-content');
    const debugBtn = panel.querySelector('.debug-btn');

    if (!documentContent || !snippetCommentsContent || !generalCommentsContent) return;

    // Setup debug button for all tab
    if (debugBtn) {
        // Remove any existing listeners
        const newDebugBtn = debugBtn.cloneNode(true);
        debugBtn.parentNode.replaceChild(newDebugBtn, debugBtn);
        
        newDebugBtn.addEventListener('click', () => {
            debugMode.all = !debugMode.all;
            newDebugBtn.textContent = debugMode.all ? 'Hide Debug Info' : 'Show Debug Info';
            
            const existingDebug = panel.querySelector('.debug-info');
            if (debugMode.all) {
                if (!existingDebug) {
                    const debugInfo = document.createElement('div');
                    debugInfo.className = 'debug-info';
                    let debugContent = '<h3>Raw LLM Responses:</h3>';
                    
                    // Add responses from all personas
                    Object.entries(rawResponses).forEach(([persona, response]) => {
                        debugContent += `
                            <h4>${PERSONAS[persona]}:</h4>
                            <pre>${response || 'No response available'}</pre>
                        `;
                    });
                    
                    debugInfo.innerHTML = debugContent;
                    panel.querySelector('.feedback-view').insertBefore(debugInfo, panel.querySelector('.all-feedback-container'));
                }
            } else if (existingDebug) {
                existingDebug.remove();
            }
        });
    }

    // Clear existing content
    documentContent.innerHTML = currentText;
    snippetCommentsContent.innerHTML = '';
    generalCommentsContent.innerHTML = '';

    if (!currentText) return;

    // Collect all highlights and find overlapping regions
    const regions = [];
    for (const [persona, feedback] of Object.entries(feedbackData)) {
        if (!feedback.snippetFeedback) continue;
        
        feedback.snippetFeedback.forEach(({ snippet, comment }) => {
            const index = currentText.indexOf(snippet);
            if (index !== -1) {
                // Check for existing overlapping regions
                let overlapped = false;
                for (const region of regions) {
                    // Check if this snippet overlaps with an existing region
                    if (index < region.end && region.start < (index + snippet.length)) {
                        // Extend region boundaries if needed
                        region.start = Math.min(region.start, index);
                        region.end = Math.max(region.end, index + snippet.length);
                        // Add the new persona and comment if not already present
                        if (!region.personas.includes(persona)) {
                            region.personas.push(persona);
                        }
                        region.comments.push({ persona, comment });
                        // Update the snippet to cover the entire region
                        region.snippet = currentText.substring(region.start, region.end);
                        overlapped = true;
                        break;
                    }
                }
                
                // If no overlap found, create new region
                if (!overlapped) {
                    regions.push({
                        start: index,
                        end: index + snippet.length,
                        personas: [persona],
                        snippet,
                        comments: [{ persona, comment }]
                    });
                }
            }
        });
    }

    // Sort regions by start position
    regions.sort((a, b) => a.start - b.start);

    // Build the result text with all highlights
    let result = '';
    let currentPosition = 0;

    regions.forEach(region => {
        // Add text before this highlight
        if (region.start > currentPosition) {
            result += currentText.substring(currentPosition, region.start);
        }

        // Sort personas for consistent class names and data attribute
        const personaList = region.personas.sort().join(',');
        const highlightId = `${personaList}-${region.start}`;

        // Add the highlighted text with data-personas attribute
        result += `<span class="highlight" 
            data-personas="${personaList}" 
            data-comment-id="${highlightId}"
            data-comments='${JSON.stringify(region.comments)}'
        >${region.snippet}</span>`;

        currentPosition = region.end;
    });

    // Add any remaining text
    if (currentPosition < currentText.length) {
        result += currentText.substring(currentPosition);
    }

    documentContent.innerHTML = result;

    // Add comments for all regions
    regions.forEach(region => {
        region.comments.forEach(({ persona, comment }) => {
            const personaList = region.personas.sort().join(',');
            const highlightId = `${personaList}-${region.start}`;
            const commentEl = document.createElement('div');
            commentEl.className = `comment ${persona}`;
            commentEl.setAttribute('data-highlight-id', highlightId);
            commentEl.innerHTML = `
                <div class="comment-text">${comment}</div>
                <div class="snippet-preview">"${region.snippet}"</div>
                ${region.personas.length > 1 ? `
                    <div class="overlap-info">
                        <small>Part of overlapping feedback from: ${region.personas.map(p => PERSONAS[p]).join(', ')}</small>
                    </div>
                ` : ''}
            `;
            snippetCommentsContent.appendChild(commentEl);
        });
    });

    setupAllFeedbackInteractions();

    // Group general comments by persona in All tab
    const personaGroups = {};
    Object.entries(feedbackData).forEach(([persona, feedback]) => {
        if (feedback.generalComments && feedback.generalComments.length > 0) {
            personaGroups[persona] = feedback.generalComments;
        }
    });

    Object.entries(personaGroups).forEach(([persona, comments]) => {
        // Add persona header
        const headerEl = document.createElement('div');
        headerEl.className = `persona-header ${persona}`;
        headerEl.textContent = PERSONAS[persona];
        generalCommentsContent.appendChild(headerEl);

        // Add comments for this persona
        comments.forEach(comment => {
            const commentEl = document.createElement('div');
            commentEl.className = `comment ${persona}`;
            commentEl.textContent = comment;
            generalCommentsContent.appendChild(commentEl);
        });
    });

    // Restore filter states
    document.querySelectorAll('.persona-filters input[type="checkbox"]').forEach(checkbox => {
        const persona = checkbox.dataset.persona;
        const isVisible = checkbox.checked;
        
        document.querySelectorAll(`.highlight.${persona}`).forEach(el => {
            el.style.opacity = isVisible ? '1' : '0';
            el.style.pointerEvents = isVisible ? 'auto' : 'none';
        });
        
        document.querySelectorAll(`.comment.${persona}`).forEach(el => {
            el.style.display = isVisible ? '' : 'none';
        });
    });
}

function setupAllFeedbackInteractions() {
    // Highlight click handler
    document.querySelectorAll('.document-content .highlight').forEach(highlight => {
        highlight.addEventListener('click', () => {
            const commentId = highlight.dataset.commentId;
            const comments = document.querySelectorAll(`.comment[data-highlight-id="${commentId}"]`);
            
            // Remove active state from all elements
            document.querySelectorAll('.highlight.active, .comment.active').forEach(el => {
                el.classList.remove('active');
                el.removeAttribute('data-linked');
            });
            
            // Activate highlight and comments
            highlight.classList.add('active');
            highlight.setAttribute('data-linked', 'true');
            
            comments.forEach(comment => {
                comment.classList.add('active');
                comment.setAttribute('data-linked', 'true');
            });
            
            // Find the first visible comment
            const visibleComments = Array.from(comments).filter(comment => 
                comment.style.display !== 'none'
            );
            
            // Scroll to the first visible comment
            if (visibleComments.length > 0) {
                const comment = visibleComments[0];
                const container = document.querySelector('#all .all-feedback-container');
                if (container) {
                    // Get the container's scroll position and dimensions
                    const containerRect = container.getBoundingClientRect();
                    const commentRect = comment.getBoundingClientRect();
                    
                    // Calculate if comment is in view
                    const isInView = (
                        commentRect.top >= containerRect.top &&
                        commentRect.bottom <= containerRect.bottom
                    );
                    
                    // If not in view, scroll to it
                    if (!isInView) {
                        comment.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }
                }
            }
        });
    });

    // Comment click handler
    document.querySelectorAll('.snippet-comments-content .comment').forEach(comment => {
        comment.addEventListener('click', () => {
            const highlightId = comment.dataset.highlightId;
            const highlight = document.querySelector(`.highlight[data-comment-id="${highlightId}"]`);
            
            // Remove active state from all elements
            document.querySelectorAll('.highlight.active, .comment.active').forEach(el => {
                el.classList.remove('active');
                el.removeAttribute('data-linked');
            });
            
            // Activate comment and highlight
            comment.classList.add('active');
            comment.setAttribute('data-linked', 'true');
            if (highlight) {
                highlight.classList.add('active');
                highlight.setAttribute('data-linked', 'true');
                
                const container = document.querySelector('#all .all-feedback-container');
                if (container) {
                    // Get the container's scroll position and dimensions
                    const containerRect = container.getBoundingClientRect();
                    const highlightRect = highlight.getBoundingClientRect();
                    
                    // Calculate if highlight is in view
                    const isInView = (
                        highlightRect.top >= containerRect.top &&
                        highlightRect.bottom <= containerRect.bottom
                    );
                    
                    // If not in view, scroll to it
                    if (!isInView) {
                        highlight.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }
                }
            }
        });
    });
}

// Setup persona filters
document.querySelectorAll('.persona-filters input[type="checkbox"]').forEach(checkbox => {
    checkbox.addEventListener('change', () => {
        const persona = checkbox.dataset.persona;
        const isVisible = checkbox.checked;
        
        // Toggle visibility of highlights and comments
        document.querySelectorAll(`.highlight.${persona}`).forEach(el => {
            el.style.opacity = isVisible ? '1' : '0';
            el.style.pointerEvents = isVisible ? 'auto' : 'none';
        });
        
        document.querySelectorAll(`.comment.${persona}`).forEach(el => {
            el.style.display = isVisible ? '' : 'none';
        });
    });
});

function updateGeneralComments(persona) {
    const generalCommentsContent = document.querySelector('.general-comments-content');
    if (!generalCommentsContent) return;

    generalCommentsContent.innerHTML = '';

    if (feedbackData[persona]?.generalComments) {
        feedbackData[persona].generalComments.forEach(comment => {
            const commentEl = document.createElement('div');
            commentEl.className = `comment ${persona}`;
            commentEl.textContent = comment;
            generalCommentsContent.appendChild(commentEl);
        });
    }
}

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

// Initialize persona prompts
function initializePrompts() {
    Object.keys(PERSONAS).forEach(persona => {
        const promptElement = document.getElementById(`${persona}Prompt`);
        if (promptElement) {
            const savedPrompt = localStorage.getItem(`${persona}Prompt`);
            promptElement.value = savedPrompt || getDefaultPrompt(persona);
        }
    });
}

// Save persona prompts
function setupPromptHandlers() {
    document.querySelectorAll('.system-prompt').forEach(prompt => {
        prompt.addEventListener('change', () => {
            localStorage.setItem(`${prompt.dataset.persona}Prompt`, prompt.value);
        });
    });

    document.querySelectorAll('.reset-prompt').forEach(button => {
        button.addEventListener('click', () => {
            const persona = button.dataset.persona;
            const promptElement = document.getElementById(`${persona}Prompt`);
            if (promptElement) {
                promptElement.value = getDefaultPrompt(persona);
                localStorage.setItem(`${persona}Prompt`, promptElement.value);
            }
        });
    });
}

// Tab switching
if (tabsList) {
    tabsList.addEventListener('click', (e) => {
        if (e.target.classList.contains('tab')) {
            switchTab(e.target.dataset.tab);
        }
    });
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

function markPersonaComplete(persona) {
    const progressItem = document.querySelector(`.progress-item.${persona}`);
    if (progressItem) {
        progressItem.classList.add('complete');
        progressItem.textContent = `${PERSONAS[persona]} Feedback (Complete)`;
    }

    const tab = document.querySelector(`.tab.${persona}`);
    if (tab) {
        tab.classList.remove('disabled');
    }

    const allComplete = Object.keys(PERSONAS).every(p => 
        document.querySelector(`.progress-item.${p}`)?.classList.contains('complete')
    );
    if (allComplete) {
        const allTab = document.querySelector('.tab.all');
        if (allTab) {
            allTab.classList.remove('disabled');
        }
    }
}

// Document control handlers
function setupDocumentControls() {
    document.querySelectorAll('.document-controls').forEach(controls => {
        if (controls.closest('#documents')) {
            controls.style.display = 'flex';
        } else {
            controls.style.display = 'none';
        }
    });

    document.querySelectorAll('.new-doc-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.input-text').forEach(textarea => {
                textarea.value = '';
            });
            resetProgress();
            showInputView();
        });
    });

    document.querySelectorAll('.add-doc-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const currentText = document.querySelector('.input-text').value;
            document.querySelectorAll('.input-text').forEach(textarea => {
                textarea.value = currentText + '\n\n';
                textarea.focus();
                textarea.setSelectionRange(textarea.value.length, textarea.value.length);
            });
            resetProgress();
            showInputView();
        });
    });

    document.querySelectorAll('.edit-doc-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            resetProgress();
            showInputView();
        });
    });
}

function showInputView() {
    document.querySelectorAll('.tab-panel').forEach(panel => {
        const inputView = panel.querySelector('.input-view');
        const feedbackView = panel.querySelector('.feedback-view');
        const inputSection = panel.querySelector('.input-section');
        const controls = panel.querySelector('.controls');
        
        if (inputView && feedbackView) {
            inputView.classList.remove('hidden');
            feedbackView.classList.add('hidden');
            
            if (panel.id === 'documents') {
                if (inputSection) inputSection.style.display = 'flex';
                if (controls) controls.style.display = 'flex';
            }
        }
    });
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
    errorEl.textContent = message;
    
    if (documentContent) {
        documentContent.innerHTML = '';
        documentContent.appendChild(errorEl);
    }
}

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
        seed: seed.value
    };
    localStorage.setItem('settings', JSON.stringify(settings));
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

// View switching
if (settingsBtn) {
    settingsBtn.addEventListener('click', () => {
        if (mainView) mainView.classList.add('hidden');
        if (settingsView) settingsView.classList.remove('hidden');
    });
}

saveCloseBtn.addEventListener('click', () => {
    saveSettings();
    if (mainView) mainView.classList.remove('hidden');
    if (settingsView) settingsView.classList.add('hidden');
});

// Settings change handlers
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

// Load models from Ollama
async function loadModels() {
    if (!modelSelect) return;

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

// Initialize UI
setupFileUploadHandlers();
setupSubmitHandlers();
setupDocumentControls();
initializePrompts();
setupPromptHandlers();

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

// Initialize settings and load models
const settings = loadSettings();
applySettings(settings);
loadModels();
if (modelSelect) {
    modelSelect.addEventListener('change', saveSettings);
}
