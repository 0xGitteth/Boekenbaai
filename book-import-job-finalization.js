'use strict';
// Terminal status is a short, independent transaction. A completed import
// cannot be reported as failed because a concurrent DB update changed.
const { mutateJsonLockedAsync, readJsonSnapshot } = require('./database-write-coordinator');

async function finishLegacyImportJob({ dataPath, jobId, succeeded, payload,
  totalRows, errorMessage, waitMs = 6000 } = {}) {
  if (!dataPath || !jobId) throw new Error('Databasepad en importjob zijn verplicht.');
  return mutateJsonLockedAsync({
    lockPath: dataPath, filePath: dataPath, waitMs,
    read: () => readJsonSnapshot(dataPath),
    mutate: db => {
      const jobs = Array.isArray(db.importJobs) ? db.importJobs : [];
      const index = jobs.findIndex(job => job?.id === jobId);
      if (index < 0 || ['completed', 'failed', 'cancelled', 'interrupted']
        .includes(jobs[index]?.status)) return false;
      const job = jobs[index];
      const finishedAt = new Date().toISOString();
      let changes;
      if (!succeeded && job.booksCommittedAt) {
        // The internal HTTP import may have returned 409/500 *after* its
        // book transaction succeeded. Never turn durable books into a
        // reported failure and invite a duplicate import.
        const persisted = job.committedSummary || {};
        changes = {
          status: 'completed', finishedAt,
          currentStage: 'Voltooid', error: '', failed: 0,
          processed: Number(persisted.processed ?? job.processed ?? totalRows ?? 0),
          created: Number(persisted.created ?? job.created ?? 0),
          updated: Number(persisted.updated ?? job.updated ?? 0),
          skipped: Number(persisted.skipped ?? job.skipped ?? 0),
          summary: {
            created: Number(persisted.created ?? job.created ?? 0),
            updated: Number(persisted.updated ?? job.updated ?? 0),
            skipped: Number(persisted.skipped ?? job.skipped ?? 0),
            failed: 0,
          },
        };
      } else if (!succeeded) {
        changes = {
          status: 'failed', finishedAt,
          error: errorMessage || payload?.message || 'Importjob mislukt',
          failed: 1,
        };
      } else {
        const summary = {
          created: Number(payload?.created || 0),
          updated: Number(payload?.updated || 0),
          skipped: Array.isArray(payload?.skipped) ? payload.skipped.length : 0,
          failed: Number(payload?.failed || 0),
        };
        changes = payload?.cancelled || job.cancelRequested ? {
          status: 'cancelled', finishedAt, cancelledAt: finishedAt,
          currentStage: 'Geannuleerd', summary, result: payload, error: '',
        } : {
          status: 'completed', finishedAt, processed: totalRows,
          created: summary.created, updated: summary.updated, skipped: summary.skipped,
          summary, currentStage: 'Voltooid', result: payload, error: '',
        };
      }
      jobs[index] = { ...job, ...changes, updatedAt: finishedAt };
      return db;
    },
  });
}
module.exports = { finishLegacyImportJob };
