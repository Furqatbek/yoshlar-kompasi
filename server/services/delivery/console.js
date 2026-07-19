'use strict';

// Fallback delivery provider: logs the report link. Used in dev and whenever no
// real channel is configured, so the product runs end-to-end without tokens.

module.exports = {
  name: 'console',
  // eslint-disable-next-line no-unused-vars
  async deliver({ reportUrl, parentPhone, childNickname }) {
    // eslint-disable-next-line no-console
    console.log('[delivery:console] -> ' + (parentPhone || 'no-phone') + ' | ' + childNickname + ' | ' + reportUrl);
    return { status: 'sent', channel: 'console' };
  },
};
