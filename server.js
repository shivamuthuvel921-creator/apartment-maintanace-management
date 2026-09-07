import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { DatabaseSync } from 'node:sqlite';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import multer from 'multer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'vijay_apartment_secret_2026_production_key';

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Database
const dbPath = path.join(__dirname, 'data.db');
const db = new DatabaseSync(dbPath);
db.exec(`PRAGMA journal_mode=WAL;`);

function initDB() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE,
      email TEXT UNIQUE,
      password_hash TEXT,
      role TEXT CHECK(role IN ('admin','committee','staff','resident')),
      display_name TEXT,
      phone TEXT,
      resident_id INTEGER,
      is_active INTEGER DEFAULT 1,
      created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS residents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      roll_no TEXT UNIQUE,
      name TEXT,
      house_id INTEGER,
      relation TEXT,
      phone TEXT,
      email TEXT,
      dob TEXT,
      gender TEXT,
      type TEXT,
      status TEXT DEFAULT 'Active',
      photo_url TEXT,
      address TEXT,
      city TEXT,
      state TEXT,
      country TEXT,
      postal_code TEXT,
      emergency_name TEXT,
      emergency_phone TEXT,
      created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS houses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      house_no TEXT UNIQUE,
      block TEXT,
      floor INTEGER,
      bhk INTEGER,
      status TEXT,
      occupancy TEXT,
      resident_id INTEGER,
      monthly_due INTEGER DEFAULT 2500,
      created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      date TEXT,
      time TEXT,
      venue TEXT,
      organizer TEXT,
      budget INTEGER,
      fund_collected INTEGER DEFAULT 0,
      status TEXT,
      description TEXT,
      created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS meetings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT,
      date TEXT,
      time TEXT,
      venue TEXT,
      agenda TEXT,
      attendees TEXT,
      minutes_status TEXT,
      status TEXT,
      created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      transaction_id TEXT UNIQUE,
      house_id INTEGER,
      resident_id INTEGER,
      amount INTEGER,
      date TEXT,
      method TEXT,
      status TEXT,
      verified_by TEXT,
      receipt_no TEXT,
      notes TEXT,
      created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS maintenance_tickets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_no TEXT UNIQUE,
      category TEXT,
      location TEXT,
      house_id INTEGER,
      assigned_to TEXT,
      priority TEXT,
      due_date TEXT,
      status TEXT,
      cost INTEGER,
      description TEXT,
      vendor TEXT,
      created_at TEXT,
      updated_at TEXT
    );
    CREATE TABLE IF NOT EXISTS complaints (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      complaint_no TEXT UNIQUE,
      house_id INTEGER,
      resident_id INTEGER,
      category TEXT,
      subject TEXT,
      description TEXT,
      priority TEXT,
      assigned_to TEXT,
      status TEXT,
      created_at TEXT,
      updated_at TEXT
    );
    CREATE TABLE IF NOT EXISTS complaint_comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      complaint_id INTEGER,
      author TEXT,
      role TEXT,
      message TEXT,
      created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS committee_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      role TEXT,
      block TEXT,
      phone TEXT,
      email TEXT,
      term TEXT,
      photo_url TEXT
    );
    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      title TEXT,
      message TEXT,
      type TEXT,
      is_read INTEGER DEFAULT 0,
      created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      user_name TEXT,
      role TEXT,
      action TEXT,
      module TEXT,
      record_id TEXT,
      details TEXT,
      ip TEXT,
      timestamp TEXT
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
    CREATE TABLE IF NOT EXISTS password_resets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      used INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);
  const userTable = db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='users'`).get();
  if(userTable?.sql && !userTable.sql.includes("'committee'")){
    db.exec(`
      ALTER TABLE users RENAME TO users_legacy;
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE,
        email TEXT UNIQUE,
        password_hash TEXT,
        role TEXT CHECK(role IN ('admin','committee','staff','resident')),
        display_name TEXT,
        phone TEXT,
        resident_id INTEGER,
        is_active INTEGER DEFAULT 1,
        created_at TEXT
      );
      INSERT INTO users (id,username,email,password_hash,role,display_name,phone,resident_id,is_active,created_at)
        SELECT id,username,email,password_hash,role,display_name,phone,resident_id,is_active,created_at FROM users_legacy;
      DROP TABLE users_legacy;
    `);
  }
}

initDB();

// Extended schema migrations for Resident Profile (safe, idempotent)
function ensureColumn(table, column, definition){
  try{
    const cols = db.prepare(`SELECT name FROM pragma_table_info(?)`).all(table).map(r=>r.name);
    if(!cols.includes(column)){
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
      console.log(`Migrated: ${table}.${column}`);
    }
  }catch(e){ console.error('migration fail', column, e.message); }
}
ensureColumn('residents','marital_status',`TEXT DEFAULT ''`);
ensureColumn('residents','preferred_language',`TEXT DEFAULT 'English'`);
ensureColumn('residents','emergency_relation',`TEXT DEFAULT ''`);
ensureColumn('residents','emergency_alt_phone',`TEXT DEFAULT ''`);
ensureColumn('residents','address2',`TEXT DEFAULT ''`);
ensureColumn('residents','parking_info',`TEXT DEFAULT ''`);
ensureColumn('residents','move_in_date',`TEXT DEFAULT ''`);
ensureColumn('residents','photo_url',`TEXT DEFAULT ''`);
ensureColumn('users','photo_url',`TEXT DEFAULT ''`);
db.exec(`
  CREATE TABLE IF NOT EXISTS notification_preferences (
    user_id INTEGER PRIMARY KEY,
    email_notifications INTEGER DEFAULT 1,
    payment_reminders INTEGER DEFAULT 1,
    complaint_updates INTEGER DEFAULT 1,
    maintenance_updates INTEGER DEFAULT 1,
    event_notifications INTEGER DEFAULT 1,
    meeting_notifications INTEGER DEFAULT 1,
    apartment_notices INTEGER DEFAULT 1,
    updated_at TEXT,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );
`);
// Ensure uploads dir exists
const uploadDir = path.join(__dirname, 'public', 'uploads');
if(!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
const storage = multer.diskStorage({
  destination: (req,file,cb)=> cb(null, uploadDir),
  filename: (req,file,cb)=>{
    const ext = path.extname(file.originalname).toLowerCase();
    const name = `profile_${req.user.id}_${Date.now()}${ext}`;
    cb(null, name);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req,file,cb)=>{
    const ok = ['image/jpeg','image/png','image/webp','image/jpg'].includes(file.mimetype);
    if(!ok) return cb(new Error('Only JPG/PNG/WebP allowed'));
    cb(null, true);
  }
});

// Helpers
function nowISO() { return new Date().toISOString(); }
function uid(prefix, n) { return `${prefix}-${String(n).padStart(4,'0')}`; }
function nextId(table, prefix, col) {
  const row = db.prepare(`SELECT COUNT(*) as c FROM ${table}`).get();
  const n = (row.c || 0) + 1 + Math.floor(Math.random()*100) + 2000;
  // Ensure uniqueness loop
  for (let i=0;i<10;i++){
    const candidate = uid(prefix, n+i);
    const exists = db.prepare(`SELECT id FROM ${table} WHERE ${col}=?`).get(candidate);
    if (!exists) return candidate;
  }
  return uid(prefix, Date.now()%10000);
}

function audit(user, action, module, record_id, details) {
  try {
    db.prepare(`INSERT INTO audit_logs (user_id,user_name,role,action,module,record_id,details,ip,timestamp) VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(user?.id||0, user?.display_name||user?.username||'System', user?.role||'system', action, module, String(record_id||''), details||'', '', nowISO());
  } catch(e){ console.error('audit fail',e.message)}
}
function notify(user_id, title, message, type='info') {
  try {
    db.prepare(`INSERT INTO notifications (user_id,title,message,type,is_read,created_at) VALUES (?,?,?,?,?,?)`)
      .run(user_id, title, message, type, 0, nowISO());
  } catch(e){}
}

// Auth middleware
function authRequired(req,res,next){
  const h = req.headers.authorization;
  if(!h || !h.startsWith('Bearer ')) return res.status(401).json({error:'Unauthorized. Please log in again.', code:'NO_TOKEN'});
  const token = h.slice(7);
  try{
    const payload = jwt.verify(token, JWT_SECRET);
    const user = db.prepare(`SELECT * FROM users WHERE id=?`).get(payload.id);
    if(!user || !user.is_active) return res.status(401).json({error:'Account disabled. Contact admin.', code:'ACCOUNT_DISABLED'});
    req.user = user;
    next();
  }catch(e){
    if(e.name==='TokenExpiredError') return res.status(401).json({error:'Your session has expired. Please log in again.', code:'TOKEN_EXPIRED'});
    return res.status(401).json({error:'Invalid token. Please log in again.', code:'INVALID_TOKEN'})
  }
}
function requireRole(...roles){
  return (req,res,next)=>{
    if(!roles.includes(req.user.role)) return res.status(403).json({error:'Forbidden: insufficient role'});
    next();
  }
}

