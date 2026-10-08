import { now } from './util.mjs';
export function audit(db, actor, action, entity, entityId, detail, ip) {
  db.prepare('INSERT INTO audit_log(ts,actor_id,action,entity,entity_id,detail,ip) VALUES (?,?,?,?,?,?,?)')
    .run(now(), actor ? actor.id : null, action, entity || null, entityId == null ? null : String(entityId), detail === undefined ? null : JSON.stringify(detail), ip || null);
}
