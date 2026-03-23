const express = require(‘express’);
const cors = require(‘cors’);

const app = express();
app.use(cors());
app.use(express.json());

app.post(’/api/claude’, async (req, res) => {
try {
const response = await fetch(‘https://api.anthropic.com/v1/messages’, {
method: ‘POST’,
headers: {
‘Content-Type’: ‘application/json’,
‘x-api-key’: process.env.ANTHROPIC_API_KEY,
‘anthropic-version’: ‘2023-06-01’
},
body: JSON.stringify(req.body.payload)
});
const data = await response.json();
res.json(data);
} catch (err) {
res.status(500).json({ error: err.message });
}
});

app.post(’/api/resend’, async (req, res) => {
try {
const response = await fetch(‘https://api.resend.com/emails’, {
method: ‘POST’,
headers: {
‘Authorization’: ’Bearer ’ + req.body.apiKey,
‘Content-Type’: ‘application/json’
},
body: JSON.stringify(req.body.payload)
});
const data = await response.json();
res.status(response.ok ? 200 : 400).json(data);
} catch (err) {
res.status(500).json({ error: err.message });
}
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, function() {
console.log(’DevisVoice backend actif sur port ’ + PORT);
});
