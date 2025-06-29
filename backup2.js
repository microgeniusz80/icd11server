const express = require('express');
const axios = require('axios');
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();

// Enable CORS with explicit configuration
app.use(cors({
    origin: '*', // or specify your frontend: 'http://localhost:4200'
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

// Handle preflight requests
app.options('*', cors());

app.use(bodyParser.json());

// IMPORTANT: For production, store these in environment variables (e.g., .env file)
// and access them using process.env.CLIENT_ID, process.env.CLIENT_SECRET
const clientId = 'c157b2fb-402f-44db-8af8-aa0029048d21_15f8a3f6-eae0-4057-8e93-0299739eaaea';
const clientSecret = 'OpENJjZ07u2vy0832ir9uCA/UGoZa0NJaGdcwAsPbG8=';

let cachedToken = null;
let tokenExpiry = 0; // Stores timestamp in seconds when the token expires

/**
 * Asynchronously obtains an authentication token from the ICD-11 API.
 * The token is cached and reused if not expired, to avoid unnecessary API calls.
 * @returns {Promise<string>} The access token.
 * @throws {Error} If token acquisition fails.
 */
async function getToken() {
    const now = Date.now() / 1000; // Current time in seconds
    // Check if cached token exists and is not expired (refresh 60 seconds before actual expiry)
    if (cachedToken && tokenExpiry - 60 > now) {
        console.log('Using cached token.');
        return cachedToken;
    }

    console.log('Obtaining new token...');
    const params = new URLSearchParams();
    params.append('grant_type', 'client_credentials');
    params.append('client_id', clientId);
    params.append('client_secret', clientSecret);
    params.append('scope', 'icdapi_access');

    try {
        // FIX: Removed trailing space from the URL
        const response = await axios.post('https://icdaccessmanagement.who.int/connect/token', params);
        cachedToken = response.data.access_token;
        tokenExpiry = now + response.data.expires_in; // Set new expiry time
        console.log('New token obtained successfully.');
        return cachedToken;
    } catch (error) {
        console.error('Failed to get token:', error.response?.data || error.message);
        throw error;
    }
}

// Basic route to check if the server is running
app.get('/', (req, res) => {
    console.log('Root endpoint hit.');
    res.send('Hello, Express.js ICD-11 proxy is running!');
});

// Endpoint for ICD-11 search
app.get('/api/icd11search', async (req, res) => {
    try {
        const token = await getToken(); // Get or refresh the token
        const query = req.query.q; // Get the search query from URL parameters

        if (!query) {
            return res.status(400).json({ error: 'Query parameter "q" is required.' });
        }

        console.log(`Searching ICD-11 for: "${query}"`);

        // FIX: Removed trailing space from the URL
        const icdResponse = await axios.get('https://id.who.int/icd/entity/search', {
            headers: {
                Authorization: `Bearer ${token}`,
                'API-Version': 'v2', // REQUIRED HEADER for ICD-11 API
                'Accept-Language': 'en' // Optional: Specify language for results
            },
            params: {
                q: query,
                linearization: 'mms', // Mortality and Morbidity Statistics
                useFlexisearch: 'true', // Enables flexible search
                flatResults: 'true', // Optional: Get flat results instead of hierarchical
                highlighting: 'true', // Optional: Highlight matched terms
                offset: '0',
                limit: '10',
            },
        });

        res.json(icdResponse.data); // Send the ICD-11 API response back to the client
    } catch (error) {
        console.error('ICD-11 search failed:', error.response?.data || error.message);
        // Provide more descriptive error for debugging if available
        const errorMessage = error.response?.data?.title || error.message;
        res.status(error.response?.status || 500).json({
            error: 'ICD-11 search failed',
            details: errorMessage
        });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`ICD-11 Proxy server running on http://localhost:${PORT}`);
});
