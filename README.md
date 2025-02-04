# HelloLlama

A simple Electron application that interfaces with Ollama's llama3 model for text processing.

## Prerequisites

- Node.js and npm installed
- [Ollama](https://ollama.ai/) installed and running with llama3 model

## Installation

1. Clone this repository:
```bash
git clone https://github.com/Copernican-Consulting/HelloLlama.git
cd HelloLlama
```

2. Install dependencies:
```bash
npm install
```

## Usage

1. Make sure Ollama is running with llama3 model installed:
```bash
ollama run llama3
```

2. Start the application:
```bash
npm start
```

## Features

- Direct text input through a text area
- File upload support for multiple formats (.txt, .pdf, .doc, .docx)
- Real-time processing status
- Clean, modern user interface
- Error handling and user feedback

## Development

This application is built with:
- Electron
- Node.js
- HTML/CSS/JavaScript

## License

ISC
