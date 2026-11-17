'use strict';

// Name-only teacher creation must not depend on a hidden username input.
// The server owns uniqueness because it has the current accounts database.
function generateTeacherUsername(db, name, requested = '') {
  const explicit = String(requested || '').trim();
  if (explicit) return explicit;
  const base = String(name || '').normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '.').replace(/^\.+|\.+$/g, '')
    .slice(0, 42) || 'docent';
  const used = new Set([
    ...(Array.isArray(db?.users) ? db.users : []),
    ...(Array.isArray(db?.students) ? db.students : []),
  ].map(account => String(account?.username || '').trim().toLowerCase()));
  if (!used.has(base)) return base;
  for (let index = 2; index < 10000; index += 1) {
    const candidate = base + '-' + index;
    if (!used.has(candidate)) return candidate;
  }
  throw new Error('too_many_duplicate_teacher_usernames');
}

module.exports = { generateTeacherUsername };
