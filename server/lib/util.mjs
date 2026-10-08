export class HttpError extends Error {
  constructor(status, code, message) { super(message || code); this.status = status; this.code = code; }
}
export const bad = (code, msg) => new HttpError(400, code, msg);
export const forbidden = (msg = 'Not allowed') => new HttpError(403, 'forbidden', msg);
export const notFound = (what = 'Not found') => new HttpError(404, 'not_found', what);
export const now = () => Date.now();

const must = (cond, field, msg) => { if (!cond) throw bad('invalid_' + field, `${field}: ${msg}`); };
export const v = {
  str(x, field, { min = 1, max = 200, optional = false, re } = {}) {
    if ((x === undefined || x === null || x === '') && optional) return null;
    must(typeof x === 'string', field, 'must be text');
    const s = x.trim(); must(s.length >= min && s.length <= max, field, `length ${min}-${max}`);
    if (re) must(re.test(s), field, 'bad format');
    return s;
  },
  int(x, field, { min = -2147483648, max = 2147483647, optional = false } = {}) {
    if ((x === undefined || x === null || x === '') && optional) return null;
    const n = typeof x === 'string' && /^-?\d+$/.test(x) ? +x : x;
    must(Number.isInteger(n) && n >= min && n <= max, field, `integer ${min}..${max}`);
    return n;
  },
  num(x, field, { min = -1e9, max = 1e9, optional = false } = {}) {
    if ((x === undefined || x === null || x === '') && optional) return null;
    must(typeof x === 'number' && Number.isFinite(x) && x >= min && x <= max, field, `number ${min}..${max}`);
    return x;
  },
  oneOf(x, field, list, { optional = false } = {}) {
    if ((x === undefined || x === null || x === '') && optional) return null;
    must(list.includes(x), field, `one of ${list.join(', ')}`); return x;
  },
  date(x, field, { optional = false } = {}) {
    if ((x === undefined || x === null || x === '') && optional) return null;
    must(typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x) && !isNaN(Date.parse(x + 'T00:00:00Z')), field, 'YYYY-MM-DD');
    return x;
  },
  email(x, field) { return v.str(x, field, { max: 120, re: /^[^\s@]+@[^\s@]+\.[^\s@]+$/ }).toLowerCase(); },
  phone(x, field, opt = { optional: true }) { return v.str(x, field, { max: 24, re: /^[0-9+\-\s()]{6,24}$/, ...opt }); },
  bool(x, field) { must(typeof x === 'boolean', field, 'true/false'); return x; },
};
export const today = () => new Date().toISOString().slice(0, 10);
export function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000, r = d => (d * Math.PI) / 180;
  const a = Math.sin(r(lat2 - lat1) / 2) ** 2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(r(lon2 - lon1) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
export const csvCell = x => '"' + String(x ?? '').replace(/"/g, '""') + '"';
