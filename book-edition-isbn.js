'use strict';

const base = require('./book-edition-isbn-base');
const evidence = require('./book-edition-isbn-evidence');

module.exports = { ...base, ...evidence };
