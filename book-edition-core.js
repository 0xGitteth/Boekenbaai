'use strict';

const utils = require('./book-edition-utils');
const isbn = require('./book-edition-isbn');
const authors = require('./book-edition-authors');
const grouping = require('./book-edition-grouping');

module.exports = {
  ...utils,
  ...isbn,
  ...authors,
  ...grouping,
};
