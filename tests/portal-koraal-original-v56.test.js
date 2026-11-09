'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.join(__dirname, '..', 'public');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

const svg = read('logo/koraal-full-original-v56.svg');
const css = read('portal-koraal-original-v56.css');
assert.match(svg, /viewBox="0 0 350 63"/);
assert.match(svg, /aria-label="Koraal: wonen, leren, werken"/);
assert.doesNotMatch(svg, /<path\b|<text\b|<rect\b/,
  'The original supplied lettering must be embedded, not reconstructed as paths or text');
const b64 = svg.match(/href="data:image\/png;base64,([A-Za-z0-9+/=]+)"/)?.[1];
assert.ok(b64, 'Original Koraal artwork must be embedded directly in the SVG');
const png = Buffer.from(b64,'base64');
assert.equal(png.subarray(0,8).toString('hex'), '89504e470d0a1a0a');
assert.equal(png.readUInt32BE(16),350);
assert.equal(png.readUInt32BE(20),63);
assert.equal(crypto.createHash('sha256').update(png).digest('hex'),
  '41090bbc16acb73e54f0dcac3b822176cd12b390cf423ef29d223313bc0a6240',
  'Exact image derived directly from the uploaded Koraal artwork must be preserved');
for (const name of ['index.html', 'staff.html']) {
  const html=read(name);
  assert.match(html, /src="logo\/koraal-full-original-v56\.svg"/);
  assert.match(html, /alt="Koraal: wonen, leren, werken"/);
  assert.match(html, /href="portal-koraal-original-v56\.css"/);
  assert.ok(html.indexOf('portal-branding-fixes-v54.css') < html.indexOf('portal-koraal-original-v56.css'));
  assert.doesNotMatch(html, /src="logo\/koraal-original-transparent-v54\.svg"/);
}
assert.match(css, /\.bb-site-footer__koraal \{/);
const koraalStyle = css.match(/\.bb-site-footer__brand \.bb-site-footer__koraal \{([\s\S]*?)\}/)?.[1];
const dokStyle = css.match(/\.bb-site-footer__brand \.bb-site-footer__dok \{([\s\S]*?)\}/)?.[1];
assert.ok(koraalStyle && dokStyle, 'Both footer image styles must be present');
assert.match(koraalStyle, /height:24px!important;/);
assert.doesNotMatch(koraalStyle, /height:31px!important;/);
assert.match(dokStyle, /height:31px!important;/,
  'The Het Dok logo remains at the original height');
assert.match(koraalStyle, /width:auto!important;/);
assert.match(css, /aspect-ratio:350 \/ 63!important;/);
assert.match(css, /\.bb-site-footer__dok \{/);
assert.match(css, /background:transparent!important;/);
console.log('Exact original Koraal wordmark, tagline, transparent background and compact Koraal footer sizing OK');
