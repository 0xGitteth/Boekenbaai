'use strict';

const path = require('path');

const preload = path.join(__dirname, 'external-fetch-offline-preload.js');
const existing = String(process.env.NODE_OPTIONS || '').trim();
process.env.NODE_OPTIONS = `${existing ? `${existing} ` : ''}--require=${JSON.stringify(preload)}`;

require('./auth-import-jobs.test.js');
