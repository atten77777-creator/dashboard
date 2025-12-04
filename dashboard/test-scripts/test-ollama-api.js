// Test script for Ollama local API (completely free, no API key needed)
const http = require('http');

// Ollama runs locally on port 11434 by default
// Install Ollama from: https://ollama.ai/
// Then run: ollama pull llama2 (or any other model)
const OLLAMA_URL = 'http://localhost:11434/api/generate';
const MODEL = 'llama2'; // You can use llama2, codellama, mistral, etc.

const requestData = {
  model: MODEL,
  prompt: "Hello, can you confirm if this API connection is working properly?",
  stream: false
};

const options = {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  }
};

console.log('Testing Ollama local API...');
console.log(`Using model: ${MODEL}`);
console.log('Make sure Ollama is running locally with: ollama serve');

const req = http.request(OLLAMA_URL, options, (res) => {
  let data = '';
  
  res.on('data', (chunk) => {
    data += chunk;
  });
  
  res.on('end', () => {
    console.log(`Status code: ${res.statusCode}`);
    
    if (res.statusCode === 200) {
      console.log('✅ Ollama API is working!');
      try {
        const response = JSON.parse(data);
        console.log('\nResponse:');
        console.log(response.response);
      } catch (e) {
        console.log('Response (raw):', data);
      }
    } else {
      console.log('❌ Ollama API request failed');
      console.log('\nError details:');
      console.log(data);
    }
  });
});

req.on('error', (error) => {
  console.error('Error making request:', error);
  console.log('\nMake sure Ollama is installed and running:');
  console.log('1. Download from: https://ollama.ai/');
  console.log('2. Run: ollama serve');
  console.log('3. Run: ollama pull llama2');
});

req.write(JSON.stringify(requestData));
req.end();