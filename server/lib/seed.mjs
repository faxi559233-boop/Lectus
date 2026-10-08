import { hashPassword } from './auth.mjs';
import { now } from './util.mjs';
import { enrollSection, syncStudent } from '../routes/admin.mjs';

/** Demo organisation for tests and trials: 1 department, 1 program, 2 sections, 6 courses, teachers, HOD, students. */
export async function seedDemo(db, { students = 60, password = 'demo-Password-123', lectures = 0 } = {}) {
  const hash = await hashPassword(password), t = now();
  const U = (email, name, role, dept, mc = 0) => Number(db.prepare('INSERT INTO users(email,name,role,pw_hash,must_change,dept_id,created_at) VALUES (?,?,?,?,?,?,?)').run(email, name, role, hash, mc, dept, t).lastInsertRowid);
  const dept = Number(db.prepare("INSERT INTO departments(code,name) VALUES ('ECO','Economics')").run().lastInsertRowid);
  const dept2 = Number(db.prepare("INSERT INTO departments(code,name) VALUES ('CS','Computer Science')").run().lastInsertRowid);
  const prog = Number(db.prepare("INSERT INTO programs(dept_id,code,name) VALUES (?,'BS-ECO','BS Economics')").run(dept).lastInsertRowid);
  const term = Number(db.prepare("INSERT INTO terms(name,starts,ends,active) VALUES ('Fall 2026','2026-09-01','2027-01-15',1)").run().lastInsertRowid);
  const secs = ['A', 'B'].map(n => Number(db.prepare('INSERT INTO sections(program_id,term_id,name,semester_no) VALUES (?,?,?,5)').run(prog, term, n).lastInsertRowid));
  const admin = U('admin@demo.local', 'Demo Admin', 'admin', null), hod = U('hod@demo.local', 'Demo HOD', 'hod', dept), hod2 = U('hod.cs@demo.local', 'CS HOD', 'hod', dept2);
  const teachers = [1, 2, 3].map(i => U(`teacher${i}@demo.local`, `Teacher ${i}`, 'teacher', dept));
  const courses = ['ECO501 Micro Economics', 'ECO502 Macro Economics', 'ECO503 Statistics', 'ECO504 Econometrics', 'ECO505 Public Finance', 'ECO506 Development Economics']
    .map(s => Number(db.prepare('INSERT INTO courses(dept_id,code,name,credits) VALUES (?,?,?,3)').run(dept, s.slice(0, 6), s.slice(7)).lastInsertRowid));
  const offerings = []; courses.forEach((c, i) => secs.forEach(s => offerings.push(Number(db.prepare('INSERT INTO offerings(course_id,section_id,teacher_id,room,days,start_time) VALUES (?,?,?,?,?,?)').run(c, s, teachers[i % 3], 'R' + (i + 1), '1,3', '09:00').lastInsertRowid))));
  const studentIds = [];
  for (let i = 0; i < students; i++) {
    const roll = `21-ECO-${String(i + 1).padStart(3, '0')}`, uid = Number(db.prepare("INSERT INTO users(email,name,role,pw_hash,must_change,created_at) VALUES (?,?,'student',?,0,?)").run(`${roll.toLowerCase()}@student.local`, `Student ${i + 1}`, hash, t).lastInsertRowid);
    studentIds.push(Number(db.prepare('INSERT INTO students(user_id,roll,name,section_id,created_at) VALUES (?,?,?,?,?)').run(uid, roll, `Student ${i + 1}`, secs[i % 2], t).lastInsertRowid));
  }
  for (const s of secs) enrollSection(db, s);
  if (lectures) {
    const ins = db.prepare("INSERT INTO attendance(session_id,student_id,status,method,marked_by,marked_at,updated_at) VALUES (?,?,?,'manual',?,?,?)");
    for (const o of offerings) {
      const stu = db.prepare('SELECT student_id FROM enrollments WHERE offering_id=?').all(o).map(x => x.student_id);
      for (let l = 0; l < lectures; l++) {
        const sid = Number(db.prepare('INSERT INTO lecture_sessions(offering_id,date,topic,created_by,created_at) VALUES (?,?,?,?,?)').run(o, `2026-09-${String(l + 1).padStart(2, '0')}`, `Topic ${l + 1}`, teachers[0], t).lastInsertRowid);
        stu.forEach((s, k) => ins.run(sid, s, (k + l) % 11 === 0 ? 'A' : 'P', teachers[0], t, t));
      }
    }
  }
  return { password, admin, hod, hod2, dept, dept2, prog, term, secs, teachers, courses, offerings, studentIds };
}
