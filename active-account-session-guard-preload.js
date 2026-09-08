'use strict';

const fs = require('fs');
const path = require('path');
const core = require('./google-auth-core');

const DEFAULT_DATA_PATH = path.join(__dirname, 'data', 'db.json');
const DATA_PATH = process.env.BOEKENBAAI_DATA_PATH
  ? path.resolve(__dirname, process.env.BOEKENBAAI_DATA_PATH)
  : DEFAULT_DATA_PATH;
const originalUpsertSession = core.upsertSession;

function readMainDb() {
  const db = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
  if (!Array.isArray(db.users)) db.users = [];
  if (!Array.isArray(db.students)) db.students = [];
  return db;
}

function findActiveAccount(db, type, userId) {
  if (!userId) return null;
  if (type === 'student') {
    return db.students.find(
      (entry) => entry?.id === userId && entry?.active !== false
    ) || null;
  }
  return db.users.find(
    (entry) =>
      entry?.id === userId &&
      entry?.active !== false &&
      ['teacher', 'admin'].includes(entry?.role)
  ) || null;
}

core.upsertSession = function activeAccountUpsertSession(store, token, input = {}) {
  const type = input?.type === 'student' ? 'student' : 'staff';
  const userId = String(input?.userId || '').trim();
  if (userId) {
    const account = findActiveAccount(readMainDb(), type, userId);
    if (!account) {
      const error = new Error('Dit account is niet actief en kan niet inloggen.');
      error.code = 'ACCOUNT_INACTIVE';
      throw error;
    }
  }
  return originalUpsertSession(store, token, input);
};

module.exports = {
  __test: {
    DATA_PATH,
    findActiveAccount,
  },
};