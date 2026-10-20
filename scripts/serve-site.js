// Local preview of the GitHub Pages site, laid out the way CI publishes it:
//   /                         site/index.html
//   /ledgerline-engine.js     site/dist/ledgerline-engine.js (npm run site:build)
//   /requirements.json        compliance/requirements.json
//   /compliance/              compliance-report/ (from npm run test:compliance), if present
//   /demo.gif, /demo-bank.png docs/
//
// Usage: npm run site:build && node scripts/serve-site.js   (PORT defaults to 4173)
const express = require('express');
const path = require('path');

const root = path.join(__dirname, '..');
const app = express();
const port = Number(process.env.PORT || 4173);

app.get('/requirements.json', (req, res) => res.sendFile(path.join(root, 'compliance', 'requirements.json')));
app.get('/demo.gif', (req, res) => res.sendFile(path.join(root, 'docs', 'demo.gif')));
app.get('/demo-bank.png', (req, res) => res.sendFile(path.join(root, 'docs', 'demo-bank.png')));
app.use('/compliance', express.static(process.env.SITE_EVIDENCE_DIR || path.join(root, 'compliance-report')));
app.use(express.static(path.join(root, 'site', 'dist')));
app.use(express.static(path.join(root, 'site'), { index: 'index.html' }));

app.listen(port, () => console.log(`Live-site preview at http://localhost:${port}`));
