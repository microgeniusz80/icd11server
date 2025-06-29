const express = require('express');
const axios = require('axios');
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();

// Enable CORS
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.options('*', cors());
app.use(bodyParser.json());

// ICD-11 credentials (store in env in production)
const clientId = 'c157b2fb-402f-44db-8af8-aa0029048d21_15f8a3f6-eae0-4057-8e93-0299739eaaea';
const clientSecret = 'OpENJjZ07u2vy0832ir9uCA/UGoZa0NJaGdcwAsPbG8=';

let cachedToken = null;
let tokenExpiry = 0;

// Token acquisition with caching
async function getToken() {
    const now = Date.now() / 1000;
    if (cachedToken && tokenExpiry - 60 > now) {
        console.log('Using cached token.');
        return cachedToken;
    }

    console.log('Fetching new token...');
    const params = new URLSearchParams();
    params.append('grant_type', 'client_credentials');
    params.append('client_id', clientId);
    params.append('client_secret', clientSecret);
    params.append('scope', 'icdapi_access');

    try {
        const response = await axios.post('https://icdaccessmanagement.who.int/connect/token', params);
        cachedToken = response.data.access_token;
        tokenExpiry = now + response.data.expires_in;
        console.log('Token obtained.');
        return cachedToken;
    } catch (error) {
        console.error('Error getting token:', error.response?.data || error.message);
        throw error;
    }
}

// Root check
app.get('/', (req, res) => {
    res.send('ICD-11 Proxy server is running.');
});

// ICD-11 Search Endpoint
app.get('/api/icd11search', async (req, res) => {
    try {
        const query = req.query.q;
        if (!query) {
            return res.status(400).json({ error: 'Query parameter "q" is required.' });
        }

        const token = await getToken();

        const searchResponse = await axios.get('https://id.who.int/icd/entity/search', {
            headers: {
                Authorization: `Bearer ${token}`,
                'API-Version': 'v2',
                'Accept-Language': 'en'
            },
            params: {
                q: query,
                linearization: 'mms',
                useFlexisearch: 'true',
                flatResults: 'true',
                highlighting: 'true',
                offset: '0',
                limit: '10',
            },
        });

        const results = searchResponse.data.destinationEntities || searchResponse.data.entity || searchResponse.data.searchResults || [];

        if (results.length === 0) {
            console.log(`No results for "${query}".`);
            return res.status(404).json({ message: `No ICD-11 codes found for "${query}".` });
        }

        // Fetch detailed info for each result
        const detailedResults = await Promise.all(results.map(async item => {
            const entityId = item.id;
            try {
                const entityResponse = await axios.get(entityId, {
                    headers: {
                        Authorization: `Bearer ${token}`,
                        'API-Version': 'v2',
                        'Accept-Language': 'en'
                    }
                });
                const entityData = entityResponse.data;

                return {
                    id: entityId,
                    code: entityData.theCode || null,
                    title: entityData.title?.en || null,
                    definition: entityData.definition?.en || null,
                };
            } catch (error) {
                console.error(`Failed to fetch details for ${entityId}:`, error.response?.data || error.message);
                return {
                    id: entityId,
                    code: null,
                    title: null,
                    definition: null,
                    error: 'Failed to fetch entity details'
                };
            }
        }));

        console.log(`Returned ${detailedResults.length} detailed results for "${query}".`);

        res.json({
            query,
            count: detailedResults.length,
            results: detailedResults
        });

    } catch (error) {
        console.error('ICD-11 search error:', error.response?.data || error.message);
        res.status(error.response?.status || 500).json({
            error: 'ICD-11 search failed',
            details: error.response?.data || error.message
        });
    }
});


const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`ICD-11 Proxy server running on port ${PORT}`);
});
