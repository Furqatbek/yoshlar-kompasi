'use strict';

// Delivery provider selection. `deliver()` never throws into the request path —
// a failed delivery must not fail report generation; it just reports a status.

const { config } = require('../../config');
const consoleProvider = require('./console');
const telegram = require('./telegram');

function selected() {
  return config.delivery.provider === 'telegram' ? telegram.provider : consoleProvider;
}

async function deliver(args) {
  const primary = selected();
  try {
    const res = await primary.deliver(args);
    // If Telegram isn't configured it returns 'skipped' — fall back to console.
    if (res && res.status === 'skipped') {
      return consoleProvider.deliver(args);
    }
    return res;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[delivery] ' + primary.name + ' error: ' + err.message);
    return { status: 'error', channel: primary.name, detail: err.message };
  }
}

module.exports = { deliver, telegram };
