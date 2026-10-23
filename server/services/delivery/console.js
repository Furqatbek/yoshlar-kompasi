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
    // With a real bot this is where the file goes; here, say where to get it,
    // since collecting the report from this log is how local testing works.
    // eslint-disable-next-line no-console
    console.log('[delivery:console]   pdf: ' + String(reportUrl || '').replace('/hisobot/', '/api/reports/') + '/pdf');
    return { status: 'sent', channel: 'console' };
  },
};
