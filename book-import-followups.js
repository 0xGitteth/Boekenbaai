'use strict';

// PR6: school-wide, persistent per-copy follow-up tasks for ambiguous Excel
// class/location fields. Tasks belong to a class, never an individual teacher.
const { matchEntityByName } = require('./book-import-analysis-context');
const { studentClassIds } = require('./book-loan-policy');
const { persistExcelLoanReceipts } = require('./book-import-loan-migration');
const { canonicalizeBookIsbn13 } = require('./book-edition-core');

const DEFAULT_SETTINGS = Object.freeze({ reminderDays: 7, escalationDays: 14 });
const CHOICES = new Set(['class_loan', 'student_loan', 'fixed_location', 'not_our_class']);
const DAY_MS = 86400000;

function settingsFor(db) {
  const configured = db?.bookImportFollowupSettings || {};
  const reminderDays = Number.isSafeInteger(configured.reminderDays)
    && configured.reminderDays >= 1 && configured.reminderDays <= 365
    ? configured.reminderDays : DEFAULT_SETTINGS.reminderDays;
  const escalationDays = Number.isSafeInteger(configured.escalationDays)
    && configured.escalationDays > reminderDays && configured.escalationDays <= 730
    ? configured.escalationDays : Math.max(DEFAULT_SETTINGS.escalationDays, reminderDays + 1);
  return { reminderDays, escalationDays };
}

function validateSettings(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const { reminderDays, escalationDays } = body;
  if (!Number.isSafeInteger(reminderDays) || reminderDays < 1 || reminderDays > 365
    || !Number.isSafeInteger(escalationDays) || escalationDays <= reminderDays
    || escalationDays > 730) return null;
  return { reminderDays, escalationDays };
}

function followupContext(row, classes = []) {
  const context = row?.context || {};
  const tokens = Array.isArray(context.classContext)
    ? context.classContext.filter((v) => typeof v === 'string' && v.trim()).slice(0, 20) : [];
  const needs = Boolean(tokens.length || context.libraryPresence
    || (context.fixedLocation && context.fixedLocation.status !== 'resolved'));
  if (!needs) return null;
  // Explicit, possibly conflicting loan data cannot be deferred: never make
  // an imported active loan disappear to enable the classroom task.
  if (context.studentLoan || context.classLoan || context.excludeFromSchoolCollection) return null;
  const matches = tokens.map((name) => matchEntityByName(name, classes));
  const unique = matches.length === 1 && matches[0].status === 'matched'
    ? matches[0].matches[0].id : null;
  return {
    classId: unique && classes.some((c) => c.id === unique) ? unique : null,
    sourceClassNames: tokens.map((name) => name.slice(0, 160)),
    sourceLibraryPresence: typeof context.libraryPresence?.value === 'string'
      ? context.libraryPresence.value.slice(0, 160) : '',
    requestedFixedLocation: Boolean(context.fixedLocation
      && context.fixedLocation.status !== 'resolved'),
  };
}

function contextMatchesTask(task, context) {
  if (!task || !context) return false;
  return JSON.stringify([task.sourceClassNames || [], task.sourceLibraryPresence || '',
    Boolean(task.requestedFixedLocation)])
    === JSON.stringify([context.sourceClassNames, context.sourceLibraryPresence,
      context.requestedFixedLocation]);
}

function eligibleForDeferredContext(row, classes = []) {
  // A row with no class-related ambiguity is not a follow-up, and identity
  // conflicts, invalid loans or unrelated conflicts must NEVER be waived.
  if (!followupContext(row, classes)) return false;
  if (!['ready', 'warning'].includes(row.status)) return false;
  return (row.issues || []).every((issue) => issue.severity !== 'conflict'
    && issue.severity !== 'error');
}

function makeTask({ id, reportId, row, book, context, createdAt }) {
  if (!id || !reportId || !book?.id || !context) throw Error('invalid_class_followup');
  return {
    id, reportId, bookId: book.id, barcode: book.barcode || '',
    editionIsbn: book.editionIsbn || book.metadataIsbn || '',
    title: book.title || '', classId: context.classId, sourceClassNames: context.sourceClassNames,
    sourceLibraryPresence: context.sourceLibraryPresence,
    requestedFixedLocation: context.requestedFixedLocation,
    worksheetRow: row.sourceRowNumber, createdAt,
    status: 'open', revision: 1, completedAt: null, completedBy: null,
    resolution: null, studentId: null,
  };
}

