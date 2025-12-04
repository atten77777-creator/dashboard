// Test script for Hugging Face's free API
const https = require('https');

// Hugging Face provides free API access to many models
// You can get a free API token from: https://huggingface.co/settings/tokens
const API_TOKEN = 'YOUR_HF_TOKEN_HERE'; // Replace with your token
const MODEL = 'microsoft/DialoGPT-medium'; // Free conversational model
const API_URL = `https://api-inference.huggingface.co/models/${MODEL}`;

const requestData = {
  inputs: "Hello, can you confirm if this API connection is working properly?",
  parameters: {
    max_length: 100,
    temperature: 0.7
  }
};

const options = {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${API_TOKEN}`,
    'Content-Type': 'application/json'
  }
};

console.log('Testing Hugging Face API...');
console.log(`Using model: ${MODEL}`);

const req = https.request(API_URL, options, (res) => {
  let data = '';
  
  res.on('data', (chunk) => {
    data += chunk;
  });
  
  res.on('end', () => {
    console.log(`Status code: ${res.statusCode}`);
    
    if (res.statusCode === 200) {
      console.log('✅ API is working!');
      try {
        const response = JSON.parse(data);
        console.log('\nResponse:');
        console.log(response);
      } catch (e) {
        console.log('Response (raw):', data);
      }
    } else {
      console.log('❌ API request failed');
      console.log('\nError details:');
      try {
        const error = JSON.parse(data);
        console.log(error);
      } catch (e) {
        console.log(data);
      }
    }
  });
});

req.on('error', (error) => {
  console.error('Error making request:', error);
});

req.write(JSON.stringify(requestData));
req.end();