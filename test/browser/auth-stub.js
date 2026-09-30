'use strict';

// Shared login stub for the browser suites that mock the API with page.route.
//
// Those suites predate authorization and are about the child form, the start
// button and the consent box — not the login. Since they never talk to a real
// server, `stubLogin` fakes the finished state the same way the app itself
// leaves it: a parent token in localStorage plus an /api/auth/me that resolves
// it. The page then renders the form directly, exactly as it does for an adult
// who logged in yesterday.
//
// The login flow itself is covered for real (bot webhook and all) by
// test/browser/auth-ui-test.js.

const PARENT = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Test Ota',
  phone: '+998901112233',
  phone_verified: true,
  marketing_consent: true,
};

// Call BEFORE page.goto: addInitScript and the route must be in place when the
// app boots, or loadParent() runs against an empty store and shows the login.
async function stubLogin(page, parent = PARENT) {
  await page.addInitScript(() => {
    try { localStorage.setItem('yik_parent_v1', JSON.stringify({ tok: 'ptok_browser_test' })); } catch (e) {}
  });
  await page.route('**/api/auth/me', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ parent }) }));
}

module.exports = { stubLogin, PARENT };
