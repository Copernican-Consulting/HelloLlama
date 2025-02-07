const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');
const os = require('os');

function downloadFile(url, dest) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(dest);
        https.get(url, (response) => {
            response.pipe(file);
            file.on('finish', () => {
                file.close();
                resolve();
            });
        }).on('error', (err) => {
            fs.unlink(dest, () => {
                reject(err);
            });
        });
    });
}

async function installOllama() {
    const platform = os.platform();
    const tempDir = os.tmpdir();
    
    try {
        if (platform === 'win32') {
            // Windows installation
            const installerPath = path.join(tempDir, 'ollama-installer.exe');
            console.log('Downloading Ollama for Windows...');
            await downloadFile('https://ollama.ai/download/windows', installerPath);
            
            console.log('Installing Ollama...');
            execSync(`"${installerPath}" /S`); // Silent install
            
            // Wait for service to start
            console.log('Waiting for Ollama service to start...');
            await new Promise(resolve => setTimeout(resolve, 10000));
            
        } else if (platform === 'darwin') {
            // macOS installation
            console.log('Installing Ollama via Homebrew...');
            try {
                execSync('which brew');
            } catch {
                throw new Error('Homebrew is required for installation. Please install Homebrew first.');
            }
            
            execSync('brew install ollama');
            execSync('brew services start ollama');
            
            // Wait for service to start
            console.log('Waiting for Ollama service to start...');
            await new Promise(resolve => setTimeout(resolve, 5000));
        }
        
        // Pull the llama3 model
        console.log('Pulling llama3:latest model...');
        execSync('ollama pull llama3:latest');
        
        console.log('Ollama installation and model setup completed successfully!');
        
    } catch (error) {
        console.error('Error during Ollama installation:', error);
        throw error;
    }
}

// Run the installation
installOllama().catch(console.error);
