const { ipcRenderer } = require('electron');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const fs = require('fs');

const inputText = document.getElementById('inputText');
const fileInput = document.getElementById('fileInput');
const submitBtn = document.getElementById('submitBtn');
const loading = document.getElementById('loading');
const output = document.getElementById('output');

// Handle file upload
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

        inputText.value = text;
    } catch (error) {
        console.error('Error reading file:', error);
        output.textContent = 'Error reading file: ' + error.message;
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
