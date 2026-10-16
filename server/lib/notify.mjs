import { now } from './util.mjs';
/** Adds an in-app notification (the push worker sends it to the user's devices). */
export const notify = (db, userId, title, body, url = '/portal/#/inbox') => { if (userId) db.prepare('INSERT INTO notifications(user_id,title,body,url,created_at) VALUES (?,?,?,?,?)').run(userId, title, String(body).slice(0, 500), url, now()); };
