// Simple script to test if a Gemini API key is working
const https = require('https');

const API_KEY = 'AIzaSyDjHX_eyv1UQfNAs5i_SE25zP2Z4BeA1XY';
const MODEL = 'gemini-2.5-flash';
const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${API_KEY}`;

const requestData = {
  contents: [
    {
      parts: [
        {
          text: "Hello, can you confirm if this API connection is working properly?"
        }
      ]
    }
  ],
  generationConfig: {
    temperature: 0.2,
    maxOutputTokens: 100
  }
};

const options = {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  }
};

console.log('Testing Gemini API key...');
console.log(`Using model: ${MODEL}`);

const req = https.request(API_URL, options, (res) => {
  let data = '';
  
  res.on('data', (chunk) => {
    data += chunk;
  });
  
  res.on('end', () => {
    console.log(`Status code: ${res.statusCode}`);
    
    if (res.statusCode === 200) {
      console.log('✅ API key is valid and working!');
      try {
        const response = JSON.parse(data);
        console.log('\nResponse preview:');
        if (response.candidates && response.candidates[0] && response.candidates[0].content) {
          console.log(response.candidates[0].content.parts[0].text.substring(0, 100) + '...');
        } else {
          console.log('Unexpected response structure');
        }
      } catch (e) {
        console.log('Error parsing response:', e.message);
      }
    } else {
      console.log('❌ API key validation failed');
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