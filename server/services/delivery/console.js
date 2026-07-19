'use strict';

// Fallback delivery provider: logs the report link. Used in dev and whenever no
// real channel is configured, so the product runs end-to-end without tokens.

module.exports = {
  name: 'console',
  async deliver({ reportUrl, parentPhone }) {
    // Log ids only — no nickname/answers, and mask the phone (spec §6/§7).
    const masked = parentPhone ? parentPhone.slice(0, -4).replace(/\d/g, '*') + parentPhone.slice(-4) : 'no-phone';
    // eslint-disable-next-line no-console
    console.log('[delivery:console] report ready ' + masked + ' -> ' + reportUrl);
    return { status: 'sent', channel: 'console' };
  },
};
