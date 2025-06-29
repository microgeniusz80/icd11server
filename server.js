const express = require('express');
const axios = require('axios');
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();

const data = []

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

// Endpoint for ICD-11 search, which can be used to find diagnosis codes
app.get('/api/icd11search', async (req, res) => {
    data.length = 0; // Clear previous search results
    try {
        const token = await getToken(); // Get or refresh the token
        const query = req.query.q; // Get the search query (diagnosis) from URL parameters

        if (!query) {
            return res.status(400).json({ error: 'Query parameter "q" is required for diagnosis search.' });
        }

        console.log(`Initial ICD-11 search for diagnosis: "${query}"`);

        // First API call: Search for entities based on the query within the MMS linearization.
        // This should return relevant entity IDs.
        const icdSearchResponse = await axios.get('https://id.who.int/icd/entity/search', {
            headers: {
                Authorization: `Bearer ${token}`,
                'API-Version': 'v2', // REQUIRED HEADER for ICD-11 API
                'Accept-Language': 'en' // Optional: Specify language for results
            },
            params: {
                q: query,
                linearization: 'mms', // IMPORTANT: Use MMS linearization for search relevance
                useFlexisearch: 'true', // Enables flexible search
                highlighting: 'true', // Optional: Highlight matched terms
                offset: '0',
                limit: '100', // Fetch more initial results
            },
        });

        // Log the raw response from the initial search for debugging
        console.log('Raw Initial Search Response Data:', JSON.stringify(icdSearchResponse.data, null, 2));

        // The ICD-11 API usually returns search results in `destinationEntities` or `searchResults`
        const initialSearchResults = icdSearchResponse.data.destinationEntities || icdSearchResponse.data.searchResults || [];

        if (initialSearchResults.length > 0) {
            console.log(`Found ${initialSearchResults.length} initial results. Fetching full details for each...`);

            // Use Promise.all to make concurrent requests for full entity details
            const detailedResultsPromises = initialSearchResults.map(async (item) => {
                const entityId = item.id.split('/').pop(); // Extracts the numerical ID
                // Construct the URL to get the entity *within the MMS linearization*
                const mmsLinearizationBase = 'https://id.who.int/icd/release/11/2024-01/mms';

                try {
                    // Second API call: Fetch full details for each entity from the MMS linearization
                    const entityResponse = await axios.get(`${mmsLinearizationBase}/${entityId}`, {
                        headers: {
                            Authorization: `Bearer ${token}`,
                            'API-Version': 'v2',
                            'Accept-Language': 'en'
                        }
                    });

                    // Log the raw response from the detailed entity fetch for debugging
                    console.log(`Raw Detailed Entity ${entityId} Response Data:`, JSON.stringify(entityResponse.data, null, 2));

                    // --- START Improved Access and Validation ---
                    const code = entityResponse.data.code;
                    const title = (entityResponse.data.title && typeof entityResponse.data.title === 'object' && entityResponse.data.title['@value'])
                                  ? entityResponse.data.title['@value']
                                  : null;
                    const definition = (entityResponse.data.definition && typeof entityResponse.data.definition === 'object' && entityResponse.data.definition['@value'])
                                      ? entityResponse.data.definition['@value']
                                      : null;

                    // Log the extracted values right before validation
                    console.log(`Debug: Entity ${entityId} - Extracted Code: '${code}', Title: '${title}', Definition: '${definition}'`);
                    data.push({
                        id: entityId,
                        code: code,
                        title: title,
                        definition: definition
                    });
                    // For entities within a linearization, the 'code' and 'title' should be directly available
                    // Check if code is a non-empty string and title is a non-empty string
                    if (typeof code === 'string' && code.length > 0 && typeof title === 'string' && title.length > 0) {
                        return {
                            id: entityResponse.data.id,
                            title: title,
                            code: code,
                            definition: definition,
                            // Add other relevant fields if needed, e.g., 'classKind', 'parents', 'children'
                        };
                    } else {
                        console.warn(`Entity ${entityId} missing expected code or title value in detailed fetch from MMS linearization. ` +
                                     `Code: '${code}', Title: '${title}'. Full Data:`, JSON.stringify(entityResponse.data));
                        return {
                            id: item.id,
                            title: `(Validation failed for ${entityId})`, // Changed message for clarity
                            code: `(Validation failed for ${entityId})`, // Changed message for clarity
                            definition: `(Definition unavailable for ${entityId})`
                        };
                    }
                    // --- END Improved Access and Validation ---

                } catch (entityError) {
                    console.error(`Failed to fetch details for entity ${entityId} from MMS linearization:`, entityError.response?.data || entityError.message);
                    return {
                        id: item.id,
                        title: `Error fetching details for ${item.id}`,
                        code: 'N/A', // Indicate an error in code retrieval
                        definition: 'Error fetching definition.'
                    };
                }
            });

            // Wait for all detailed entity fetches to complete
            const codesFound = await Promise.all(detailedResultsPromises);

            // Filter out any results where the code or title couldn't be retrieved meaningfully
            const filteredCodes = codesFound.filter(item =>
                item.code && item.code !== 'N/A' && !item.code.startsWith('(Validation failed') &&
                item.title && !item.title.startsWith('(Validation failed') &&
                item.id
            );

            // res.json({
            //     query: query,
            //     totalResults: filteredCodes.length, // Report on the number of valid codes found
            //     codesFound: filteredCodes
            // });
        } else {
            console.log(`No initial search results found for "${query}".`);
            res.status(404).json({ message: 'No ICD-11 codes found for the given diagnosis.', query: query });
        }

        console.log('the data:', data);
        res.json(data);

    } catch (error) {
        console.error('ICD-11 diagnosis search failed at primary stage:', error.response?.data || error.message);
        const errorMessage = error.response?.data?.title || error.message;
        res.status(error.response?.status || 500).json({
            error: 'ICD-11 diagnosis search failed',
            details: errorMessage
        });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`ICD-11 Proxy server running on http://localhost:${PORT}`);
});
