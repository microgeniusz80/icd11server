const express = require('express');
const axios = require('axios');
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();
app.use(cors());
app.use(bodyParser.json());

const clientId = 'c157b2fb-402f-44db-8af8-aa0029048d21_15f8a3f6-eae0-4057-8e93-0299739eaaea';
const clientSecret = 'OpENJjZ07u2vy0832ir9uCA/UGoZa0NJaGdcwAsPbG8=';

let cachedToken = null;
let tokenExpiry = 0;

async function getToken() {
    const now = Date.now() / 1000;
    if (cachedToken && tokenExpiry - 60 > now) {
        return cachedToken;
    }
    const params = new URLSearchParams();
    params.append('grant_type', 'client_credentials');
    params.append('client_id', clientId);
    params.append('client_secret', clientSecret);
    params.append('scope', 'icdapi_access');

    const response = await axios.post('https://icdaccessmanagement.who.int/connect/token', params);
    cachedToken = response.data.access_token;
    tokenExpiry = now + response.data.expires_in;
    return cachedToken;
}

app.get('/api/icd11search', async (req, res) => {
    try {
        const token = await getToken();
        const query = req.query.q;

        const icdResponse = await axios.get('https://id.who.int/icd/entity/search', {
            headers: { Authorization: `Bearer ${token}` },
            params: {
                q: query,
                linearization: 'mms',
                useFlexisearch: 'true',
                language: 'en',
                offset: '0',
                limit: '10',
            },
        });

        res.json(icdResponse.data);
    } catch (error) {
        console.error(error.response?.data || error.message);
        res.status(500).json({ error: 'ICD-11 search failed' });
    }
});

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Proxy server running on http://localhost:${PORT}`);
});
