'use strict';

// GET /api/config — the handful of settings the browser has to know about.
//
// Without this the page has to guess at how the server is configured, and it
// guessed wrong: with AUTH_REQUIRED=false the server happily started sessions
// while the UI still demanded a Telegram login nobody could complete. The
// landing page has the same problem with the price — it cannot honestly say
// what a report costs, or whether it costs anything, unless it is told.
//
// Public and unauthenticated by necessity (the landing page is the first thing
// anyone sees), so it carries only what is already visible in the product:
// whether a login is needed and what the price is. No tokens, no merchant ids,
// no bot credentials.

const express = require('express');
const router = express.Router();

const { config } = require('../config');

router.get('/', (req, res) => {
  // Short cache: this changes only on redeploy, and the landing page fetches
  // it on every visit.
  res.set('Cache-Control', 'public, max-age=60');
  res.json({
    auth: {
      required: !!config.auth.required,
      // The bot is what a login goes through; the page uses this to decide
      // whether to explain the Telegram step at all.
      configured: !!config.delivery.telegram.botUsername,
    },
    payments: {
      enabled: !!config.payments.enabled,
      // Only meaningful when enabled; sent regardless so the shape is stable.
      price_uzs: config.payments.priceUzs,
    },
  });
});

module.exports = router;