function taskStage(task, config, now = Date.now()) {
  if (task.status === 'completed') return 'completed';
  if (task.status === 'cancelled') return 'cancelled';
  const created = Date.parse(task.createdAt);
  const age = Number.isFinite(created) ? Math.max(0, now - created) : 0;
  if (!task.classId || task.status === 'admin_review' || age >= config.escalationDays * DAY_MS) {
    return 'admin_review';
  }
  if (age >= config.reminderDays * DAY_MS) return 'reminder';
  return 'open';
}

function taskView(task, config, now = Date.now()) {
  return {
    id: task.id, reportId: task.reportId, bookId: task.bookId,
    barcode: task.barcode || '',
    editionIsbn: task.editionIsbn, title: task.title,
    classId: task.classId, sourceClassNames: task.sourceClassNames,
    sourceLibraryPresence: task.sourceLibraryPresence,
    requestedFixedLocation: task.requestedFixedLocation,
    worksheetRow: task.worksheetRow, createdAt: task.createdAt,
    status: taskStage(task, config, now),
    revision: task.revision, completedAt: task.completedAt || null,
    resolution: task.resolution || null,
  };
}

function listTasks(db, user, now = Date.now()) {
  const config = settingsFor(db);
  const assigned = new Set((db.classes || [])
    .filter((c) => user.role === 'admin'
      || (Array.isArray(c.teacherIds) && c.teacherIds.includes(user.id)))
    .map((c) => c.id));
  const tasks = (Array.isArray(db.bookImportFollowups) ? db.bookImportFollowups : [])
    .filter((task) => {
      const phase = taskStage(task, config, now);
      if (phase === 'completed' || phase === 'cancelled') return false;
      return user.role === 'admin' || (assigned.has(task.classId)
        && (phase === 'open' || phase === 'reminder'));
    }).map((task) => taskView(task, config, now));
  const open = tasks.filter((task) => ['open', 'reminder', 'admin_review'].includes(task.status));
  const classes = (db.classes || []).filter((c) => assigned.has(c.id))
    .map((c) => ({ id: c.id, name: c.name }));
  return {
    tasks, classes,
    students: (db.students || []).filter((student) =>
      user.role === 'admin' || studentClassIds(db, student).some((id) => assigned.has(id)))
      .map((student) => ({ id: student.id, name: student.name,
        classIds: studentClassIds(db, student).filter((id) => assigned.has(id)),
        active: student.active !== false && student.status !== 'inactive' })),
    summary: { open: open.length, reminders: open.filter((t) => t.status === 'reminder').length,
      escalated: open.filter((t) => t.status === 'admin_review').length },
    ...(user.role === 'admin' ? { settings: config } : {}),
  };
}

function reportIsFullyReviewed(db, reportId) {
  const report = (db.bookImportReports || []).find((entry) => entry?.id === reportId);
  const related = new Set(Array.isArray(report?.followupTaskIds) ? report.followupTaskIds : []);
  return !(db.bookImportFollowups || []).some((task) =>
    (task.reportId === reportId || related.has(task.id))
      && !['completed', 'cancelled'].includes(task.status));
}
function updateReportCompletion(db, reportId) {
  for (const report of (db.bookImportReports || [])) {
    if (report.id === reportId || (report.followupTaskIds || []).some((id) =>
      (db.bookImportFollowups || []).some((task) => task.id === id && task.reportId === reportId))) {
      report.fullyReviewed = reportIsFullyReviewed(db, report.id);
    }
  }
}

