// Test script for free OpenAI-compatible APIs
const https = require('https');

// Option 1: Together AI (free tier available)
// Get free API key from: https://api.together.xyz/
const TOGETHER_API_KEY = 'YOUR_TOGETHER_API_KEY_HERE';
const TOGETHER_URL = 'https://api.together.xyz/v1/chat/completions';

// Option 2: Groq (free tier available)
// Get free API key from: https://console.groq.com/
const GROQ_API_KEY = 'YOUR_GROQ_API_KEY_HERE';
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

// Using Together AI by default (change to GROQ if preferred)
const API_KEY = TOGETHER_API_KEY;
const API_URL = TOGETHER_URL;
const MODEL = 'mistralai/Mixtral-8x7B-Instruct-v0.1'; // Free model on Together AI

// For Groq, use: 'llama3-8b-8192' or 'mixtral-8x7b-32768'

const requestData = {
  model: MODEL,
  messages: [
    {
      role: "user",
      content: "Hello, can you confirm if this API connection is working properly?"
    }
  ],
  max_tokens: 100,
  temperature: 0.7
};

const options = {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${API_KEY}`,
    'Content-Type': 'application/json'
  }
};

console.log('Testing OpenAI-compatible API...');
console.log(`Using model: ${MODEL}`);
console.log(`API URL: ${API_URL}`);

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
        console.log(response.choices[0].message.content);
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