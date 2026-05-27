require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());

// Le webhook Stripe doit recevoir le body brut — sa route définit express.raw() inline.
// express.json() est appliqué en dernier pour ne pas interférer.
app.use((req, res, next) => {
  if (req.path === '/api/stripe/webhook') return next();
  express.json({ limit: '10mb' })(req, res, next);
});

require('./db');

const { requireAuth, PUBLIC_ROUTES } = require('./middleware/auth');

app.use((req, res, next) => {
  if (PUBLIC_ROUTES.has(`${req.method} ${req.path}`)) return next();
  if (req.method === 'GET' && req.path.startsWith('/api/devis/share/')) return next();
  requireAuth(req, res, next);
});

app.use('/api', require('./routes/auth'));
app.use('/api', require('./routes/devis'));
app.use('/api', require('./routes/factures'));
app.use('/api', require('./routes/clients'));
app.use('/api', require('./routes/claude'));
app.use('/api', require('./routes/stripe'));
app.use('/api', require('./routes/vtc'));

const PORT = process.env.PORT || 8080;
app.listen(PORT, function() { console.log('OK port ' + PORT); });
