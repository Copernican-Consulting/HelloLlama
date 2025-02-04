const { ipcRenderer } = require('electron');

const inputText = document.getElementById('inputText');
const fileInput = document.getElementById('fileInput');
const submitBtn = document.getElementById('submitBtn');
const loading = document.getElementById('loading');
const output = document.getElementById('output');

// Handle file upload
fileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (file) {
        try {
            const text = await file.text();
            inputText.value = text;
        } catch (error) {
            console.error('Error reading file:', error);
            output.textContent = 'Error reading file: ' + error.message;
        }
    }
});

// Handle text submission
submitBtn.addEventListener('click', async () => {
    const text = inputText.value.trim();
    if (!text) {
        output.textContent = 'Please enter some text or upload a file.';
        return;
    }

    try {
        loading.classList.remove('hidden');
        output.textContent = '';
        
        const response = await ipcRenderer.invoke('process-text', text);
        output.textContent = response;
    } catch (error) {
        console.error('Error processing text:', error);
        output.textContent = 'Error processing text: ' + error.message;
    } finally {
        loading.classList.add('hidden');
    }
});
