const express = require('express');
const router = express.Router();
const pool = require('../db');
const stripe = process.env.STRIPE_SECRET_KEY ? require('stripe')(process.env.STRIPE_SECRET_KEY) : null;

const planMap = {
  [process.env.STRIPE_PRICE_STARTER || 'price_1TNaVs7LHQgZGOp76yslWd3O']: 'starter',
  'price_1TNaWo7LHQgZGOp7vTLsMTLI': 'starter',
  [process.env.STRIPE_PRICE_PRO    || 'price_1TNaXu7LHQgZGOp7Ouzq7yHc']: 'pro',
  'price_1TNaXL7LHQgZGOp7HjJjdpfb': 'pro'
};

router.post('/stripe/checkout', async (req, res) => {
  try {
    const { priceId } = req.body;
    if(!priceId) return res.status(400).json({ error: 'Price ID non configuré' });

    const userRow = await pool.query('SELECT email, stripe_customer_id FROM users WHERE id=$1', [req.user.userId]);
    const dbUser = userRow.rows[0];
    if (!dbUser) return res.status(401).json({ error: 'Utilisateur introuvable' });
    let stripeCustomerId = dbUser.stripe_customer_id;
    if (!stripeCustomerId) {
      const customer = await stripe.customers.create({ email: dbUser.email });
      stripeCustomerId = customer.id;
      await pool.query('UPDATE users SET stripe_customer_id=$1 WHERE id=$2', [stripeCustomerId, req.user.userId]);
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      payment_method_collection: 'always',
      customer: stripeCustomerId,
      line_items: [{ price: priceId, quantity: 1 }],
      subscription_data: { trial_period_days: 30 },
      success_url: 'https://devisvoice.fr/success.html?session_id={CHECKOUT_SESSION_ID}',
      cancel_url:  'https://devisvoice.fr/pricing.html'
    });
    res.json({ url: session.url });
  } catch(err) {
    console.log('Stripe checkout error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post('/stripe/create-checkout', async (req, res) => {
  try {
    const { priceId, mode } = req.body;
    if(!priceId) {
      return res.status(400).json({ error: 'Price ID non configuré' });
    }
    const userRow = await pool.query('SELECT email, stripe_customer_id FROM users WHERE id=$1', [req.user.userId]);
    const dbUser = userRow.rows[0];
    if (!dbUser) return res.status(401).json({ error: 'Utilisateur introuvable' });
    let stripeCustomerId = dbUser.stripe_customer_id;
    if (!stripeCustomerId) {
      const customer = await stripe.customers.create({ email: dbUser.email });
      stripeCustomerId = customer.id;
      await pool.query('UPDATE users SET stripe_customer_id=$1 WHERE id=$2', [stripeCustomerId, req.user.userId]);
    }
    const session = await stripe.checkout.sessions.create({
      mode: mode || 'subscription',
      payment_method_types: ['card'],
      customer: stripeCustomerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: 'https://devisvoice.fr/pricing-success.html?session={CHECKOUT_SESSION_ID}',
      cancel_url:  'https://devisvoice.fr/pricing.html'
    });
    res.json({ url: session.url });
  } catch(err) {
    console.log('Stripe error détail:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/stripe/session/:sessionId', async (req, res) => {
  if(!stripe) return res.status(500).json({ error: 'Stripe non configuré' });
  try {
    const session = await stripe.checkout.sessions.retrieve(req.params.sessionId, {
      expand: ['line_items']
    });
    const priceId = session.line_items?.data?.[0]?.price?.id || '';
    const plan  = planMap[priceId] || 'starter';
    const email = session.customer_email || session.customer_details?.email || '';
    if(email){
      await pool.query('UPDATE users SET plan=$1, updated_at=NOW() WHERE email=$2', [plan, email])
        .catch(err => console.error('Session update plan:', err));
    }
    res.json({ plan, email });
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  if (!process.env.STRIPE_WEBHOOK_SECRET) {
    console.error('STRIPE_WEBHOOK_SECRET non configuré — webhook rejeté');
    return res.status(500).json({ error: 'Configuration serveur invalide' });
  }
  const sig = req.headers['stripe-signature'];
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch(err) {
    return res.status(400).json({ error: `Webhook signature invalide: ${err.message}` });
  }

  if(event.type === 'checkout.session.completed'){
    const session = event.data.object;
    const stripeCustomerId = session.customer;
    const subscriptionId   = session.subscription;
    const fullSession = await stripe.checkout.sessions.retrieve(session.id, { expand: ['line_items'] });
    const priceId = fullSession.line_items?.data?.[0]?.price?.id;
    const plan = planMap[priceId] || 'starter';
    console.log('Webhook checkout.session.completed — customer:', stripeCustomerId, 'plan:', plan);
    if(stripeCustomerId){
      await pool.query(
        `UPDATE users SET plan=$1, stripe_subscription_id=$2,
         subscription_status='active', updated_at=NOW() WHERE stripe_customer_id=$3`,
        [plan, subscriptionId, stripeCustomerId]
      ).catch(err => console.error('Webhook checkout update:', err));
    }
  }

  if(event.type === 'customer.subscription.updated'){
    const sub = event.data.object;
    await pool.query(
      `UPDATE users SET subscription_status=$1, subscription_current_period_end=$2,
       stripe_subscription_id=$3, updated_at=NOW() WHERE stripe_customer_id=$4`,
      [sub.status, new Date(sub.current_period_end * 1000), sub.id, sub.customer]
    ).catch(err => console.error('Webhook subscription.updated:', err));
  }

  if(event.type === 'customer.subscription.deleted'){
    const sub = event.data.object;
    await pool.query(
      `UPDATE users SET plan='gratuit', subscription_status='canceled',
       stripe_subscription_id=NULL, updated_at=NOW() WHERE stripe_customer_id=$1`,
      [sub.customer]
    ).catch(err => console.error('Webhook subscription.deleted:', err));
  }

  if(event.type === 'invoice.payment_failed'){
    const invoice = event.data.object;
    await pool.query(
      `UPDATE users SET subscription_status='past_due', updated_at=NOW() WHERE stripe_customer_id=$1`,
      [invoice.customer]
    ).catch(err => console.error('Webhook invoice.payment_failed:', err));
  }

  res.json({ received: true });
});

router.post('/stripe/billing-portal', async (req, res) => {
  if (!stripe) return res.status(500).json({ error: 'Stripe non configuré' });
  try {
    const result = await pool.query('SELECT stripe_customer_id FROM users WHERE id=$1', [req.user.userId]);
    const user = result.rows[0];
    if (!user?.stripe_customer_id) return res.status(400).json({ error: 'Aucun abonnement Stripe trouvé' });
    const portalSession = await stripe.billingPortal.sessions.create({
      customer: user.stripe_customer_id,
      return_url: 'https://devisvoice.fr/app'
    });
    res.json({ url: portalSession.url });
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