function performDecision(db, task, user, body, now = new Date().toISOString()) {
  if (!task || task.status === 'completed' || !body || !CHOICES.has(body.choice)
    || !Number.isSafeInteger(body.revision) || body.revision !== task.revision) return { ok: false, error: 'stale_or_invalid_choice' };
  const klass = (db.classes || []).find((c) => c.id === task.classId);
  if (!klass) return { ok: false, error: 'missing_assigned_class' };
  const copy = (db.books || []).find((book) => book.id === task.bookId);
  if (!copy) return { ok: false, error: 'book_not_found' };
  if (taskStage(task, settingsFor(db), Date.parse(now)) === 'admin_review'
    && user.role !== 'admin') return { ok: false, error: 'task_escalated' };
  // A confirmed fixed shelf location is independent of the lending state.
  // Updating that location must never check in or reassign an active loan.
  if (['student_loan', 'class_loan'].includes(body.choice)
    && (copy.status === 'borrowed' || copy.borrowedBy || copy.borrowedByClassId)) {
    return { ok: false, error: 'book_already_borrowed' };
  }
  if (body.choice === 'student_loan') {
    const student = (db.students || []).find((entry) => entry.id === body.studentId);
    if (!student || student.active === false || student.status === 'inactive'
      || !studentClassIds(db, student).includes(klass.id)) {
      return { ok: false, error: 'student_not_in_class' };
    }
    // Exactly one active copy of each edition per student.
    const isbn = canonicalizeBookIsbn13(copy.editionIsbn)
      || canonicalizeBookIsbn13(copy.metadataIsbn);
    if ((db.books || []).some((other) => other.id !== copy.id
      && isbn && (canonicalizeBookIsbn13(other.editionIsbn)
        || canonicalizeBookIsbn13(other.metadataIsbn)) === isbn
      && other.borrowedBy === student.id)) return { ok: false, error: 'student_already_borrowed_edition' };
    const existing = Array.isArray(student.borrowedBooks) ? student.borrowedBooks : [];
    const recordedIds = new Set(existing.map((loan) =>
      typeof loan === 'string' ? loan : loan?.bookId).filter(Boolean));
    if ((db.books || []).some((other) => other.id !== copy.id
      && recordedIds.has(other.id) && isbn
      && (canonicalizeBookIsbn13(other.editionIsbn)
        || canonicalizeBookIsbn13(other.metadataIsbn)) === isbn)) {
      return { ok: false, error: 'student_already_borrowed_edition' };
    }
    if (recordedIds.has(copy.id)) {
      return { ok: false, error: 'student_record_conflict' };
    }
    student.borrowedBooks = [...existing, { bookId: copy.id, borrowedAt: null, source: 'excel_import_followup' }];
    copy.status = 'borrowed';
    copy.borrowedBy = student.id;
    copy.borrowedByClassId = null;
    copy.borrowedAt = null; copy.dueDate = null;
    task.studentId = student.id;
  } else if (body.choice === 'class_loan') {
    copy.status = 'borrowed'; copy.borrowedBy = null;
    copy.borrowedByClassId = klass.id;
    copy.borrowedAt = null; copy.dueDate = null;
  } else if (body.choice === 'fixed_location') {
    if (copy.fixedLocation && (typeof copy.fixedLocation !== 'string'
      || copy.fixedLocation.trim().toLocaleLowerCase('nl')
        !== klass.name.trim().toLocaleLowerCase('nl'))) {
      return { ok: false, error: 'existing_fixed_location_conflict' };
    }
    copy.fixedLocation = klass.name;
  } else if (body.choice === 'not_our_class') {
    task.status = 'admin_review'; task.classId = null;
    task.revision += 1; task.updatedAt = now;
    return { ok: true, task };
  }
  if (['student_loan', 'class_loan'].includes(body.choice)) {
    persistExcelLoanReceipts(db, [{
      bookId: copy.id,
      borrower: body.choice === 'student_loan'
        ? { type: 'student', id: task.studentId }
        : { type: 'class', id: klass.id },
    }]);
  }
  task.status = 'completed'; task.resolution = body.choice; task.completedAt = now;
  task.completedBy = user.id; task.revision += 1; task.updatedAt = now;
  updateReportCompletion(db, task.reportId);
  return { ok: true, task };
}

function assignTask(db, task, classId, user, expectedRevision, now = new Date().toISOString()) {
  if (user.role !== 'admin' || !Number.isSafeInteger(expectedRevision)
    || task.revision !== expectedRevision || !classId
    || !(db.classes || []).some((c) => c.id === classId)
    || task.status === 'completed') return { ok: false };
  task.classId = classId; task.status = 'open'; task.revision += 1;
  task.createdAt = now; task.updatedAt = now; task.completedAt = null;
  return { ok: true, task };
}

module.exports = {
  settingsFor, validateSettings, followupContext, contextMatchesTask,
  eligibleForDeferredContext,
  makeTask, taskStage, taskView, listTasks, reportIsFullyReviewed, updateReportCompletion,
  performDecision, assignTask,
};
