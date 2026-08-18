/**
 * In-app notifications — extracted from reviewService.js (Phase 3) so
 * Phase 4's projectService.js can reuse the exact same table/functions
 * rather than duplicating them, per "reuse the Phase 3 notification
 * infrastructure, do not create another notification table." Same
 * database (estimatesDb.js), same shape. No email/SMS/push — in-app only.
 */
import { randomUUID } from 'crypto';
import db from './estimatesDb.js';

export function createNotification({
  userId, type, message, estimateId = null, projectId = null,
}) {
  db.prepare(`
    INSERT INTO notifications (id, user_id, type, message, estimate_id, project_id, created_at)
    VALUES (@id, @userId, @type, @message, @estimateId, @projectId, @createdAt)
  `).run({
    id: randomUUID(), userId, type, message, estimateId, projectId, createdAt: new Date().toISOString(),
  });
}

export function notificationToPublic(row) {
  return {
    id: row.id,
    type: row.type,
    message: row.message,
    estimateId: row.estimate_id,
    projectId: row.project_id ?? null,
    readAt: row.read_at,
    createdAt: row.created_at,
  };
}

export function listNotifications(actor, { unreadOnly = false } = {}) {
  const rows = unreadOnly
    ? db.prepare('SELECT * FROM notifications WHERE user_id = ? AND read_at IS NULL ORDER BY created_at DESC').all(actor.userId)
    : db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC').all(actor.userId);
  return rows.map(notificationToPublic);
}

export class NotificationNotFoundError extends Error {
  constructor(message = 'Notification not found.') {
    super(message);
    this.name = 'NotificationNotFoundError';
    this.status = 404;
  }
}

export class NotificationAccessError extends Error {
  constructor(message = 'You do not have access to this notification.') {
    super(message);
    this.name = 'NotificationAccessError';
    this.status = 403;
  }
}

export function markNotificationRead(notificationId, actor) {
  const row = db.prepare('SELECT * FROM notifications WHERE id = ?').get(notificationId);
  if (!row) throw new NotificationNotFoundError();
  if (row.user_id !== actor.userId) throw new NotificationAccessError();
  const ts = new Date().toISOString();
  db.prepare('UPDATE notifications SET read_at = ? WHERE id = ?').run(ts, notificationId);
  return notificationToPublic({ ...row, read_at: ts });
}
