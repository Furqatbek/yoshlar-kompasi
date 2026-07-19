'use strict';

// Assemble the static frontend into server/public:
//  - Kompas.dc.html -> public/index.html, with vendored React preloaded so the
//    x-dc runtime (support.js) never fetches React from a CDN.
//  - support.js, the _ds design system, and the React vendor files, copied in.
// The app is a hash-routed SPA, so index.html served at "/" is all that's needed.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..'); // repo root
const SERVER = path.join(__dirname, '..');
const PUBLIC = path.join(SERVER, 'public');

const REACT_PRELOAD =
  '<script src="/vendor/react.production.min.js"></script>\n' +
  '<script src="/vendor/react-dom.production.min.js"></script>\n' +
  '<script src="./support.js"></script>';

function ensureEmptyDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
}

function copyInto(src, destDir) {
  const dest = path.join(destDir, path.basename(src));
  fs.cpSync(src, dest, { recursive: true });
}

function main() {
  ensureEmptyDir(PUBLIC);

  // index.html with React preloaded before support.js.
  const htmlPath = path.join(ROOT, 'Kompas.dc.html');
  let html = fs.readFileSync(htmlPath, 'utf8');
  if (html.indexOf('<script src="./support.js"></script>') === -1) {
    throw new Error('build-web: support.js script tag not found in Kompas.dc.html');
  }
  html = html.replace('<script src="./support.js"></script>', REACT_PRELOAD);
  fs.writeFileSync(path.join(PUBLIC, 'index.html'), html);

  // Runtime + design system.
  copyInto(path.join(ROOT, 'support.js'), PUBLIC);
  copyInto(path.join(ROOT, '_ds'), PUBLIC);

  // Vendored React (committed under server/vendor).
  const vendorSrc = path.join(SERVER, 'vendor');
  const vendorDest = path.join(PUBLIC, 'vendor');
  fs.mkdirSync(vendorDest, { recursive: true });
  for (const f of ['react.production.min.js', 'react-dom.production.min.js']) {
    const p = path.join(vendorSrc, f);
    if (!fs.existsSync(p)) throw new Error('build-web: missing vendor file ' + f + ' (server/vendor). See README.');
    fs.copyFileSync(p, path.join(vendorDest, f));
  }

  // eslint-disable-next-line no-console
  console.log('[build:web] public/ assembled (index.html + support.js + _ds + vendor).');
}

main();