// Seed
function seedIfEmpty(){
  const uc = db.prepare(`SELECT COUNT(*) as c FROM users`).get().c;
  if(uc>0) return;
  console.log('Seeding database...');
  const pwAdmin = bcrypt.hashSync('admin123',10);
  const pwRes = bcrypt.hashSync('resident123',10);
  const now = nowISO();
  // residents seed first
  const residentData = [
    { roll_no:'RES-1001', name:'Arjun Mehra', house_no:'A-101', relation:'Self', phone:'9876543210', email:'arjun.mehra@example.com', dob:'1985-04-12', gender:'Male', type:'Owner', block:'A', floor:1, bhk:3 },
    { roll_no:'RES-1002', name:'Priya Sharma', house_no:'A-102', relation:'Self', phone:'9876543211', email:'priya.sharma@example.com', dob:'1990-07-22', gender:'Female', type:'Owner', block:'A', floor:1, bhk:3 },
    { roll_no:'RES-1003', name:'Vikram Singh', house_no:'A-103', relation:'Self', phone:'9876543212', email:'vikram.singh@example.com', dob:'1988-11-03', gender:'Male', type:'Tenant', block:'A', floor:1, bhk:2 },
    { roll_no:'RES-1004', name:'Sneha Reddy', house_no:'B-201', relation:'Self', phone:'9876543213', email:'sneha.reddy@example.com', dob:'1992-02-18', gender:'Female', type:'Owner', block:'B', floor:2, bhk:2 },
    { roll_no:'RES-1005', name:'Rohan Desai', house_no:'B-202', relation:'Self', phone:'9876543214', email:'rohan.desai@example.com', dob:'1986-09-09', gender:'Male', type:'Owner', block:'B', floor:2, bhk:3 },
    { roll_no:'RES-1006', name:'Ananya Gupta', house_no:'B-204', relation:'Self', phone:'9876543215', email:'ananya.gupta@example.com', dob:'1991-05-30', gender:'Female', type:'Tenant', block:'B', floor:2, bhk:2 },
    { roll_no:'RES-1007', name:'Karan Malhotra', house_no:'C-301', relation:'Self', phone:'9876543216', email:'karan.malhotra@example.com', dob:'1987-12-14', gender:'Male', type:'Owner', block:'C', floor:3, bhk:3 },
    { roll_no:'RES-1008', name:'Meera Nair', house_no:'C-302', relation:'Self', phone:'9876543217', email:'meera.nair@example.com', dob:'1993-03-25', gender:'Female', type:'Owner', block:'C', floor:3, bhk:2 },
  ];
  const housesSeed = [
    { house_no:'A-101', block:'A', floor:1, bhk:3, occupancy:'Occupied' },
    { house_no:'A-102', block:'A', floor:1, bhk:3, occupancy:'Occupied' },
    { house_no:'A-103', block:'A', floor:1, bhk:2, occupancy:'Occupied' },
    { house_no:'A-104', block:'A', floor:1, bhk:2, occupancy:'Vacant' },
    { house_no:'B-201', block:'B', floor:2, bhk:2, occupancy:'Occupied' },
    { house_no:'B-202', block:'B', floor:2, bhk:3, occupancy:'Occupied' },
    { house_no:'B-203', block:'B', floor:2, bhk:1, occupancy:'Vacant' },
    { house_no:'B-204', block:'B', floor:2, bhk:2, occupancy:'Occupied' },
    { house_no:'C-301', block:'C', floor:3, bhk:3, occupancy:'Occupied' },
    { house_no:'C-302', block:'C', floor:3, bhk:2, occupancy:'Occupied' },
    { house_no:'C-303', block:'C', floor:3, bhk:3, occupancy:'Vacant' },
    { house_no:'D-401', block:'D', floor:4, bhk:3, occupancy:'Occupied' },
  ];
  // Insert houses
  for(let h of housesSeed){
    db.prepare(`INSERT INTO houses (house_no,block,floor,bhk,status,occupancy,monthly_due,created_at) VALUES (?,?,?,?,?,?,?,?)`)
      .run(h.house_no,h.block,h.floor,h.bhk,'Active',h.occupancy,2500,now);
  }
  // Insert residents and link houses
  for(let r of residentData){
    const house = db.prepare(`SELECT id FROM houses WHERE house_no=?`).get(r.house_no);
    const hid = house ? house.id : null;
    db.prepare(`INSERT INTO residents (roll_no,name,house_id,relation,phone,email,dob,gender,type,status,address,city,state,country,postal_code,emergency_name,emergency_phone,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(r.roll_no,r.name,hid,r.relation,r.phone,r.email,r.dob,r.gender,r.type,'Active',`${r.house_no}, Vijay Apartment, MG Road`, 'Bengaluru','Karnataka','India','560001','Rajesh Kumar','9876500000',now);
    const resId = db.prepare(`SELECT id FROM residents WHERE roll_no=?`).get(r.roll_no).id;
    if(hid) db.prepare(`UPDATE houses SET resident_id=? WHERE id=?`).run(resId, hid);
  }
  // Also add D-401 resident
  const extra = db.prepare(`SELECT id FROM houses WHERE house_no='D-401'`).get();
  db.prepare(`INSERT INTO residents (roll_no,name,house_id,relation,phone,email,dob,gender,type,status,address,city,state,country,postal_code,emergency_name,emergency_phone,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run('RES-1009','Suresh Kumar',extra.id,'Self','9876543218','suresh.kumar@example.com','1984-06-10','Male','Owner','Active','D-401, Vijay Apartment, MG Road','Bengaluru','Karnataka','India','560001','Lakshmi Kumar','9876500001',now);
  const sId = db.prepare(`SELECT id FROM residents WHERE roll_no='RES-1009'`).get().id;
  db.prepare(`UPDATE houses SET resident_id=? WHERE id=?`).run(sId, extra.id);

  // Add family members for A-102 (Priya Sharma family)
  const houseA102 = db.prepare(`SELECT id FROM houses WHERE house_no='A-102'`).get();
  const priya = db.prepare(`SELECT id FROM residents WHERE roll_no='RES-1002'`).get();
  const family = [
    { name:'Amit Sharma', relation:'Spouse', phone:'9876543220', gender:'Male', dob:'1989-08-10', type:'Owner' },
    { name:'Aarav Sharma', relation:'Son', phone:'', gender:'Male', dob:'2015-04-05', type:'Dependent' },
    { name:'Diya Sharma', relation:'Daughter', phone:'', gender:'Female', dob:'2018-09-12', type:'Dependent' },
  ];
  family.forEach((f,i)=>{
    const roll=`RES-10${10+i}`;
    db.prepare(`INSERT INTO residents (roll_no,name,house_id,relation,phone,email,dob,gender,type,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
      .run(roll,f.name,houseA102.id,f.relation,f.phone,f.name.toLowerCase().replace(' ','.')+'@example.com',f.dob,f.gender,f.type,'Active',now);
  });

  // Users
  db.prepare(`INSERT INTO users (username,email,password_hash,role,display_name,phone,is_active,created_at) VALUES (?,?,?,?,?,?,?,?)`)
    .run('admin','admin@vijayapartment.com',pwAdmin,'admin','Admin','9876500000',1,now);
  // Resident users linked to residents
  const residentsForUsers = db.prepare(`SELECT * FROM residents LIMIT 3`).all();
  residentsForUsers.forEach((r,idx)=>{
    const uname = r.email.split('@')[0];
    const existing = db.prepare(`SELECT id FROM users WHERE email=?`).get(r.email);
    if(!existing){
      db.prepare(`INSERT INTO users (username,email,password_hash,role,display_name,phone,resident_id,is_active,created_at) VALUES (?,?,?,?,?,?,?,?,?)`)
        .run(uname, r.email, pwRes, 'resident', r.name, r.phone, r.id, 1, now);
    }
  });
  // Additional resident login: priya
  // ensure priya user
  // already created if in first 3? priya is second, yes

  // Events
  const events = [
    { name:'Independence Day Celebration', date:'2026-08-15', time:'09:00 AM', venue:'Community Hall', organizer:'Cultural Committee', budget:100000, fund_collected:85000, status:'Upcoming' },
    { name:'Ganesh Chaturthi Festival', date:'2026-09-10', time:'06:00 PM', venue:'Temple Courtyard', organizer:'Festival Committee', budget:75000, fund_collected:62000, status:'Upcoming' },
    { name:'Annual General Meeting', date:'2026-07-20', time:'10:00 AM', venue:'Conference Hall', organizer:'Secretary', budget:15000, fund_collected:15000, status:'Completed' },
    { name:'Diwali Celebration', date:'2026-10-24', time:'07:00 PM', venue:'Terrace Garden', organizer:'Cultural Committee', budget:120000, fund_collected:40000, status:'Upcoming' },
    { name:'Health Camp', date:'2026-06-15', time:'08:00 AM', venue:'Community Hall', organizer:'Welfare Committee', budget:30000, fund_collected:30000, status:'Completed' },
  ];
  events.forEach(e=>{
    db.prepare(`INSERT INTO events (name,date,time,venue,organizer,budget,fund_collected,status,description,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .run(e.name,e.date,e.time,e.venue,e.organizer,e.budget,e.fund_collected,e.status,`${e.name} organized at ${e.venue}`,now);
  });

  // Meetings
  const meetings = [
    { title:'Monthly Committee Meeting - July', date:'2026-07-05', time:'06:00 PM', venue:'Meeting Hall A', agenda:'Monthly maintenance, security review, upcoming events', minutes_status:'Completed', status:'Completed' },
    { title:'Emergency Meeting - Water Supply', date:'2026-08-02', time:'07:30 PM', venue:'Community Hall', agenda:'Water shortage resolution, tanker arrangement', minutes_status:'Pending', status:'Upcoming' },
    { title:'Budget Planning 2026-27', date:'2026-08-20', time:'05:00 PM', venue:'Conference Room', agenda:'Annual budget approval, fund allocation', minutes_status:'Pending', status:'Upcoming' },
  ];
  meetings.forEach(m=>{
    db.prepare(`INSERT INTO meetings (title,date,time,venue,agenda,attendees,minutes_status,status,created_at) VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(m.title,m.date,m.time,m.venue,m.agenda,'12 members',m.minutes_status,m.status,now);
  });

  // Payments - generate some for history
  const houses = db.prepare(`SELECT * FROM houses WHERE occupancy='Occupied' LIMIT 6`).all();
  let txnBase = 2038;
  houses.forEach((h,idx)=>{
    const res = db.prepare(`SELECT * FROM residents WHERE house_id=?`).get(h.id);
    if(!res) return;
    const months = ['2026-05-10','2026-06-10','2026-07-10'];
    months.forEach((d,mi)=>{
      const amt = mi===1 && idx===0 ? 1500 : 2500;
      const status = amt<2500 ? 'Partial' : 'Paid';
      const tid = `PAY-${txnBase++}`;
      db.prepare(`INSERT INTO payments (transaction_id,house_id,resident_id,amount,date,method,status,verified_by,receipt_no,notes,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
        .run(tid,h.id,res.id,amt,d,'UPI',status,'Admin',`RCP-${tid}`,`Monthly maintenance ${d}`,now);
    });
  });
  // Overdue one
  const houseB204 = db.prepare(`SELECT id FROM houses WHERE house_no='B-204'`).get();
  const resB204 = db.prepare(`SELECT id FROM residents WHERE house_id=?`).get(houseB204.id);
  db.prepare(`INSERT INTO payments (transaction_id,house_id,resident_id,amount,date,method,status,verified_by,receipt_no,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run('PAY-2099',houseB204.id,resB204.id,2500,'2026-08-10','Pending','Pending','','',now);

  // Maintenance tickets
  const maint = [
    { ticket_no:'MT-1042', category:'Electrical', location:'Block A - Common Area', house_id:null, assigned_to:'Ramesh Electricals', priority:'High', due_date:'2026-09-05', status:'In Progress', cost:3500, description:'Street light not working near Block A entrance' },
    { ticket_no:'MT-1043', category:'Plumbing', location:'House B-204', house_id: houseB204.id, assigned_to:'Kumar Plumbing', priority:'High', due_date:'2026-09-03', status:'Open', cost:2800, description:'Water leakage in bathroom, ceiling dampness' },
    { ticket_no:'MT-1044', category:'Lift', location:'Block C Lift', house_id:null, assigned_to:'Otis Services', priority:'Medium', due_date:'2026-09-10', status:'Assigned', cost:12000, description:'Lift making noise, door sensor issue' },
    { ticket_no:'MT-1045', category:'Cleaning', location:'Terrace', house_id:null, assigned_to:'CleanCare', priority:'Low', due_date:'2026-08-28', status:'Completed', cost:1500, description:'Terrace cleaning before monsoon' },
    { ticket_no:'MT-1046', category:'Security', location:'Main Gate', house_id:null, assigned_to:'Secure Squad', priority:'Medium', due_date:'2026-09-15', status:'Open', cost:0, description:'CCTV camera offline at main gate' },
  ];
  maint.forEach(m=>{
    db.prepare(`INSERT INTO maintenance_tickets (ticket_no,category,location,house_id,assigned_to,priority,due_date,status,cost,description,vendor,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(m.ticket_no,m.category,m.location,m.house_id,m.assigned_to,m.priority,m.due_date,m.status,m.cost,m.description,m.assigned_to,now,now);
  });

  // Complaints
  const comp = [
    { complaint_no:'CMP-1024', house_id: houseB204.id, resident_id: resB204.id, category:'Plumbing', subject:'Water Leakage', description:'Continuous water leakage from ceiling in bedroom, wall paint damaged', priority:'High', assigned_to:'Kumar Plumbing', status:'In Progress' },
    { complaint_no:'CMP-1025', house_id: houses[0].id, resident_id: db.prepare(`SELECT id FROM residents WHERE house_id=?`).get(houses[0].id).id, category:'Electrical', subject:'Power Fluctuation', description:'Frequent power cut in flat, MCB tripping', priority:'Medium', assigned_to:'Ramesh Electricals', status:'Open' },
    { complaint_no:'CMP-1026', house_id: houses[1].id, resident_id: db.prepare(`SELECT id FROM residents WHERE house_id=?`).get(houses[1].id).id, category:'Housekeeping', subject:'Garbage Not Collected', description:'Garbage not collected for 3 days, foul smell', priority:'Low', assigned_to:'', status:'Resolved' },
    { complaint_no:'CMP-1027', house_id: houses[2].id, resident_id: db.prepare(`SELECT id FROM residents WHERE house_id=?`).get(houses[2].id).id, category:'Security', subject:'Parking Issue', description:'Unauthorized vehicle parked in my slot', priority:'Medium', assigned_to:'Security Team', status:'Assigned' },
    { complaint_no:'CMP-1028', house_id: houseB204.id, resident_id: resB204.id, category:'Noise', subject:'Loud Music Late Night', description:'Neighbour playing loud music after 11pm daily', priority:'Low', assigned_to:'', status:'Closed' },
  ];
  comp.forEach(c=>{
    db.prepare(`INSERT INTO complaints (complaint_no,house_id,resident_id,category,subject,description,priority,assigned_to,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
      .run(c.complaint_no,c.house_id,c.resident_id,c.category,c.subject,c.description,c.priority,c.assigned_to,c.status,now,now);
    const cid = db.prepare(`SELECT id FROM complaints WHERE complaint_no=?`).get(c.complaint_no).id;
    db.prepare(`INSERT INTO complaint_comments (complaint_id,author,role,message,created_at) VALUES (?,?,?,?,?)`)
      .run('Admin','Admin','admin','Complaint received and under review',now);
    if(c.status!=='Open'){
      db.prepare(`INSERT INTO complaint_comments (complaint_id,author,role,message,created_at) VALUES (?,?,?,?,?)`)
        .run(c.assigned_to||'Staff','Staff','staff',`Assigned to ${c.assigned_to||'team'} and work started`,now);
    }
  });

  // Committee
  const committee = [
    { name:'R. Suresh', role:'President', block:'A', phone:'9876500010', email:'suresh.president@vijay.com', term:'2026-27' },
    { name:'Lakshmi Iyer', role:'Secretary', block:'B', phone:'9876500011', email:'lakshmi.secretary@vijay.com', term:'2026-27' },
    { name:'Anil Kapoor', role:'Treasurer', block:'C', phone:'9876500012', email:'anil.treasurer@vijay.com', term:'2026-27' },
    { name:'Sunita Rao', role:'Committee Member', block:'A', phone:'9876500013', email:'sunita@vijay.com', term:'2026-27' },
    { name:'Vijay Kumar', role:'Committee Member', block:'D', phone:'9876500014', email:'vijay.kumar@vijay.com', term:'2026-27' },
  ];
  committee.forEach(c=>{
    db.prepare(`INSERT INTO committee_members (name,role,block,phone,email,term,photo_url) VALUES (?,?,?,?,?,?,?)`)
      .run(c.name,c.role,c.block,c.phone,c.email,c.term,'');
  });

  // Notifications for admin and residents
  const adminUser = db.prepare(`SELECT id FROM users WHERE role='admin'`).get();
  db.prepare(`INSERT INTO notifications (user_id,title,message,type,is_read,created_at) VALUES (?,?,?,?,?,?)`)
    .run(adminUser.id,'Payment recorded','₹2,500 — House A-101 payment verified','success',0,now);
  db.prepare(`INSERT INTO notifications (user_id,title,message,type,is_read,created_at) VALUES (?,?,?,?,?,?)`)
    .run(adminUser.id,'Complaint created','Water leakage — House B-204','warning',0, new Date(Date.now()-22*60000).toISOString());
  db.prepare(`INSERT INTO notifications (user_id,title,message,type,is_read,created_at) VALUES (?,?,?,?,?,?)`)
    .run(adminUser.id,'Maintenance completed','Electrical repair — Block A completed','info',0, new Date(Date.now()-3600000).toISOString());

  // Resident notifications
  const priyaUser = db.prepare(`SELECT id FROM users WHERE email='priya.sharma@example.com'`).get();
  if(priyaUser){
    db.prepare(`INSERT INTO notifications (user_id,title,message,type,is_read,created_at) VALUES (?,?,?,?,?,?)`)
      .run(priyaUser.id,'Payment Due Reminder','Your maintenance due of ₹2,500 is due on 10 Sep 2026','warning',0,now);
    db.prepare(`INSERT INTO notifications (user_id,title,message,type,is_read,created_at) VALUES (?,?,?,?,?,?)`)
      .run(priyaUser.id,'Complaint Update','Your complaint CMP-1026 has been resolved','success',0,now);
  }

  // Settings
  const settings = [
    ['apartment_name','Vijay Apartment'],
    ['apartment_address','MG Road, Bengaluru, Karnataka 560001'],
    ['maintenance_amount','2500'],
    ['currency','INR'],
    ['blocks','A,B,C,D'],
    ['floors','4'],
  ];
  settings.forEach(([k,v])=> db.prepare(`INSERT OR IGNORE INTO settings (key,value) VALUES (?,?)`).run(k,v));

  console.log('Seed complete');
}
seedIfEmpty();

function ensureRoleUsers(){
  const accounts = [
    { username:'committee', email:'committee@vijayapartment.com', password:'committee123', role:'committee', display_name:'Committee Desk', phone:'9876500020' },
    { username:'staff', email:'staff@vijayapartment.com', password:'staff123', role:'staff', display_name:'Maintenance Desk', phone:'9876500030' },
  ];
  accounts.forEach(account=>{
    const existing = db.prepare(`SELECT id FROM users WHERE email=? OR username=?`).get(account.email, account.username);
    if(!existing){
      db.prepare(`INSERT INTO users (username,email,password_hash,role,display_name,phone,is_active,created_at) VALUES (?,?,?,?,?,?,?,?)`)
        .run(account.username, account.email, bcrypt.hashSync(account.password,10), account.role, account.display_name, account.phone, 1, nowISO());
    }
  });
}
ensureRoleUsers();

// Auth helpers
function sanitizeIdentifier(s){ return String(s||'').trim().slice(0,256); }
function doLogin(identifier, password, rememberMe){
  if(!identifier || !password) return { error: 'Email/Username and password required', status:400 };
  const id = sanitizeIdentifier(identifier);
  const user = db.prepare(`SELECT * FROM users WHERE email=? OR username=?`).get(id, id);
  if(!user) return { error:'Invalid email/username or password.', status:401 };
  if(!user.is_active) return { error:'Account is disabled. Contact admin.', status:403 };
  if(!bcrypt.compareSync(password, user.password_hash)) return { error:'Invalid email/username or password.', status:401 };
  const expiresIn = rememberMe ? '30d' : '8h';
  const token = jwt.sign({ id:user.id, role:user.role, email:user.email }, JWT_SECRET, { expiresIn });
  audit(user,'LOGIN','auth',user.id,`User logged in (rememberMe=${!!rememberMe})`);
  return { token, user:{ id:user.id, username:user.username, email:user.email, role:user.role, display_name:user.display_name, phone:user.phone, resident_id:user.resident_id }, expiresIn };
}

// Generic login
app.post('/api/auth/login', (req,res)=>{
  const { email, username, password, rememberMe } = req.body;
  const identifier = email || username;
  const result = doLogin(identifier, password, rememberMe);
  if(result.error) return res.status(result.status).json({error:result.error});
  res.json({ token:result.token, user:result.user, expiresIn:result.expiresIn });
});
// Role-aware Admin login
app.post('/api/auth/admin/login', (req,res)=>{
  const { email, username, password, rememberMe } = req.body;
  const identifier = email || username;
  const result = doLogin(identifier, password, rememberMe);
  if(result.error) return res.status(result.status).json({error:result.error});
  const allowedAdminRoles = ['admin','committee','staff'];
  if(!allowedAdminRoles.includes(result.user.role)){
    return res.status(403).json({error:'You do not have permission to access the Admin Portal.', code:'WRONG_PORTAL'});
  }
  res.json({ token:result.token, user:result.user, expiresIn:result.expiresIn });
});
// Role-aware Resident login
app.post('/api/auth/resident/login', (req,res)=>{
  const { email, username, password, rememberMe } = req.body;
  const identifier = email || username;
  const result = doLogin(identifier, password, rememberMe);
  if(result.error) return res.status(result.status).json({error:result.error});
  if(result.user.role !== 'resident'){
    return res.status(403).json({error:'This account is not authorized for the Resident Portal.', code:'WRONG_PORTAL'});
  }
  res.json({ token:result.token, user:result.user, expiresIn:result.expiresIn });
});
app.post('/api/auth/logout', authRequired, (req,res)=>{
  audit(req.user,'LOGOUT','auth',req.user.id,'User logged out');
  res.json({message:'Logged out'});
});
app.post('/api/auth/forgot-password', (req,res)=>{
  const { email } = req.body;
  const id = sanitizeIdentifier(email);
  if(!id) return res.status(400).json({error:'Email is required'});
  const user = db.prepare(`SELECT * FROM users WHERE email=?`).get(id);
  if(!user) return res.json({message:'If the account exists, a reset link has been generated.', devNote:'No user found - generic response'});
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const expiresAt = new Date(Date.now()+60*60*1000).toISOString();
  try{
    db.prepare(`DELETE FROM password_resets WHERE user_id=?`).run(user.id);
    db.prepare(`INSERT INTO password_resets (user_id, token_hash, expires_at, used, created_at) VALUES (?,?,?,?,?)`).run(user.id, tokenHash, expiresAt, 0, nowISO());
  }catch(e){ return res.status(500).json({error:'Failed to create reset token'}); }
  audit({id:user.id, display_name:user.display_name, role:user.role},'FORGOT_PASSWORD','auth',user.id,'Password reset requested');
  // In production, email would be sent. For this app, return token for testing/demo.
  res.json({message:'Password reset token generated. Use it within 1 hour.', resetToken: rawToken, expiresAt, email: user.email});
});
app.post('/api/auth/reset-password', (req,res)=>{
  const { token, newPassword, password } = req.body;
  const pwd = newPassword || password;
  if(!token || !pwd) return res.status(400).json({error:'Reset token and new password are required'});
  if(String(pwd).length < 6) return res.status(400).json({error:'Password must be at least 6 characters'});
  const tokenHash = crypto.createHash('sha256').update(String(token)).digest('hex');
  const row = db.prepare(`SELECT * FROM password_resets WHERE token_hash=?`).get(tokenHash);
  if(!row) return res.status(400).json({error:'Invalid or expired reset token'});
  if(row.used) return res.status(400).json({error:'This reset link has already been used'});
  if(new Date(row.expires_at) < new Date()) return res.status(400).json({error:'Reset token has expired. Please request a new one.'});
  const user = db.prepare(`SELECT * FROM users WHERE id=?`).get(row.user_id);
  if(!user) return res.status(404).json({error:'User not found'});
  const hash = bcrypt.hashSync(pwd, 10);
  db.prepare(`UPDATE users SET password_hash=? WHERE id=?`).run(hash, user.id);
  db.prepare(`UPDATE password_resets SET used=1 WHERE id=?`).run(row.id);
  audit(user,'RESET_PASSWORD','auth',user.id,'Password reset via token');
  notify(user.id,'Password changed','Your password was successfully reset','success');
  res.json({message:'Password has been reset successfully. Please log in with your new password.'});
});
app.get('/api/auth/me', authRequired, (req,res)=>{
  const u = req.user;
  let resident=null;
  if(u.resident_id) resident = db.prepare(`SELECT * FROM residents WHERE id=?`).get(u.resident_id);
  let house=null;
  if(resident?.house_id) house = db.prepare(`SELECT * FROM houses WHERE id=?`).get(resident.house_id);
  res.json({ user:{ id:u.id, username:u.username, email:u.email, role:u.role, display_name:u.display_name, phone:u.phone, resident_id:u.resident_id, photo_url:u.photo_url||resident?.photo_url||'' }, resident, house });
});

// ============ RESIDENT PROFILE APIS (functional, secure, DB-backed) ============
// helper to get full resident profile (ownership verified)
function getResidentProfile(user){
  const resident = user.resident_id ? db.prepare(`SELECT * FROM residents WHERE id=?`).get(user.resident_id) : null;
  if(!resident) return { user, resident:null, house:null, family:[], prefs:null };
  const house = resident.house_id ? db.prepare(`SELECT * FROM houses WHERE id=?`).get(resident.house_id) : null;
  const family = resident.house_id ? db.prepare(`SELECT * FROM residents WHERE house_id=? AND id!=?`).all(resident.house_id, resident.id) : [];
  let prefs = db.prepare(`SELECT * FROM notification_preferences WHERE user_id=?`).get(user.id);
  if(!prefs){
    db.prepare(`INSERT INTO notification_preferences (user_id, updated_at) VALUES (?,?)`).run(user.id, nowISO());
    prefs = db.prepare(`SELECT * FROM notification_preferences WHERE user_id=?`).get(user.id);
  }
  // last login from audit_logs
  const lastLogin = db.prepare(`SELECT timestamp FROM audit_logs WHERE user_id=? AND action='LOGIN' ORDER BY timestamp DESC LIMIT 1`).get(user.id);
  return { user, resident, house, family, prefs, lastLogin: lastLogin?.timestamp||null };
}
app.get('/api/resident/profile', authRequired, (req,res)=>{
  if(req.user.role!=='resident') return res.status(403).json({error:'Resident only'});
  const data = getResidentProfile(req.user);
  if(!data.resident) return res.status(404).json({error:'Resident profile not found'});
  res.json({
    user:{ id:data.user.id, username:data.user.username, email:data.user.email, role:data.user.role, display_name:data.user.display_name, phone:data.user.phone, resident_id:data.user.resident_id, photo_url:data.user.photo_url||data.resident.photo_url||'' },
    resident: data.resident,
    house: data.house,
    family: data.family||[],
    preferences: data.prefs,
    lastLogin: data.lastLogin,
    registrationDate: data.user.created_at||data.resident.created_at
  });
});
// alias /resident/profile for frontend compat (same)
app.get('/api/profile', authRequired, (req,res)=>{
  if(req.user.role!=='resident') return res.status(403).json({error:'Resident only'});
  const data = getResidentProfile(req.user);
  if(!data.resident) return res.status(404).json({error:'Resident profile not found'});
  res.json({ user:{ id:data.user.id, username:data.user.username, email:data.user.email, role:data.user.role, display_name:data.user.display_name, phone:data.user.phone, resident_id:data.user.resident_id, photo_url:data.user.photo_url||data.resident.photo_url||'' }, resident: data.resident, house: data.house, family: data.family||[], preferences: data.prefs, lastLogin: data.lastLogin, registrationDate: data.user.created_at||data.resident.created_at });
});
app.put('/api/resident/profile', authRequired, (req,res)=>{
  if(req.user.role!=='resident') return res.status(403).json({error:'Resident only'});
  const resident = db.prepare(`SELECT * FROM residents WHERE id=?`).get(req.user.resident_id);
  if(!resident) return res.status(404).json({error:'Resident profile not found'});
  const allowed = ['name','phone','email','dob','gender','marital_status','preferred_language','address','address2','city','state','country','postal_code','emergency_name','emergency_relation','emergency_phone','emergency_alt_phone'];
  const updates={};
  allowed.forEach(f=> { if(req.body[f]!==undefined) updates[f]=String(req.body[f]).trim(); });
  // Validation
  if(updates.name!==undefined && !updates.name) return res.status(400).json({error:'Full name is required.'});
  if(updates.email!==undefined && updates.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(updates.email)) return res.status(400).json({error:'Please enter a valid email address.'});
  if(updates.phone!==undefined && updates.phone && !/^[0-9+\- ]{7,15}$/.test(updates.phone)) return res.status(400).json({error:'Please enter a valid phone number.'});
  if(updates.emergency_phone!==undefined && updates.emergency_phone && !/^[0-9+\- ]{7,15}$/.test(updates.emergency_phone)) return res.status(400).json({error:'Please enter a valid emergency phone number.'});
  if(updates.postal_code!==undefined && updates.postal_code && !/^[0-9]{4,10}$/.test(updates.postal_code)) return res.status(400).json({error:'Please enter a valid postal code.'});
  if(updates.dob!==undefined && updates.dob){
    const d=new Date(updates.dob);
    if(isNaN(d.getTime())) return res.status(400).json({error:'Please enter a valid date of birth.'});
    if(d>new Date()) return res.status(400).json({error:'Date of birth cannot be in the future.'});
  }
  if(updates.email && updates.email!==resident.email){
    const exists=db.prepare(`SELECT id FROM users WHERE email=? AND id!=?`).get(updates.email, req.user.id);
    if(exists) return res.status(400).json({error:'Email is already in use'});
    const existsRes=db.prepare(`SELECT id FROM residents WHERE email=? AND id!=?`).get(updates.email, resident.id);
    if(existsRes) return res.status(400).json({error:'Email is already in use'});
  }
  // Build dynamic update
  const fields = Object.keys(updates);
  if(fields.length===0) return res.status(400).json({error:'No fields to update'});
  const setClause = fields.map(f=>`${f}=?`).join(', ');
  const vals = fields.map(f=>updates[f]);
  vals.push(resident.id);
  db.prepare(`UPDATE residents SET ${setClause} WHERE id=?`).run(...vals);
  // Sync user table display_name/phone/email/photo if changed
  if(updates.name||updates.phone||updates.email){
    const u = db.prepare(`SELECT * FROM users WHERE id=?`).get(req.user.id);
    db.prepare(`UPDATE users SET display_name=?, phone=?, email=?, username=? WHERE id=?`).run(updates.name||u.display_name, updates.phone||u.phone, updates.email||u.email, (updates.email||u.email).split('@')[0], req.user.id);
  }
  const updated = db.prepare(`SELECT * FROM residents WHERE id=?`).get(resident.id);
  audit(req.user,'UPDATE','resident_profile',resident.id,'Resident updated profile');
  const freshUser = db.prepare(`SELECT * FROM users WHERE id=?`).get(req.user.id);
  res.json({ message:'Profile updated successfully.', resident: updated, user:{ id:freshUser.id, username:freshUser.username, email:freshUser.email, display_name:freshUser.display_name, phone:freshUser.phone, photo_url:freshUser.photo_url||updated.photo_url } });
});
app.post('/api/resident/profile/photo', authRequired, (req,res,next)=>{
  if(req.user.role!=='resident') return res.status(403).json({error:'Resident only'});
  next();
}, (req,res)=>{
  upload.single('photo')(req,res, (err)=>{
    if(err){
      if(err.code==='LIMIT_FILE_SIZE') return res.status(400).json({error:'File too large. Max 2MB.'});
      return res.status(400).json({error:err.message||'Upload failed'});
    }
    if(!req.file) return res.status(400).json({error:'No file uploaded'});
    const photoUrl = `/uploads/${req.file.filename}`;
    // verify ownership -> update both residents and users
    db.prepare(`UPDATE residents SET photo_url=? WHERE id=?`).run(photoUrl, req.user.resident_id);
    db.prepare(`UPDATE users SET photo_url=? WHERE id=?`).run(photoUrl, req.user.id);
    audit(req.user,'UPDATE','resident_photo',req.user.resident_id,'Updated profile photo');
    res.json({ message:'Profile photo updated successfully.', photo_url: photoUrl });
  });
});
app.delete('/api/resident/profile/photo', authRequired, (req,res)=>{
  if(req.user.role!=='resident') return res.status(403).json({error:'Resident only'});
  db.prepare(`UPDATE residents SET photo_url='' WHERE id=?`).run(req.user.resident_id);
  db.prepare(`UPDATE users SET photo_url='' WHERE id=?`).run(req.user.id);
  res.json({ message:'Profile photo removed.' });
});
app.put('/api/resident/profile/password', authRequired, (req,res)=>{
  if(req.user.role!=='resident') return res.status(403).json({error:'Resident only'});
  const { currentPassword, newPassword, confirmPassword } = req.body;
  if(!currentPassword||!newPassword||!confirmPassword) return res.status(400).json({error:'All password fields are required.'});
  if(newPassword.length<6) return res.status(400).json({error:'New password must be at least 6 characters.'});
  if(newPassword!==confirmPassword) return res.status(400).json({error:'Passwords do not match.'});
  const u=db.prepare(`SELECT * FROM users WHERE id=?`).get(req.user.id);
  if(!bcrypt.compareSync(currentPassword, u.password_hash)) return res.status(400).json({error:'Current password is incorrect.'});
  const hash=bcrypt.hashSync(newPassword,10);
  db.prepare(`UPDATE users SET password_hash=? WHERE id=?`).run(hash, req.user.id);
  audit(req.user,'UPDATE','password',req.user.id,'Changed password');
  res.json({ message:'Password changed successfully.' });
});
app.get('/api/resident/profile/notifications', authRequired, (req,res)=>{
  if(req.user.role!=='resident') return res.status(403).json({error:'Resident only'});
  let prefs=db.prepare(`SELECT * FROM notification_preferences WHERE user_id=?`).get(req.user.id);
  if(!prefs){ db.prepare(`INSERT INTO notification_preferences (user_id, updated_at) VALUES (?,?)`).run(req.user.id, nowISO()); prefs=db.prepare(`SELECT * FROM notification_preferences WHERE user_id=?`).get(req.user.id); }
  res.json(prefs);
});
app.put('/api/resident/profile/notifications', authRequired, (req,res)=>{
  if(req.user.role!=='resident') return res.status(403).json({error:'Resident only'});
  let prefs=db.prepare(`SELECT * FROM notification_preferences WHERE user_id=?`).get(req.user.id);
  if(!prefs){ db.prepare(`INSERT INTO notification_preferences (user_id, updated_at) VALUES (?,?)`).run(req.user.id, nowISO()); prefs=db.prepare(`SELECT * FROM notification_preferences WHERE user_id=?`).get(req.user.id); }
  const allowed=['email_notifications','payment_reminders','complaint_updates','maintenance_updates','event_notifications','meeting_notifications','apartment_notices'];
  const updates={};
  allowed.forEach(k=>{ if(req.body[k]!==undefined) updates[k]= req.body[k]?1:0; });
  if(Object.keys(updates).length===0) return res.status(400).json({error:'No preferences to update'});
  const setClause=Object.keys(updates).map(k=>`${k}=?`).join(', ');
  const vals=Object.values(updates);
  vals.push(nowISO(), req.user.id);
  db.prepare(`UPDATE notification_preferences SET ${setClause}, updated_at=? WHERE user_id=?`).run(...vals);
  const fresh=db.prepare(`SELECT * FROM notification_preferences WHERE user_id=?`).get(req.user.id);
  res.json({ message:'Notification preferences updated.', preferences: fresh });
});

// Dashboard
app.get('/api/dashboard/kpis', authRequired, (req,res)=>{
  const totalHouses = db.prepare(`SELECT COUNT(*) as c FROM houses`).get().c;
  const occupied = db.prepare(`SELECT COUNT(*) as c FROM houses WHERE occupancy='Occupied'`).get().c;
  const vacant = totalHouses - occupied;
  const totalFamilies = db.prepare(`SELECT COUNT(DISTINCT house_id) as c FROM residents WHERE house_id IS NOT NULL`).get().c;
  const totalResidents = db.prepare(`SELECT COUNT(*) as c FROM residents`).get().c;
  const pendingDues = db.prepare(`SELECT COUNT(*) as c FROM payments WHERE status='Pending'`).get().c;
  const pendingAmount = db.prepare(`SELECT COALESCE(SUM(amount),0) as s FROM payments WHERE status='Pending'`).get().s;
  const totalCollected = db.prepare(`SELECT COALESCE(SUM(amount),0) as s FROM payments WHERE status='Paid'`).get().s;
  const monthlyEvents = db.prepare(`SELECT COUNT(*) as c FROM events WHERE status='Upcoming'`).get().c;
  const upcomingMeetings = db.prepare(`SELECT COUNT(*) as c FROM meetings WHERE status='Upcoming'`).get().c;
  const openComplaints = db.prepare(`SELECT COUNT(*) as c FROM complaints WHERE status IN ('Open','Assigned','In Progress')`).get().c;
  const highPriority = db.prepare(`SELECT COUNT(*) as c FROM complaints WHERE priority='High' AND status!='Closed'`).get().c;
  const openMaintenance = db.prepare(`SELECT COUNT(*) as c FROM maintenance_tickets WHERE status IN ('Open','Assigned','In Progress')`).get().c;
  const bhk1 = db.prepare(`SELECT COUNT(*) as c FROM houses WHERE bhk=1`).get().c;
  const bhk2 = db.prepare(`SELECT COUNT(*) as c FROM houses WHERE bhk=2`).get().c;
  const bhk3 = db.prepare(`SELECT COUNT(*) as c FROM houses WHERE bhk=3`).get().c;

  // For resident, filter to own house
  if(req.user.role==='resident' && req.user.resident_id){
    const resident = db.prepare(`SELECT * FROM residents WHERE id=?`).get(req.user.resident_id);
    const houseId = resident?.house_id;
    const myDue = houseId ? db.prepare(`SELECT COALESCE(SUM(amount),0) as s FROM payments WHERE house_id=? AND status='Pending'`).get(houseId).s : 0;
    const myPaid = houseId ? db.prepare(`SELECT COALESCE(SUM(amount),0) as s FROM payments WHERE house_id=? AND status='Paid'`).get(houseId).s : 0;
    const lastPayment = houseId ? db.prepare(`SELECT * FROM payments WHERE house_id=? AND status='Paid' ORDER BY date DESC LIMIT 1`).get(houseId) : null;
    const myOpenComplaints = db.prepare(`SELECT COUNT(*) as c FROM complaints WHERE resident_id=? AND status IN ('Open','Assigned','In Progress')`).get(req.user.resident_id).c;
    const myMaintenance = db.prepare(`SELECT COUNT(*) as c FROM maintenance_tickets WHERE house_id=? AND status IN ('Open','Assigned','In Progress')`).get(houseId||0).c;
    return res.json({
      totalHouses, occupied, vacant, totalFamilies, totalResidents, pendingDues, pendingAmount, totalCollected, monthlyEvents, upcomingMeetings, openComplaints, highPriority, openMaintenance, bhk1, bhk2, bhk3,
      myDue, myPaid, lastPayment, myOpenComplaints, myMaintenance
    });
  }

  res.json({ totalHouses, occupied, vacant, totalFamilies, totalResidents, pendingDues, pendingAmount, totalCollected, monthlyEvents, upcomingMeetings, openComplaints, highPriority, openMaintenance, bhk1, bhk2, bhk3, monthlyCollection: totalCollected });
});

app.get('/api/dashboard/fund-trend', authRequired, (req,res)=>{
  // For resident: only own house payments trend, else global
  if(req.user.role==='resident' && req.user.resident_id){
    const me = db.prepare(`SELECT house_id FROM residents WHERE id=?`).get(req.user.resident_id);
    if(me?.house_id){
      const rows = db.prepare(`SELECT substr(date,1,7) as month, SUM(CASE WHEN status='Paid' THEN amount ELSE 0 END) as collected, SUM(CASE WHEN status='Pending' THEN amount ELSE 0 END) as pending FROM payments WHERE house_id=? GROUP BY month ORDER BY month ASC LIMIT 12`).all(me.house_id);
      if(rows.length===0){
        // no history yet -> show single point with actual pending
        const pending = db.prepare(`SELECT COALESCE(SUM(amount),0) as s FROM payments WHERE house_id=? AND status='Pending'`).get(me.house_id).s;
        const paid = db.prepare(`SELECT COALESCE(SUM(amount),0) as s FROM payments WHERE house_id=? AND status='Paid'`).get(me.house_id).s;
        const cur = new Date().toISOString().slice(0,7);
        return res.json([{ month:cur, collected:paid, pending }]);
      }
      return res.json(rows);
    }
  }
  const rows = db.prepare(`SELECT substr(date,1,7) as month, SUM(CASE WHEN status='Paid' THEN amount ELSE 0 END) as collected, SUM(CASE WHEN status='Pending' THEN amount ELSE 0 END) as pending FROM payments GROUP BY month ORDER BY month ASC LIMIT 12`).all();
  if(rows.length===0){
    res.json([
      { month:'2026-02', collected:145000, pending:12000 },
      { month:'2026-03', collected:152000, pending:8000 },
      { month:'2026-04', collected:148000, pending:15000 },
      { month:'2026-05', collected:162000, pending:5000 },
      { month:'2026-06', collected:158000, pending:9500 },
      { month:'2026-07', collected:172000, pending:7500 },
    ]);
  } else {
    res.json(rows);
  }
});
app.get('/api/dashboard/maintenance-stats', authRequired, (req,res)=>{
  if(req.user.role==='resident' && req.user.resident_id){
    const me = db.prepare(`SELECT house_id FROM residents WHERE id=?`).get(req.user.resident_id);
    const stats = me?.house_id ? db.prepare(`SELECT status, COUNT(*) as c FROM maintenance_tickets WHERE house_id=? GROUP BY status`).all(me.house_id) : [];
    const map={};
    stats.forEach(s=> map[s.status]=s.c);
    return res.json({ open:map['Open']||0, assigned:map['Assigned']||0, inProgress:map['In Progress']||0, completed:map['Completed']||0, closed:map['Closed']||0 });
  }
  const stats = db.prepare(`SELECT status, COUNT(*) as c FROM maintenance_tickets GROUP BY status`).all();
  const map={};
  stats.forEach(s=> map[s.status]=s.c);
  res.json({ open:map['Open']||0, assigned:map['Assigned']||0, inProgress:map['In Progress']||0, completed:map['Completed']||0, closed:map['Closed']||0 });
});
app.get('/api/dashboard/complaint-stats', authRequired, (req,res)=>{
  if(req.user.role==='resident' && req.user.resident_id){
    const stats = db.prepare(`SELECT status, COUNT(*) as c FROM complaints WHERE resident_id=? GROUP BY status`).all(req.user.resident_id);
    const map={}; stats.forEach(s=> map[s.status]=s.c);
    const pri = db.prepare(`SELECT COUNT(*) as c FROM complaints WHERE resident_id=? AND priority='High' AND status!='Closed'`).get(req.user.resident_id).c;
    return res.json({ ...map, highPriority:pri });
  }
  const stats = db.prepare(`SELECT status, COUNT(*) as c FROM complaints GROUP BY status`).all();
  const map={}; stats.forEach(s=> map[s.status]=s.c);
  const pri = db.prepare(`SELECT COUNT(*) as c FROM complaints WHERE priority='High'`).get().c;
  res.json({ ...map, highPriority:pri });
});
app.get('/api/dashboard/recent-activity', authRequired, (req,res)=>{
  const logs = db.prepare(`SELECT * FROM audit_logs ORDER BY timestamp DESC LIMIT 10`).all();
  if(req.user.role==='resident' && req.user.resident_id){
    const me = db.prepare(`SELECT house_id FROM residents WHERE id=?`).get(req.user.resident_id);
    const payments = db.prepare(`SELECT 'Payment '||status as title, '₹'||amount||' — '||date||' · '||method as desc, created_at as timestamp FROM payments WHERE resident_id=? OR house_id=? ORDER BY created_at DESC LIMIT 3`).all(req.user.resident_id, me?.house_id||0);
    const complaints = db.prepare(`SELECT 'Complaint '||status as title, subject||' ('||priority||')' as desc, created_at as timestamp FROM complaints WHERE resident_id=? ORDER BY created_at DESC LIMIT 3`).all(req.user.resident_id);
    const maintenance = me?.house_id ? db.prepare(`SELECT 'Maintenance '||status as title, category||' — '||location as desc, created_at as timestamp FROM maintenance_tickets WHERE house_id=? ORDER BY created_at DESC LIMIT 3`).all(me.house_id) : [];
    const combined = [...payments,...complaints,...maintenance].sort((a,b)=> new Date(b.timestamp)-new Date(a.timestamp)).slice(0,8);
    return res.json({ logs: logs.filter(l=> String(l.user_id)===String(req.user.id)).slice(0,5), combined });
  }
  const payments = db.prepare(`SELECT 'Payment recorded' as title, '₹'||amount||' — House '||(SELECT house_no FROM houses WHERE id=house_id) as desc, created_at as timestamp FROM payments ORDER BY created_at DESC LIMIT 3`).all();
  const complaints = db.prepare(`SELECT 'Complaint '||status as title, subject||' — House '||(SELECT house_no FROM houses WHERE id=house_id) as desc, created_at as timestamp FROM complaints ORDER BY created_at DESC LIMIT 3`).all();
  const maintenance = db.prepare(`SELECT 'Maintenance '||status as title, category||' — '||location as desc, created_at as timestamp FROM maintenance_tickets ORDER BY created_at DESC LIMIT 3`).all();
  const combined = [...payments,...complaints,...maintenance].sort((a,b)=> new Date(b.timestamp)-new Date(a.timestamp)).slice(0,8);
  res.json({ logs, combined });
});
app.get('/api/dashboard/upcoming-events', authRequired, (req,res)=>{
  const ev = db.prepare(`SELECT * FROM events WHERE date >= date('now') OR status='Upcoming' ORDER BY date ASC LIMIT 5`).all();
  res.json(ev);
});
app.get('/api/dashboard/upcoming-meetings', authRequired, (req,res)=>{
  const mt = db.prepare(`SELECT * FROM meetings WHERE status='Upcoming' ORDER BY date ASC LIMIT 5`).all();
  res.json(mt);
});

// Dedicated spec endpoints: /resident/dashboard and /admin/dashboard  (also /api/... aliases)
function buildResidentDashboard(user){
  const resident = db.prepare(`SELECT * FROM residents WHERE id=?`).get(user.resident_id);
  const house = resident?.house_id ? db.prepare(`SELECT * FROM houses WHERE id=?`).get(resident.house_id) : null;
  const houseId = resident?.house_id || 0;
  const myDue = db.prepare(`SELECT COALESCE(SUM(amount),0) as s FROM payments WHERE house_id=? AND status='Pending'`).get(houseId).s;
  const lastPayment = db.prepare(`SELECT * FROM payments WHERE (house_id=? OR resident_id=?) AND status='Paid' ORDER BY date DESC LIMIT 1`).get(houseId, user.resident_id);
  const myOpenComplaints = db.prepare(`SELECT COUNT(*) as c FROM complaints WHERE resident_id=? AND status IN ('Open','Assigned','In Progress')`).get(user.resident_id).c;
  const myMaintenance = db.prepare(`SELECT COUNT(*) as c FROM maintenance_tickets WHERE house_id=? AND status IN ('Open','Assigned','In Progress')`).get(houseId).c;
  const payments = db.prepare(`SELECT * FROM payments WHERE resident_id=? OR house_id=? ORDER BY date DESC LIMIT 5`).all(user.resident_id, houseId);
  const complaints = db.prepare(`SELECT * FROM complaints WHERE resident_id=? ORDER BY created_at DESC LIMIT 5`).all(user.resident_id);
  const maintenanceStats = (()=>{ const stats=db.prepare(`SELECT status, COUNT(*) as c FROM maintenance_tickets WHERE house_id=? GROUP BY status`).all(houseId); const m={}; stats.forEach(s=>m[s.status]=s.c); return {open:m['Open']||0, assigned:m['Assigned']||0, inProgress:m['In Progress']||0, completed:m['Completed']||0}; })();
  const fundTrend = db.prepare(`SELECT substr(date,1,7) as month, SUM(CASE WHEN status='Paid' THEN amount ELSE 0 END) as collected, SUM(CASE WHEN status='Pending' THEN amount ELSE 0 END) as pending FROM payments WHERE house_id=? OR resident_id=? GROUP BY month ORDER BY month ASC LIMIT 12`).all(houseId, user.resident_id);
  const upcomingEvents = db.prepare(`SELECT * FROM events WHERE status='Upcoming' ORDER BY date ASC LIMIT 3`).all();
  const upcomingMeetings = db.prepare(`SELECT * FROM meetings WHERE status='Upcoming' ORDER BY date ASC LIMIT 3`).all();
  return { welcome: `Welcome, ${resident?.name||user.display_name}`, date: new Date().toISOString().slice(0,10), house, resident, myDue, lastPayment, myOpenComplaints, myMaintenance, payments, complaints, maintenanceStats, fundTrend: fundTrend.length?fundTrend:[{month:new Date().toISOString().slice(0,7), collected:0, pending:myDue}], upcomingEvents, upcomingMeetings };
}
function buildAdminDashboard(){
  const totalHouses = db.prepare(`SELECT COUNT(*) as c FROM houses`).get().c;
  const occupied = db.prepare(`SELECT COUNT(*) as c FROM houses WHERE occupancy='Occupied'`).get().c;
  const vacant = totalHouses - occupied;
  const totalFamilies = db.prepare(`SELECT COUNT(DISTINCT house_id) as c FROM residents WHERE house_id IS NOT NULL`).get().c;
  const totalResidents = db.prepare(`SELECT COUNT(*) as c FROM residents`).get().c;
  const totalCollected = db.prepare(`SELECT COALESCE(SUM(amount),0) as s FROM payments WHERE status='Paid'`).get().s;
  const pendingAmount = db.prepare(`SELECT COALESCE(SUM(amount),0) as s FROM payments WHERE status='Pending'`).get().s;
  const bhk1 = db.prepare(`SELECT COUNT(*) as c FROM houses WHERE bhk=1`).get().c;
  const bhk2 = db.prepare(`SELECT COUNT(*) as c FROM houses WHERE bhk=2`).get().c;
  const bhk3 = db.prepare(`SELECT COUNT(*) as c FROM houses WHERE bhk=3`).get().c;
  const openComplaints = db.prepare(`SELECT COUNT(*) as c FROM complaints WHERE status IN ('Open','Assigned','In Progress')`).get().c;
  const highPriority = db.prepare(`SELECT COUNT(*) as c FROM complaints WHERE priority='High' AND status!='Closed'`).get().c;
  const openMaintenance = db.prepare(`SELECT COUNT(*) as c FROM maintenance_tickets WHERE status IN ('Open','Assigned','In Progress')`).get().c;
  const fundTrend = db.prepare(`SELECT substr(date,1,7) as month, SUM(CASE WHEN status='Paid' THEN amount ELSE 0 END) as collected, SUM(CASE WHEN status='Pending' THEN amount ELSE 0 END) as pending FROM payments GROUP BY month ORDER BY month ASC LIMIT 12`).all();
  const maintenanceStats = (()=>{ const stats=db.prepare(`SELECT status, COUNT(*) as c FROM maintenance_tickets GROUP BY status`).all(); const m={}; stats.forEach(s=>m[s.status]=s.c); return {open:m['Open']||0, assigned:m['Assigned']||0, inProgress:m['In Progress']||0, completed:m['Completed']||0}; })();
  const recentPayments = db.prepare(`SELECT p.*, h.house_no, r.name as resident_name FROM payments p LEFT JOIN houses h ON h.id=p.house_id LEFT JOIN residents r ON r.id=p.resident_id ORDER BY p.created_at DESC LIMIT 5`).all();
  const upcomingEvents = db.prepare(`SELECT * FROM events WHERE status='Upcoming' ORDER BY date ASC LIMIT 5`).all();
  const upcomingMeetings = db.prepare(`SELECT * FROM meetings WHERE status='Upcoming' ORDER BY date ASC LIMIT 5`).all();
  // Always return arrays for list-type data (fixes slice is not a function)
  const complaintsList = db.prepare(`SELECT c.*, h.house_no, r.name as resident_name FROM complaints c LEFT JOIN houses h ON h.id=c.house_id LEFT JOIN residents r ON r.id=c.resident_id ORDER BY c.created_at DESC LIMIT 5`).all();
  const residentsList = db.prepare(`SELECT r.*, h.house_no FROM residents r LEFT JOIN houses h ON h.id=r.house_id ORDER BY r.created_at DESC LIMIT 5`).all();
  const maintenanceList = db.prepare(`SELECT m.*, h.house_no FROM maintenance_tickets m LEFT JOIN houses h ON h.id=m.house_id ORDER BY m.created_at DESC LIMIT 5`).all();
  const housesList = db.prepare(`SELECT h.*, r.name as resident_name FROM houses h LEFT JOIN residents r ON r.id=h.resident_id ORDER BY h.created_at DESC LIMIT 5`).all();
  const notificationsList = db.prepare(`SELECT * FROM notifications ORDER BY created_at DESC LIMIT 5`).all();
  const recentActivities = db.prepare(`SELECT * FROM audit_logs ORDER BY timestamp DESC LIMIT 5`).all();
  // Ensure every collection is always an array (never null/object/string)
  const ensureArr = (v) => Array.isArray(v) ? v : [];
  const safeComplaints = ensureArr(complaintsList);
  const safeResidents = ensureArr(residentsList);
  const safeHouses = ensureArr(housesList);
  const safePayments = ensureArr(recentPayments);
  const safeMaintenance = ensureArr(maintenanceList);
  const safeEvents = ensureArr(upcomingEvents);
  const safeMeetings = ensureArr(upcomingMeetings);
  const safeNotifications = ensureArr(notificationsList);
  const safeActivities = ensureArr(recentActivities);
  const fwTrend = Array.isArray(fundTrend) && fundTrend.length ? fundTrend : [
      { month:'2026-02', collected:145000, pending:12000 },
      { month:'2026-03', collected:152000, pending:8000 },
      { month:'2026-04', collected:148000, pending:15000 },
      { month:'2026-05', collected:162000, pending:5000 },
      { month:'2026-06', collected:158000, pending:9500 },
      { month:'2026-07', collected:172000, pending:7500 },
  ];
  return {
    // numeric KPIs
    totalHouses, occupied, vacant, totalFamilies, totalResidents, totalCollected, pendingAmount,
    bhk:{bhk1,bhk2,bhk3},
    // stats objects (backward compat)
    complaintStats:{open:openComplaints, highPriority},
    openComplaints, highPriority,
    openMaintenance,
    maintenanceStats,
    fundTrend: fwTrend,
    // === STANDARDIZED ARRAY KEYS (spec compliant) ===
    // Primary keys expected by frontend: must be arrays
    complaints: safeComplaints,
    residents: safeResidents,
    houses: safeHouses,
    payments: safePayments,
    maintenance: safeMaintenance,
    events: safeEvents,
    meetings: safeMeetings,
    notifications: safeNotifications,
    activities: safeActivities,
    recentActivities: safeActivities,
    // statistics block (spec)
    statistics: {
      totalHouses, totalResidents,
      pendingPayments: pendingAmount,
      totalCollection: totalCollected,
      openComplaints, activeMaintenance: openMaintenance,
      upcomingEvents: safeEvents.length
    },
    // aliases for backward compat (old frontend variants)
    complaintsList: safeComplaints,
    complaintsArray: safeComplaints,
    recentPayments: safePayments,
    maintenanceList: safeMaintenance,
    upcomingEvents: safeEvents,
    upcomingMeetings: safeMeetings,
    housesList: safeHouses,
    residentsList: safeResidents,
  };
}
app.get('/api/resident/dashboard', authRequired, (req,res)=>{
  if(req.user.role!=='resident') return res.status(403).json({error:'Resident only'});
  res.json(buildResidentDashboard(req.user));
});
app.get('/api/admin/dashboard', authRequired, requireRole('admin','committee','staff'), (req,res)=>{
  res.json(buildAdminDashboard());
});

// Houses
app.get('/api/houses', authRequired, (req,res)=>{
  const { search, block, bhk, occupancy, status, page='1', limit='10', sort='house_no' } = req.query;
  let where = [];
  let params = [];
  if(search){ where.push(`(h.house_no LIKE ? OR r.name LIKE ?)`); params.push(`%${search}%`,`%${search}%`); }
  if(block){ where.push(`h.block=?`); params.push(block); }
  if(bhk){ where.push(`h.bhk=?`); params.push(bhk); }
  if(occupancy){ where.push(`h.occupancy=?`); params.push(occupancy); }
  if(status){ where.push(`h.status=?`); params.push(status); }
  // residents see only own house? Admin sees all. Resident still can list? spec says resident should not see others private? But for now filter.
  if(req.user.role==='resident' && req.user.resident_id){
    const resident = db.prepare(`SELECT house_id FROM residents WHERE id=?`).get(req.user.resident_id);
    if(resident?.house_id){ where.push(`h.id=?`); params.push(resident.house_id); }
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const count = db.prepare(`SELECT COUNT(*) as c FROM houses h LEFT JOIN residents r ON r.id=h.resident_id ${whereSql}`).get(...params).c;
  const offset = (parseInt(page)-1)*parseInt(limit);
  const allowedSort = ['house_no','block','floor','bhk','occupancy','status'];
  const sortCol = allowedSort.includes(sort) ? `h.${sort}` : 'h.house_no';
  const rows = db.prepare(`SELECT h.*, r.name as resident_name, r.phone as resident_phone, r.type as resident_type FROM houses h LEFT JOIN residents r ON r.id=h.resident_id ${whereSql} ORDER BY ${sortCol} ASC LIMIT ? OFFSET ?`).all(...params, parseInt(limit), offset);
  // enrich with payment status
  const enriched = rows.map(h=>{
    const due = db.prepare(`SELECT COALESCE(SUM(amount),0) as s FROM payments WHERE house_id=? AND status='Pending'`).get(h.id).s;
    const paid = db.prepare(`SELECT COALESCE(SUM(amount),0) as s FROM payments WHERE house_id=? AND status='Paid'`).get(h.id).s;
    const openComplaints = db.prepare(`SELECT COUNT(*) as c FROM complaints WHERE house_id=? AND status IN ('Open','Assigned','In Progress')`).get(h.id).c;
    const openMaint = db.prepare(`SELECT COUNT(*) as c FROM maintenance_tickets WHERE house_id=? AND status IN ('Open','Assigned','In Progress')`).get(h.id).c;
    return { ...h, pendingDue:due, totalPaid:paid, openComplaints, openMaint };
  });
  res.json({ data:enriched, total:count, page:parseInt(page), limit:parseInt(limit) });
});
app.get('/api/houses/:id', authRequired, (req,res)=>{
  const house = db.prepare(`SELECT h.*, r.name as resident_name FROM houses h LEFT JOIN residents r ON r.id=h.resident_id WHERE h.id=?`).get(req.params.id);
  if(!house) return res.status(404).json({error:'House not found'});
  if(req.user.role==='resident'){
    const resident = db.prepare(`SELECT house_id FROM residents WHERE id=?`).get(req.user.resident_id);
    if(String(resident?.house_id)!==String(house.id)) return res.status(403).json({error:'Access denied'});
  }
  const family = db.prepare(`SELECT * FROM residents WHERE house_id=?`).all(house.id);
  const payments = db.prepare(`SELECT p.*, r.name as resident_name FROM payments p LEFT JOIN residents r ON r.id=p.resident_id WHERE p.house_id=? ORDER BY p.date DESC LIMIT 20`).all(house.id);
  const complaints = db.prepare(`SELECT * FROM complaints WHERE house_id=? ORDER BY created_at DESC LIMIT 20`).all(house.id);
  const maintenance = db.prepare(`SELECT * FROM maintenance_tickets WHERE house_id=? ORDER BY created_at DESC LIMIT 20`).all(house.id);
  res.json({ house, family, payments, complaints, maintenance });
});
app.post('/api/houses', authRequired, requireRole('admin'), (req,res)=>{
  const { house_no, block, floor, bhk, occupancy, status, monthly_due } = req.body;
  if(!house_no || !block) return res.status(400).json({error:'House number and block required'});
  const exists = db.prepare(`SELECT id FROM houses WHERE house_no=?`).get(house_no);
  if(exists) return res.status(400).json({error:'House number already exists'});
  const now=nowISO();
  const result = db.prepare(`INSERT INTO houses (house_no,block,floor,bhk,status,occupancy,monthly_due,created_at) VALUES (?,?,?,?,?,?,?,?)`)
    .run(house_no, block, floor||1, bhk||2, status||'Active', occupancy||'Vacant', monthly_due||2500, now);
  const house = db.prepare(`SELECT * FROM houses WHERE id=?`).get(result.lastInsertRowid);
  audit(req.user,'CREATE','houses',house.id,`Created house ${house_no}`);
  notify(req.user.id,'House created',`House ${house_no} created successfully`,'success');
  res.status(201).json(house);
});
app.put('/api/houses/:id', authRequired, requireRole('admin'), (req,res)=>{
  const house = db.prepare(`SELECT * FROM houses WHERE id=?`).get(req.params.id);
  if(!house) return res.status(404).json({error:'House not found'});
  const { house_no, block, floor, bhk, occupancy, status, monthly_due, resident_id } = req.body;
  db.prepare(`UPDATE houses SET house_no=?,block=?,floor=?,bhk=?,occupancy=?,status=?,monthly_due=?,resident_id=? WHERE id=?`)
    .run(house_no||house.house_no, block||house.block, floor??house.floor, bhk??house.bhk, occupancy||house.occupancy, status||house.status, monthly_due??house.monthly_due, resident_id??house.resident_id, req.params.id);
  const updated = db.prepare(`SELECT * FROM houses WHERE id=?`).get(req.params.id);
  audit(req.user,'UPDATE','houses',updated.id,`Updated house ${updated.house_no}`);
  res.json(updated);
});
app.delete('/api/houses/:id', authRequired, requireRole('admin'), (req,res)=>{
  const house = db.prepare(`SELECT * FROM houses WHERE id=?`).get(req.params.id);
  if(!house) return res.status(404).json({error:'House not found'});
  db.prepare(`UPDATE houses SET status='Inactive', occupancy='Vacant' WHERE id=?`).run(req.params.id);
  audit(req.user,'DEACTIVATE','houses',house.id,`Deactivated house ${house.house_no}`);
  res.json({message:'House deactivated'});
});

// Residents
app.get('/api/residents', authRequired, (req,res)=>{
  const { search, type, status, house_id, page='1', limit='10' } = req.query;
  let where=[]; let params=[];
  if(search){ where.push(`(r.name LIKE ? OR r.roll_no LIKE ? OR r.phone LIKE ?)`); params.push(`%${search}%`,`%${search}%`,`%${search}%`); }
  if(type){ where.push(`r.type=?`); params.push(type); }
  if(status){ where.push(`r.status=?`); params.push(status); }
  if(house_id){ where.push(`r.house_id=?`); params.push(house_id); }
  if(req.user.role==='resident' && req.user.resident_id){
    // residents only see own family / own house members
    const me = db.prepare(`SELECT house_id FROM residents WHERE id=?`).get(req.user.resident_id);
    if(me?.house_id){ where.push(`r.house_id=?`); params.push(me.house_id); } else { where.push(`r.id=?`); params.push(req.user.resident_id); }
  }
  const whereSql = where.length? `WHERE ${where.join(' AND ')}` : '';
  const count = db.prepare(`SELECT COUNT(*) as c FROM residents r ${whereSql}`).get(...params).c;
  const offset=(parseInt(page)-1)*parseInt(limit);
  const rows = db.prepare(`SELECT r.*, h.house_no, h.block FROM residents r LEFT JOIN houses h ON h.id=r.house_id ${whereSql} ORDER BY r.name ASC LIMIT ? OFFSET ?`).all(...params, parseInt(limit), offset);
  res.json({ data:rows, total:count, page:parseInt(page), limit:parseInt(limit) });
});
app.get('/api/residents/:id', authRequired, (req,res)=>{
  const resident = db.prepare(`SELECT r.*, h.house_no, h.block, h.floor, h.bhk FROM residents r LEFT JOIN houses h ON h.id=r.house_id WHERE r.id=?`).get(req.params.id);
  if(!resident) return res.status(404).json({error:'Resident not found'});
  if(req.user.role==='resident'){
    const me = db.prepare(`SELECT house_id FROM residents WHERE id=?`).get(req.user.resident_id);
    const allowed = String(resident.id)===String(req.user.resident_id) || (me?.house_id && String(resident.house_id)===String(me.house_id));
    if(!allowed) return res.status(403).json({error:'Access denied'});
  }
  const payments = db.prepare(`SELECT * FROM payments WHERE resident_id=? ORDER BY date DESC LIMIT 20`).all(resident.id);
  const complaints = db.prepare(`SELECT * FROM complaints WHERE resident_id=? ORDER BY created_at DESC LIMIT 20`).all(resident.id);
  const maintenance = db.prepare(`SELECT * FROM maintenance_tickets WHERE house_id=? ORDER BY created_at DESC LIMIT 20`).all(resident.house_id||0);
  const family = resident.house_id ? db.prepare(`SELECT * FROM residents WHERE house_id=? AND id!=?`).all(resident.house_id, resident.id) : [];
  res.json({ resident, payments, complaints, maintenance, family });
});
app.post('/api/residents', authRequired, requireRole('admin'), (req,res)=>{
  const { name, house_id, relation, phone, email, dob, gender, type, status, address, city, state, country, postal_code, emergency_name, emergency_phone } = req.body;
  if(!name) return res.status(400).json({error:'Name required'});
  const roll = nextId('residents','RES','roll_no');
  const now=nowISO();
  const result = db.prepare(`INSERT INTO residents (roll_no,name,house_id,relation,phone,email,dob,gender,type,status,address,city,state,country,postal_code,emergency_name,emergency_phone,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(roll,name,house_id||null,relation||'Self',phone||'',email||'',dob||'',gender||'Male',type||'Owner',status||'Active',address||'',city||'Bengaluru',state||'Karnataka',country||'India',postal_code||'560001',emergency_name||'',emergency_phone||'',now);
  const resident = db.prepare(`SELECT * FROM residents WHERE id=?`).get(result.lastInsertRowid);
  if(house_id){
    // if house vacant, mark occupied
    const house = db.prepare(`SELECT * FROM houses WHERE id=?`).get(house_id);
    if(house && house.occupancy==='Vacant'){
      db.prepare(`UPDATE houses SET occupancy='Occupied', resident_id=? WHERE id=?`).run(resident.id, house_id);
    }
  }
  // create user login for resident if email provided
  if(email){
    const exists = db.prepare(`SELECT id FROM users WHERE email=?`).get(email);
    if(!exists){
      const pw = bcrypt.hashSync('resident123',10);
      db.prepare(`INSERT INTO users (username,email,password_hash,role,display_name,phone,resident_id,is_active,created_at) VALUES (?,?,?,?,?,?,?,?,?)`)
        .run(email.split('@')[0], email, pw, 'resident', name, phone||'', resident.id, 1, now);
    }
  }
  audit(req.user,'CREATE','residents',resident.id,`Created resident ${name} ${roll}`);
  res.status(201).json(resident);
});
app.put('/api/residents/:id', authRequired, (req,res)=>{
  const resident = db.prepare(`SELECT * FROM residents WHERE id=?`).get(req.params.id);
  if(!resident) return res.status(404).json({error:'Resident not found'});
  // RBAC: resident can edit own profile, admin can edit any
  if(req.user.role==='resident' && String(req.user.resident_id)!==String(req.params.id)) return res.status(403).json({error:'Access denied'});
  const fields = ['name','house_id','relation','phone','email','dob','gender','type','status','photo_url','address','city','state','country','postal_code','emergency_name','emergency_phone'];
  const updates = {};
  fields.forEach(f=> updates[f] = req.body[f] !== undefined ? req.body[f] : resident[f]);
  if(updates.email && updates.email !== resident.email){
    const emailOwner = db.prepare(`SELECT id FROM users WHERE email=? AND resident_id!=?`).get(updates.email, req.params.id);
    if(emailOwner) return res.status(400).json({error:'Email is already in use'});
  }
  db.prepare(`UPDATE residents SET name=?,house_id=?,relation=?,phone=?,email=?,dob=?,gender=?,type=?,status=?,photo_url=?,address=?,city=?,state=?,country=?,postal_code=?,emergency_name=?,emergency_phone=? WHERE id=?`)
    .run(updates.name, updates.house_id, updates.relation, updates.phone, updates.email, updates.dob, updates.gender, updates.type, updates.status, updates.photo_url, updates.address, updates.city, updates.state, updates.country, updates.postal_code, updates.emergency_name, updates.emergency_phone, req.params.id);
  const updated = db.prepare(`SELECT * FROM residents WHERE id=?`).get(req.params.id);
  // also update user display_name if linked
  if(updated.email){
    db.prepare(`UPDATE users SET display_name=?, phone=?, email=?, username=? WHERE resident_id=?`).run(updated.name, updated.phone, updated.email, updated.email.split('@')[0], updated.id);
  }
  audit(req.user,'UPDATE','residents',updated.id,`Updated resident ${updated.name}`);
  // notify
  const uid = db.prepare(`SELECT id FROM users WHERE resident_id=?`).get(updated.id);
  if(uid) notify(uid.id,'Profile updated','Your profile has been updated successfully','info');
  res.json(updated);
});

// Events
app.get('/api/events', authRequired, (req,res)=>{
  const { search, status, page='1', limit='10' } = req.query;
  let where=[]; let params=[];
  if(search){ where.push(`(name LIKE ? OR venue LIKE ?)`); params.push(`%${search}%`,`%${search}%`); }
  if(status){ where.push(`status=?`); params.push(status); }
  const whereSql = where.length? `WHERE ${where.join(' AND ')}` : '';
  const count = db.prepare(`SELECT COUNT(*) as c FROM events ${whereSql}`).get(...params).c;
  const offset=(parseInt(page)-1)*parseInt(limit);
  const rows = db.prepare(`SELECT * FROM events ${whereSql} ORDER BY date ASC LIMIT ? OFFSET ?`).all(...params, parseInt(limit), offset);
  res.json({ data:rows, total:count, page:parseInt(page), limit:parseInt(limit) });
});
app.get('/api/events/:id', authRequired, (req,res)=>{
  const ev = db.prepare(`SELECT * FROM events WHERE id=?`).get(req.params.id);
  if(!ev) return res.status(404).json({error:'Event not found'});
  res.json(ev);
});
app.post('/api/events', authRequired, requireRole('admin','committee'), (req,res)=>{
  const { name, date, time, venue, organizer, budget, fund_collected, status, description } = req.body;
  if(!name || !date) return res.status(400).json({error:'Name and date required'});
  const now=nowISO();
  const result = db.prepare(`INSERT INTO events (name,date,time,venue,organizer,budget,fund_collected,status,description,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(name,date,time||'',venue||'',organizer||'',budget||0,fund_collected||0,status||'Upcoming',description||'',now);
  const ev = db.prepare(`SELECT * FROM events WHERE id=?`).get(result.lastInsertRowid);
  audit(req.user,'CREATE','events',ev.id,`Created event ${name}`);
  // notify all residents? create admin notification
  const users = db.prepare(`SELECT id FROM users WHERE role='resident'`).all();
  users.forEach(u=> notify(u.id,'New Event',`New event: ${name} on ${date}`,'info'));
  res.status(201).json(ev);
});
app.put('/api/events/:id', authRequired, requireRole('admin','committee'), (req,res)=>{
  const ev = db.prepare(`SELECT * FROM events WHERE id=?`).get(req.params.id);
  if(!ev) return res.status(404).json({error:'Event not found'});
  const fields=['name','date','time','venue','organizer','budget','fund_collected','status','description'];
  const vals={};
  fields.forEach(f=> vals[f]= req.body[f]!==undefined? req.body[f] : ev[f]);
  db.prepare(`UPDATE events SET name=?,date=?,time=?,venue=?,organizer=?,budget=?,fund_collected=?,status=?,description=? WHERE id=?`)
    .run(vals.name,vals.date,vals.time,vals.venue,vals.organizer,vals.budget,vals.fund_collected,vals.status,vals.description, req.params.id);
  const updated = db.prepare(`SELECT * FROM events WHERE id=?`).get(req.params.id);
  audit(req.user,'UPDATE','events',updated.id,`Updated event ${updated.name}`);
  res.json(updated);
});
app.delete('/api/events/:id', authRequired, requireRole('admin','committee'), (req,res)=>{
  db.prepare(`DELETE FROM events WHERE id=?`).run(req.params.id);
  audit(req.user,'DELETE','events',req.params.id,`Deleted event ${req.params.id}`);
  res.json({message:'Deleted'});
});

// Meetings
app.get('/api/meetings', authRequired, (req,res)=>{
  const { search, status, page='1', limit='10' } = req.query;
  let where=[]; let params=[];
  if(search){ where.push(`(title LIKE ? OR venue LIKE ?)`); params.push(`%${search}%`,`%${search}%`); }
  if(status){ where.push(`status=?`); params.push(status); }
  const whereSql = where.length? `WHERE ${where.join(' AND ')}` : '';
  const count = db.prepare(`SELECT COUNT(*) as c FROM meetings ${whereSql}`).get(...params).c;
  const offset=(parseInt(page)-1)*parseInt(limit);
  const rows = db.prepare(`SELECT * FROM meetings ${whereSql} ORDER BY date ASC LIMIT ? OFFSET ?`).all(...params, parseInt(limit), offset);
  res.json({ data:rows, total:count, page:parseInt(page), limit:parseInt(limit) });
});
app.get('/api/meetings/:id', authRequired, (req,res)=>{
  const m = db.prepare(`SELECT * FROM meetings WHERE id=?`).get(req.params.id);
  if(!m) return res.status(404).json({error:'Meeting not found'});
  res.json(m);
});
app.post('/api/meetings', authRequired, requireRole('admin','committee'), (req,res)=>{
  const { title, date, time, venue, agenda, attendees, minutes_status, status } = req.body;
  if(!title || !date) return res.status(400).json({error:'Title and date required'});
  const now=nowISO();
  const result = db.prepare(`INSERT INTO meetings (title,date,time,venue,agenda,attendees,minutes_status,status,created_at) VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(title,date,time||'',venue||'',agenda||'',attendees||'',minutes_status||'Pending',status||'Upcoming',now);
  const m = db.prepare(`SELECT * FROM meetings WHERE id=?`).get(result.lastInsertRowid);
  audit(req.user,'CREATE','meetings',m.id,`Created meeting ${title}`);
  res.status(201).json(m);
});
app.put('/api/meetings/:id', authRequired, requireRole('admin','committee'), (req,res)=>{
  const m = db.prepare(`SELECT * FROM meetings WHERE id=?`).get(req.params.id);
  if(!m) return res.status(404).json({error:'Meeting not found'});
  const fields=['title','date','time','venue','agenda','attendees','minutes_status','status'];
  const vals={}; fields.forEach(f=> vals[f]= req.body[f]!==undefined? req.body[f] : m[f]);
  db.prepare(`UPDATE meetings SET title=?,date=?,time=?,venue=?,agenda=?,attendees=?,minutes_status=?,status=? WHERE id=?`)
    .run(vals.title,vals.date,vals.time,vals.venue,vals.agenda,vals.attendees,vals.minutes_status,vals.status, req.params.id);
  const updated = db.prepare(`SELECT * FROM meetings WHERE id=?`).get(req.params.id);
  audit(req.user,'UPDATE','meetings',updated.id,`Updated meeting ${updated.title}`);
  res.json(updated);
});

// Payments
app.get('/api/payments', authRequired, (req,res)=>{
  const { search, status, method, house_id, page='1', limit='10' } = req.query;
  let where=[]; let params=[];
  if(search){ where.push(`(p.transaction_id LIKE ? OR h.house_no LIKE ? OR r.name LIKE ?)`); params.push(`%${search}%`,`%${search}%`,`%${search}%`); }
  if(status){ where.push(`p.status=?`); params.push(status); }
  if(method){ where.push(`p.method=?`); params.push(method); }
  if(house_id){ where.push(`p.house_id=?`); params.push(house_id); }
  if(req.user.role==='resident' && req.user.resident_id){
    const me = db.prepare(`SELECT house_id FROM residents WHERE id=?`).get(req.user.resident_id);
    // resident sees own payments only (by resident_id or house_id)
    where.push(`(p.resident_id=? OR p.house_id=?)`); params.push(req.user.resident_id, me?.house_id||0);
  }
  const whereSql = where.length? `WHERE ${where.join(' AND ')}` : '';
  const count = db.prepare(`SELECT COUNT(*) as c FROM payments p LEFT JOIN houses h ON h.id=p.house_id LEFT JOIN residents r ON r.id=p.resident_id ${whereSql}`).get(...params).c;
  const offset=(parseInt(page)-1)*parseInt(limit);
  const rows = db.prepare(`SELECT p.*, h.house_no, h.block, r.name as resident_name, r.roll_no FROM payments p LEFT JOIN houses h ON h.id=p.house_id LEFT JOIN residents r ON r.id=p.resident_id ${whereSql} ORDER BY p.created_at DESC LIMIT ? OFFSET ?`).all(...params, parseInt(limit), offset);
  res.json({ data:rows, total:count, page:parseInt(page), limit:parseInt(limit) });
});
app.get('/api/payments/:id', authRequired, (req,res)=>{
  const p = db.prepare(`SELECT p.*, h.house_no, h.block, r.name as resident_name FROM payments p LEFT JOIN houses h ON h.id=p.house_id LEFT JOIN residents r ON r.id=p.resident_id WHERE p.id=?`).get(req.params.id);
  if(!p) return res.status(404).json({error:'Payment not found'});
  if(req.user.role==='resident'){
    const me = db.prepare(`SELECT house_id FROM residents WHERE id=?`).get(req.user.resident_id);
    if(String(p.resident_id)!==String(req.user.resident_id) && String(p.house_id)!==String(me?.house_id)) return res.status(403).json({error:'Access denied'});
  }
  res.json(p);
});
app.post('/api/payments', authRequired, (req,res)=>{
  let { house_id, resident_id, amount, method, status, date } = req.body;
  if(!amount) return res.status(400).json({error:'Amount required'});
  if(req.user.role==='staff') return res.status(403).json({error:'Forbidden: insufficient role'});
  // if resident, enforce own house
  if(req.user.role==='resident'){
    const me = db.prepare(`SELECT * FROM residents WHERE id=?`).get(req.user.resident_id);
    house_id = me.house_id;
    resident_id = me.id;
    status = 'Pending';
  }
  if(!house_id) return res.status(400).json({error:'House required'});
  if(!resident_id){
    const house = db.prepare(`SELECT resident_id FROM houses WHERE id=?`).get(house_id);
    resident_id = house?.resident_id || req.user.resident_id;
  }
  const tid = nextId('payments','PAY','transaction_id');
  const receipt = `RCP-${tid}`;
  const now=nowISO();
  const payDate = date || new Date().toISOString().slice(0,10);
  const result = db.prepare(`INSERT INTO payments (transaction_id,house_id,resident_id,amount,date,method,status,verified_by,receipt_no,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(tid, house_id, resident_id, amount, payDate, method||'UPI', status||'Paid', req.user.role==='admin'? req.user.display_name : 'Self', receipt, now);
  const payment = db.prepare(`SELECT * FROM payments WHERE id=?`).get(result.lastInsertRowid);
  audit(req.user,'CREATE','payments',payment.id,`Payment ${tid} ₹${amount} for house ${house_id}`);
  // notifications
  const adminUser = db.prepare(`SELECT id FROM users WHERE role='admin'`).get();
  if(adminUser) notify(adminUser.id,'Payment recorded',`₹${amount} — House ${db.prepare(`SELECT house_no FROM houses WHERE id=?`).get(house_id)?.house_no} (${tid})`,'success');
  // resident notification
  const residentUser = db.prepare(`SELECT id FROM users WHERE resident_id=?`).get(resident_id);
  if(residentUser) notify(residentUser.id,'Payment successful',`Your payment ${tid} of ₹${amount} is ${status||'Paid'}`,'success');
  res.status(201).json(payment);
});

// Maintenance
app.get('/api/maintenance', authRequired, (req,res)=>{
  const { search, category, priority, status, page='1', limit='10' } = req.query;
  let where=[]; let params=[];
  if(search){ where.push(`(ticket_no LIKE ? OR category LIKE ? OR location LIKE ?)`); params.push(`%${search}%`,`%${search}%`,`%${search}%`); }
  if(category){ where.push(`category=?`); params.push(category); }
  if(priority){ where.push(`priority=?`); params.push(priority); }
  if(status){ where.push(`status=?`); params.push(status); }
  if(req.user.role==='resident' && req.user.resident_id){
    const me = db.prepare(`SELECT house_id FROM residents WHERE id=?`).get(req.user.resident_id);
    // show only tickets for own house or common area? For privacy, show own house + maybe open common? But spec says resident sees maintenance affecting their house. Allow house_id filter.
    // For now filter to own house_id if provided else show own house tickets
    if(me?.house_id){ where.push(`(house_id=? OR house_id IS NULL)`); params.push(me.house_id); } // include common
  }
  const whereSql = where.length? `WHERE ${where.join(' AND ')}` : '';
  const count = db.prepare(`SELECT COUNT(*) as c FROM maintenance_tickets ${whereSql}`).get(...params).c;
  const offset=(parseInt(page)-1)*parseInt(limit);
  const rows = db.prepare(`SELECT m.*, h.house_no FROM maintenance_tickets m LEFT JOIN houses h ON h.id=m.house_id ${whereSql} ORDER BY m.created_at DESC LIMIT ? OFFSET ?`).all(...params, parseInt(limit), offset);
  res.json({ data:rows, total:count, page:parseInt(page), limit:parseInt(limit) });
});
app.get('/api/maintenance/:id', authRequired, (req,res)=>{
  const m = db.prepare(`SELECT m.*, h.house_no, h.block FROM maintenance_tickets m LEFT JOIN houses h ON h.id=m.house_id WHERE m.id=?`).get(req.params.id);
  if(!m) return res.status(404).json({error:'Ticket not found'});
  if(req.user.role==='resident'){
    const me = db.prepare(`SELECT house_id FROM residents WHERE id=?`).get(req.user.resident_id);
    if(m.house_id !== null && String(m.house_id)!==String(me?.house_id)) return res.status(403).json({error:'Access denied'});
  }
  res.json(m);
});
app.post('/api/maintenance', authRequired, (req,res)=>{
  let { category, location, house_id, assigned_to, priority, due_date, status, cost, description, vendor } = req.body;
  if(!category) return res.status(400).json({error:'Category required'});
  if(req.user.role==='resident'){
    const me = db.prepare(`SELECT house_id FROM residents WHERE id=?`).get(req.user.resident_id);
    house_id = me.house_id;
  }
  const ticket_no = nextId('maintenance_tickets','MT','ticket_no');
  const now=nowISO();
  const result = db.prepare(`INSERT INTO maintenance_tickets (ticket_no,category,location,house_id,assigned_to,priority,due_date,status,cost,description,vendor,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(ticket_no, category, location||'', house_id||null, assigned_to||'', priority||'Medium', due_date||new Date(Date.now()+7*86400000).toISOString().slice(0,10), status||'Open', cost||0, description||'', vendor||'', now, now);
  const ticket = db.prepare(`SELECT * FROM maintenance_tickets WHERE id=?`).get(result.lastInsertRowid);
  audit(req.user,'CREATE','maintenance',ticket.id,`Created ticket ${ticket_no}`);
  const adminUser = db.prepare(`SELECT id FROM users WHERE role='admin'`).get();
  if(adminUser) notify(adminUser.id,'Maintenance created',`${category} — ${ticket_no}`,'info');
  res.status(201).json(ticket);
});
app.put('/api/maintenance/:id', authRequired, (req,res)=>{
  const m = db.prepare(`SELECT * FROM maintenance_tickets WHERE id=?`).get(req.params.id);
  if(!m) return res.status(404).json({error:'Ticket not found'});
  // resident can only update own house tickets? limit
  if(req.user.role==='resident'){
    const me = db.prepare(`SELECT house_id FROM residents WHERE id=?`).get(req.user.resident_id);
    if(String(m.house_id)!==String(me?.house_id)) return res.status(403).json({error:'Access denied'});
    const residentFields = ['description','location'];
    const residentUpdates = {};
    residentFields.forEach(f=> residentUpdates[f] = req.body[f] !== undefined ? req.body[f] : m[f]);
    db.prepare(`UPDATE maintenance_tickets SET description=?,location=?,updated_at=? WHERE id=?`)
      .run(residentUpdates.description, residentUpdates.location, nowISO(), req.params.id);
    return res.json(db.prepare(`SELECT * FROM maintenance_tickets WHERE id=?`).get(req.params.id));
  }
  const fields=['category','location','house_id','assigned_to','priority','due_date','status','cost','description','vendor'];
  const vals={}; fields.forEach(f=> vals[f]= req.body[f]!==undefined? req.body[f] : m[f]);
  db.prepare(`UPDATE maintenance_tickets SET category=?,location=?,house_id=?,assigned_to=?,priority=?,due_date=?,status=?,cost=?,description=?,vendor=?,updated_at=? WHERE id=?`)
    .run(vals.category,vals.location,vals.house_id,vals.assigned_to,vals.priority,vals.due_date,vals.status,vals.cost,vals.description,vals.vendor,nowISO(), req.params.id);
  const updated = db.prepare(`SELECT * FROM maintenance_tickets WHERE id=?`).get(req.params.id);
  audit(req.user,'UPDATE','maintenance',updated.id,`Updated ticket ${updated.ticket_no} to ${updated.status}`);
  if(updated.house_id){
    const ru = db.prepare(`SELECT id FROM users WHERE resident_id IN (SELECT id FROM residents WHERE house_id=?)`).all(updated.house_id);
    ru.forEach(u=> notify(u.id,'Maintenance update',`Ticket ${updated.ticket_no} status: ${updated.status}`,'info'));
  }
  res.json(updated);
});

// Complaints
app.get('/api/complaints', authRequired, (req,res)=>{
  const { search, status, priority, category, page='1', limit='10' } = req.query;
  let where=[]; let params=[];
  if(search){ where.push(`(complaint_no LIKE ? OR subject LIKE ? OR description LIKE ?)`); params.push(`%${search}%`,`%${search}%`,`%${search}%`); }
  if(status){ where.push(`c.status=?`); params.push(status); }
  if(priority){ where.push(`c.priority=?`); params.push(priority); }
  if(category){ where.push(`c.category=?`); params.push(category); }
  if(req.user.role==='resident' && req.user.resident_id){
    where.push(`c.resident_id=?`); params.push(req.user.resident_id);
  }
  const whereSql = where.length? `WHERE ${where.join(' AND ')}` : '';
  const count = db.prepare(`SELECT COUNT(*) as c FROM complaints c ${whereSql}`).get(...params).c;
  const offset=(parseInt(page)-1)*parseInt(limit);
  const rows = db.prepare(`SELECT c.*, h.house_no, r.name as resident_name FROM complaints c LEFT JOIN houses h ON h.id=c.house_id LEFT JOIN residents r ON r.id=c.resident_id ${whereSql} ORDER BY c.created_at DESC LIMIT ? OFFSET ?`).all(...params, parseInt(limit), offset);
  res.json({ data:rows, total:count, page:parseInt(page), limit:parseInt(limit) });
});
app.get('/api/complaints/:id', authRequired, (req,res)=>{
  const c = db.prepare(`SELECT c.*, h.house_no, h.block, r.name as resident_name, r.phone as resident_phone FROM complaints c LEFT JOIN houses h ON h.id=c.house_id LEFT JOIN residents r ON r.id=c.resident_id WHERE c.id=?`).get(req.params.id);
  if(!c) return res.status(404).json({error:'Complaint not found'});
  if(req.user.role==='resident' && String(c.resident_id)!==String(req.user.resident_id)) return res.status(403).json({error:'Access denied'});
  const comments = db.prepare(`SELECT * FROM complaint_comments WHERE complaint_id=? ORDER BY created_at ASC`).all(c.id);
  res.json({ complaint:c, comments });
});
app.post('/api/complaints', authRequired, (req,res)=>{
  let { house_id, category, subject, description, priority } = req.body;
  if(!subject) return res.status(400).json({error:'Subject required'});
  let resident_id = req.user.resident_id || null;
  if(req.user.role==='admin'){
    // admin can create for any house, need house_id
    if(!house_id) return res.status(400).json({error:'House required'});
    const house = db.prepare(`SELECT resident_id FROM houses WHERE id=?`).get(house_id);
    resident_id = house?.resident_id || null;
    if(!resident_id){
      // fallback: pick any resident of house
      const r = db.prepare(`SELECT id FROM residents WHERE house_id=?`).get(house_id);
      resident_id = r?.id || req.user.id;
    }
  } else {
    const me = db.prepare(`SELECT * FROM residents WHERE id=?`).get(req.user.resident_id);
    house_id = me.house_id;
    resident_id = me.id;
    // ensure house exists
    if(!house_id) return res.status(400).json({error:'No house linked to profile'});
  }
  const complaint_no = nextId('complaints','CMP','complaint_no');
  const now=nowISO();
  const result = db.prepare(`INSERT INTO complaints (complaint_no,house_id,resident_id,category,subject,description,priority,assigned_to,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run(complaint_no, house_id, resident_id, category||'General', subject, description||'', priority||'Medium', '', 'Open', now, now);
  const complaint = db.prepare(`SELECT * FROM complaints WHERE id=?`).get(result.lastInsertRowid);
  db.prepare(`INSERT INTO complaint_comments (complaint_id,author,role,message,created_at) VALUES (?,?,?,?,?)`)
    .run(req.user.display_name, req.user.role, `Complaint created: ${subject}`, now);
  audit(req.user,'CREATE','complaints',complaint.id,`Created complaint ${complaint_no}`);
  const adminUser = db.prepare(`SELECT id FROM users WHERE role='admin'`).get();
  if(adminUser) notify(adminUser.id,'New Complaint',`${complaint_no} — ${subject} (${priority||'Medium'})`,'warning');
  res.status(201).json(complaint);
});
app.put('/api/complaints/:id', authRequired, (req,res)=>{
  const c = db.prepare(`SELECT * FROM complaints WHERE id=?`).get(req.params.id);
  if(!c) return res.status(404).json({error:'Complaint not found'});
  if(req.user.role==='committee') return res.status(403).json({error:'Forbidden: insufficient role'});
  if(req.user.role==='resident' && String(c.resident_id)!==String(req.user.resident_id)) return res.status(403).json({error:'Access denied'});
  // residents cannot change assigned_to/status except maybe close? Admin can.
  const allowedForResident = ['subject','description'];
  let updates = {};
  if(req.user.role==='resident'){
    // only allow description update? For simplicity allow limited
    updates = {
      subject: req.body.subject || c.subject,
      description: req.body.description || c.description,
      priority: c.priority,
      status: c.status,
      assigned_to: c.assigned_to,
      category: req.body.category || c.category
    };
  } else {
    const fields=['category','subject','description','priority','assigned_to','status'];
    fields.forEach(f=> updates[f]= req.body[f]!==undefined? req.body[f] : c[f]);
    updates.category = updates.category || c.category;
  }
  db.prepare(`UPDATE complaints SET category=?,subject=?,description=?,priority=?,assigned_to=?,status=?,updated_at=? WHERE id=?`)
    .run(updates.category, updates.subject, updates.description, updates.priority, updates.assigned_to, updates.status, nowISO(), req.params.id);
  const updated = db.prepare(`SELECT * FROM complaints WHERE id=?`).get(req.params.id);
  if(req.body.comment){
    db.prepare(`INSERT INTO complaint_comments (complaint_id,author,role,message,created_at) VALUES (?,?,?,?,?)`)
      .run(req.user.display_name, req.user.role, req.body.comment, nowISO());
  } else if(req.body.status && req.body.status!==c.status){
    db.prepare(`INSERT INTO complaint_comments (complaint_id,author,role,message,created_at) VALUES (?,?,?,?,?)`)
      .run(req.user.display_name, req.user.role, `Status changed to ${req.body.status}`, nowISO());
  }
  audit(req.user,'UPDATE','complaints',updated.id,`Updated complaint ${updated.complaint_no} to ${updated.status}`);
  // notify resident
  const residentUser = db.prepare(`SELECT id FROM users WHERE resident_id=?`).get(updated.resident_id);
  if(residentUser) notify(residentUser.id,'Complaint update',`${updated.complaint_no} status: ${updated.status}`,'info');
  res.json(updated);
});
app.post('/api/complaints/:id/comments', authRequired, (req,res)=>{
  const c = db.prepare(`SELECT * FROM complaints WHERE id=?`).get(req.params.id);
  if(!c) return res.status(404).json({error:'Complaint not found'});
  if(req.user.role==='committee') return res.status(403).json({error:'Forbidden: insufficient role'});
  if(req.user.role==='resident' && String(c.resident_id)!==String(req.user.resident_id)) return res.status(403).json({error:'Access denied'});
  const { message } = req.body;
  if(!message) return res.status(400).json({error:'Message required'});
  db.prepare(`INSERT INTO complaint_comments (complaint_id,author,role,message,created_at) VALUES (?,?,?,?,?)`)
    .run(req.params.id, req.user.display_name, req.user.role, message, nowISO());
  const comments = db.prepare(`SELECT * FROM complaint_comments WHERE complaint_id=? ORDER BY created_at ASC`).all(req.params.id);
  res.json(comments);
});

// Committee
app.get('/api/committee', authRequired, (req,res)=>{
  const rows = db.prepare(`SELECT * FROM committee_members ORDER BY CASE role WHEN 'President' THEN 1 WHEN 'Secretary' THEN 2 WHEN 'Treasurer' THEN 3 ELSE 4 END`).all();
  res.json(rows);
});
app.post('/api/committee', authRequired, requireRole('admin'), (req,res)=>{
  const { name, role, block, phone, email, term } = req.body;
  if(!name || !role) return res.status(400).json({error:'Name and role required'});
  db.prepare(`INSERT INTO committee_members (name,role,block,phone,email,term,photo_url) VALUES (?,?,?,?,?,?,?)`).run(name,role,block||'',phone||'',email||'',term||'2026-27','');
  const row = db.prepare(`SELECT * FROM committee_members WHERE id=last_insert_rowid()`).get();
  audit(req.user,'CREATE','committee',row.id,`Added committee member ${name}`);
  res.status(201).json(row);
});
app.put('/api/committee/:id', authRequired, requireRole('admin'), (req,res)=>{
  const m = db.prepare(`SELECT * FROM committee_members WHERE id=?`).get(req.params.id);
  if(!m) return res.status(404).json({error:'Not found'});
  const { name, role, block, phone, email, term } = req.body;
  db.prepare(`UPDATE committee_members SET name=?,role=?,block=?,phone=?,email=?,term=? WHERE id=?`).run(name||m.name, role||m.role, block||m.block, phone||m.phone, email||m.email, term||m.term, req.params.id);
  const updated = db.prepare(`SELECT * FROM committee_members WHERE id=?`).get(req.params.id);
  res.json(updated);
});
app.delete('/api/committee/:id', authRequired, requireRole('admin'), (req,res)=>{
  db.prepare(`DELETE FROM committee_members WHERE id=?`).run(req.params.id);
  audit(req.user,'DELETE','committee',req.params.id,`Deleted committee ${req.params.id}`);
  res.json({message:'Deleted'});
});

// Reports
app.get('/api/reports/summary', authRequired, (req,res)=>{
  if(!['admin','committee'].includes(req.user.role)) return res.status(403).json({error:'Forbidden: insufficient role'});
  const { period='all' } = req.query;
  const totalCollected = db.prepare(`SELECT COALESCE(SUM(amount),0) as s FROM payments WHERE status='Paid'`).get().s;
  const pending = db.prepare(`SELECT COALESCE(SUM(amount),0) as s FROM payments WHERE status='Pending'`).get().s;
  const expenses = db.prepare(`SELECT COALESCE(SUM(cost),0) as s FROM maintenance_tickets WHERE status IN ('Completed','Closed')`).get().s;
  const balance = totalCollected - expenses;
  const monthly = db.prepare(`SELECT substr(date,1,7) as month, SUM(amount) as total FROM payments WHERE status='Paid' GROUP BY month ORDER BY month ASC LIMIT 12`).all();
  const budgetVsActual = db.prepare(`SELECT name, budget, fund_collected FROM events ORDER BY date ASC LIMIT 6`).all();
  const maintenanceCosts = db.prepare(`SELECT category, SUM(cost) as total FROM maintenance_tickets GROUP BY category`).all();
  const paymentTrend = monthly;
  const complaintTrend = db.prepare(`SELECT status, COUNT(*) as c FROM complaints GROUP BY status`).all();
  res.json({ totalCollected, pending, expenses, balance, monthly, budgetVsActual, maintenanceCosts, paymentTrend, complaintTrend });
});

// Notifications
app.get('/api/notifications', authRequired, (req,res)=>{
  const rows = db.prepare(`SELECT * FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 50`).all(req.user.id);
  const unread = rows.filter(r=> !r.is_read).length;
  res.json({ data:rows, unread });
});
app.post('/api/notifications/mark-read', authRequired, (req,res)=>{
  const { id } = req.body;
  if(id){
    db.prepare(`UPDATE notifications SET is_read=1 WHERE id=? AND user_id=?`).run(id, req.user.id);
  } else {
    db.prepare(`UPDATE notifications SET is_read=1 WHERE user_id=?`).run(req.user.id);
  }
  res.json({message:'Marked read'});
});

// Audit logs
app.get('/api/audit-logs', authRequired, requireRole('admin'), (req,res)=>{
  const { search, module, action, page='1', limit='20' } = req.query;
  let where=[]; let params=[];
  if(search){ where.push(`(user_name LIKE ? OR details LIKE ?)`); params.push(`%${search}%`,`%${search}%`); }
  if(module){ where.push(`module=?`); params.push(module); }
  if(action){ where.push(`action=?`); params.push(action); }
  const whereSql = where.length? `WHERE ${where.join(' AND ')}` : '';
  const count = db.prepare(`SELECT COUNT(*) as c FROM audit_logs ${whereSql}`).get(...params).c;
  const offset=(parseInt(page)-1)*parseInt(limit);
  const rows = db.prepare(`SELECT * FROM audit_logs ${whereSql} ORDER BY timestamp DESC LIMIT ? OFFSET ?`).all(...params, parseInt(limit), offset);
  res.json({ data:rows, total:count, page:parseInt(page), limit:parseInt(limit) });
});

// Settings
app.get('/api/settings', authRequired, (req,res)=>{
  const rows = db.prepare(`SELECT * FROM settings`).all();
  const obj={}; rows.forEach(r=> obj[r.key]=r.value);
  res.json(obj);
});
app.put('/api/settings', authRequired, requireRole('admin'), (req,res)=>{
  const data = req.body;
  Object.entries(data).forEach(([k,v])=>{
    db.prepare(`INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=?`).run(k,v,v);
  });
  audit(req.user,'UPDATE','settings','settings',`Updated settings`);
  res.json({message:'Updated'});
});

// Users & Roles (Admin)
app.get('/api/users', authRequired, requireRole('admin'), (req,res)=>{
  const rows = db.prepare(`SELECT id, username, email, role, display_name, phone, resident_id, is_active, created_at FROM users ORDER BY created_at DESC`).all();
  res.json(rows);
});
app.put('/api/users/:id', authRequired, requireRole('admin'), (req,res)=>{
  const u = db.prepare(`SELECT * FROM users WHERE id=?`).get(req.params.id);
  if(!u) return res.status(404).json({error:'User not found'});
  const { display_name, phone, role, is_active } = req.body;
  db.prepare(`UPDATE users SET display_name=?, phone=?, role=?, is_active=? WHERE id=?`).run(
    display_name||u.display_name, phone||u.phone, role||u.role, is_active!==undefined? (is_active?1:0):u.is_active, req.params.id
  );
  audit(req.user,'UPDATE','users',req.params.id,`Updated user ${u.email}`);
  res.json(db.prepare(`SELECT id, username, email, role, display_name, phone, resident_id, is_active FROM users WHERE id=?`).get(req.params.id));
});

// Global search
app.get('/api/search', authRequired, (req,res)=>{
  const q = req.query.q || '';
  if(!q || q.length<1) return res.json({ houses:[], residents:[], complaints:[], payments:[], maintenance:[], events:[] });
  const like = `%${q}%`;
  let houses = db.prepare(`SELECT id, house_no as label, block, 'House' as type FROM houses WHERE house_no LIKE ? LIMIT 5`).all(like);
  let residents = db.prepare(`SELECT id, name as label, roll_no, 'Resident' as type FROM residents WHERE name LIKE ? OR roll_no LIKE ? LIMIT 5`).all(like,like);
  let complaints = db.prepare(`SELECT id, complaint_no as label, subject as desc, 'Complaint' as type FROM complaints WHERE complaint_no LIKE ? OR subject LIKE ? LIMIT 5`).all(like,like);
  let payments = db.prepare(`SELECT id, transaction_id as label, amount as desc, 'Payment' as type FROM payments WHERE transaction_id LIKE ? LIMIT 5`).all(like);
  let maintenance = db.prepare(`SELECT id, ticket_no as label, category as desc, 'Maintenance' as type FROM maintenance_tickets WHERE ticket_no LIKE ? OR category LIKE ? LIMIT 5`).all(like,like);
  let events = db.prepare(`SELECT id, name as label, venue as desc, 'Event' as type FROM events WHERE name LIKE ? LIMIT 5`).all(like);

  if(req.user.role==='resident' && req.user.resident_id){
    const me = db.prepare(`SELECT house_id FROM residents WHERE id=?`).get(req.user.resident_id);
    // filter to own
    houses = houses.filter(h=> {
      const hid = db.prepare(`SELECT id FROM houses WHERE house_no=?`).get(h.label);
      return hid && String(hid.id)===String(me?.house_id);
    });
    complaints = db.prepare(`SELECT id, complaint_no as label, subject as desc, 'Complaint' as type FROM complaints WHERE resident_id=? AND (complaint_no LIKE ? OR subject LIKE ?) LIMIT 5`).all(req.user.resident_id, like, like);
    payments = db.prepare(`SELECT id, transaction_id as label, amount as desc, 'Payment' as type FROM payments WHERE resident_id=? AND transaction_id LIKE ? LIMIT 5`).all(req.user.resident_id, like);
    maintenance = db.prepare(`SELECT id, ticket_no as label, category as desc, 'Maintenance' as type FROM maintenance_tickets WHERE house_id=? AND (ticket_no LIKE ? OR category LIKE ?) LIMIT 5`).all(me?.house_id||0, like, like);
    // residents already filtered
  }

  res.json({ houses, residents: req.user.role==='admin'? residents: [], complaints, payments, maintenance, events });
});

// Export stub
app.get('/api/export/:type', authRequired, (req,res)=>{
  // just return json for now
  const type = req.params.type;
  let data=[];
  if(type==='houses') data = db.prepare(`SELECT * FROM houses`).all();
  else if(type==='payments') data = db.prepare(`SELECT * FROM payments`).all();
  else if(type==='complaints') data = db.prepare(`SELECT * FROM complaints`).all();
  else if(type==='maintenance') data = db.prepare(`SELECT * FROM maintenance_tickets`).all();
  else if(type==='events') data = db.prepare(`SELECT * FROM events`).all();
  else data = { message:`Export ${type} generated` };
  audit(req.user,'EXPORT',type,type,`Exported ${type}`);
  res.json({ type, data, exportedAt: nowISO() });
});

// API 404 handler - must be before SPA fallback to avoid returning HTML for unknown API routes (fixes Unexpected token '<')
app.use('/api', (req,res)=> res.status(404).json({ error: `API route not found: ${req.method} ${req.originalUrl}` }));

// Static frontend
const publicDir = path.join(__dirname, 'public');
if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir, { recursive: true });
app.use(express.static(publicDir));
app.get('*', (req,res)=>{
  const indexPath = path.join(publicDir, 'index.html');
  if (fs.existsSync(indexPath)) return res.sendFile(indexPath);
  res.status(404).send('Frontend not built yet. Run build.');
});

app.listen(PORT, ()=>{
  console.log(`\n=== Vijay Apartment Care ===`);
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Admin login: admin@vijayapartment.com / admin123`);
  console.log(`Resident logins: arjun.mehra@example.com / resident123`);
  console.log(`                priya.sharma@example.com / resident123`);
  console.log(`                vikram.singh@example.com / resident123`);
  console.log(`DB: ${dbPath}\n`);
});
