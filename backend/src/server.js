import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import PDFDocument from 'pdfkit';

dotenv.config();
const app = express();
const PORT = Number(process.env.PORT || 5000);
const JWT_SECRET = process.env.JWT_SECRET || '';
const allowedOrigin = process.env.CLIENT_ORIGIN || 'http://localhost:5173';
app.use(cors({ origin: allowedOrigin.split(',').map(s => s.trim()), credentials: false }));
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));
app.use((req, res, next) => { res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('X-Frame-Options', 'DENY'); res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin'); next(); });

const ROLES = ['Admin', 'HR', 'Employee'];
const ATTENDANCE_STATUSES = ['present', 'late', 'half_day', 'missing_checkout', 'absent', 'on_leave'];
const LEAVE_TYPES = ['Annual', 'Sick', 'Casual', 'Unpaid'];
const DAY_MS = 86400000;

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true }, email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true }, role: { type: String, enum: ROLES, required: true },
  employeeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', default: null }, active: { type: Boolean, default: true },
  mustChangePassword: { type: Boolean, default: false }, lastLoginAt: Date
}, { timestamps: true });
const employeeSchema = new mongoose.Schema({
  employeeCode: { type: String, required: true, unique: true, trim: true, uppercase: true }, name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true }, department: { type: String, required: true }, designation: { type: String, required: true },
  joinDate: { type: Date, required: true }, exitDate: Date, basicSalary: { type: Number, min: 1, required: true }, hraRate: { type: Number, default: 0.4 }, medicalRate: { type: Number, default: 0.1 },
  status: { type: String, enum: ['Active', 'Probation', 'Exited'], default: 'Active' }, phone: String, address: String, gender: String, manager: String,
  annualQuota: { type: Number, default: 14 }, sickQuota: { type: Number, default: 8 }, casualQuota: { type: Number, default: 10 }
}, { timestamps: true });
const attendanceSchema = new mongoose.Schema({
  employeeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true }, dateKey: { type: String, required: true },
  checkIn: Date, checkOut: Date, status: { type: String, enum: ATTENDANCE_STATUSES, default: 'present' }, source: { type: String, enum: ['web', 'camera', 'hr-correction', 'manual'], default: 'web' },
  hoursWorked: { type: Number, default: 0 }, locationDistanceM: Number, gpsAccuracyM: Number, faceDetected: Boolean, note: String
}, { timestamps: true });
attendanceSchema.index({ employeeId: 1, dateKey: 1 }, { unique: true });
const correctionSchema = new mongoose.Schema({ employeeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true }, attendanceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Attendance', default: null }, dateKey: { type: String, required: true }, requestedStatus: { type: String, enum: ATTENDANCE_STATUSES, required: true }, reason: { type: String, required: true }, requestedCheckIn: Date, requestedCheckOut: Date, status: { type: String, enum: ['Pending','Approved','Rejected'], default: 'Pending' }, reviewComment: String, reviewedBy: String, reviewedAt: Date }, { timestamps: true });
const leaveSchema = new mongoose.Schema({ employeeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true }, type: { type: String, required: true }, startDate: { type: Date, required: true }, endDate: { type: Date, required: true }, days: { type: Number, required: true }, reason: { type: String, required: true }, status: { type: String, enum: ['Pending','Approved','Rejected','Cancelled'], default: 'Pending' }, reviewerComment: String, reviewedBy: String, reviewedAt: Date }, { timestamps: true });
const payrollSchema = new mongoose.Schema({ month: { type: String, required: true, unique: true }, status: { type: String, enum: ['Draft','Finalized'], default: 'Draft' }, rows: [{ employeeId: mongoose.Schema.Types.ObjectId, employeeCode: String, employeeName: String, department: String, designation: String, basic: Number, hra: Number, medical: Number, gross: Number, workedDays: Number, workingDays: Number, absentDays: Number, unpaidDays: Number, halfDays: Number, lateCount: Number, latePenaltyDays: Number, deductions: Number, tax: Number, net: Number }], totalGross: Number, totalDeductions: Number, totalTax: Number, totalNet: Number, finalizedBy: String, finalizedAt: Date }, { timestamps: true });
const organizationSchema = new mongoose.Schema({
  companyName: { type: String, required: true }, officeStart: { type: String, default: '09:00' }, officeEnd: { type: String, default: '17:00' }, graceMinutes: { type: Number, default: 15 }, halfDayHours: { type: Number, default: 5 },
  weekendDays: { type: [Number], default: [0, 6] }, timeZone: { type: String, default: 'Asia/Karachi' }, officeLat: Number, officeLng: Number, officeRadiusM: { type: Number, default: 150 },
  departments: { type: [String], default: [] }, designations: { type: [String], default: [] }, leaveTypes: { type: [{ name: String, quota: Number, paid: Boolean }], default: [{name:'Annual',quota:14,paid:true},{name:'Sick',quota:8,paid:true},{name:'Casual',quota:10,paid:true},{name:'Unpaid',quota:0,paid:false}] }, holidays: { type: [{ name: String, dateKey: String }], default: [] }, latePenaltyEnabled: { type: Boolean, default: true }, darkModeDefault: { type: Boolean, default: false }
}, { timestamps: true });
const announcementSchema = new mongoose.Schema({ title: { type: String, required: true }, body: { type: String, required: true }, author: String, active: { type: Boolean, default: true } }, { timestamps: true });
const notificationSchema = new mongoose.Schema({ userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, title: String, body: String, type: String, readAt: Date, link: String }, { timestamps: true });
const auditSchema = new mongoose.Schema({ actorId: String, actor: String, role: String, action: String, entity: String, entityId: String, before: mongoose.Schema.Types.Mixed, after: mongoose.Schema.Types.Mixed }, { timestamps: true });
const aiLogSchema = new mongoose.Schema({ userId: String, role: String, question: String, toolsUsed: [String], outcome: String, durationMs: Number }, { timestamps: true });
const sessionSchema = new mongoose.Schema({ jti: { type: String, unique: true }, userId: String, active: { type: Boolean, default: true }, expiresAt: { type: Date, index: { expires: 0 } } }, { timestamps: true });
const User = mongoose.model('User', userSchema); const Employee = mongoose.model('Employee', employeeSchema); const Attendance = mongoose.model('Attendance', attendanceSchema);
const Correction = mongoose.model('AttendanceCorrection', correctionSchema); const Leave = mongoose.model('LeaveRequest', leaveSchema); const Payroll = mongoose.model('PayrollRun', payrollSchema);
const Organization = mongoose.model('Organization', organizationSchema); const Announcement = mongoose.model('Announcement', announcementSchema); const Notification = mongoose.model('Notification', notificationSchema);
const Audit = mongoose.model('AuditLog', auditSchema); const AILog = mongoose.model('AILog', aiLogSchema); const Session = mongoose.model('Session', sessionSchema);

const asyncHandler = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const fail = (res, status, message, details) => res.status(status).json({ message, ...(details ? { details } : {}) });
const idOf = obj => String(obj?._id ?? obj?.id ?? '');
const publicUser = u => ({ id: idOf(u), name: u.name, email: u.email, role: u.role, employeeId: u.employeeId ? idOf(u.employeeId) : null, mustChangePassword: !!u.mustChangePassword });
const safeEmployee = e => { const x = e?.toObject ? e.toObject() : { ...e }; if (!x) return null; x.id = idOf(x); delete x._id; delete x.__v; delete x.basicSalary; delete x.hraRate; delete x.medicalRate; return x; };
const plain = d => { if (!d) return d; if (Array.isArray(d)) return d.map(plain); const x = d.toObject ? d.toObject({ depopulate: false }) : { ...d }; if (x._id) { x.id = String(x._id); delete x._id; } delete x.__v; return x; };
const roles = (...permitted) => (req, res, next) => permitted.includes(req.user.role) ? next() : fail(res, 403, 'This role is not allowed to perform that action.');
const auth = asyncHandler(async (req, res, next) => {
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return fail(res, 401, 'Please sign in to continue.');
  try {
    const payload = jwt.verify(token, JWT_SECRET || 'local-development-secret-change-me');
    const session = await Session.findOne({ jti: payload.jti, userId: payload.id, active: true });
    if (!session) return fail(res, 401, 'This session has ended. Please sign in again.');
    const user = await User.findById(payload.id);
    if (!user || !user.active) return fail(res, 401, 'This account is inactive. Contact an administrator.');
    req.user = { id: idOf(user), name: user.name, email: user.email, role: user.role, employeeId: user.employeeId ? idOf(user.employeeId) : null, mustChangePassword: user.mustChangePassword, _doc: user };
    if (user.mustChangePassword && !['/api/auth/change-password', '/api/auth/logout', '/api/auth/me'].includes(req.path)) return fail(res, 428, 'You must change your temporary password before using HCM Lite.');
    next();
  } catch (e) { if (e?.statusCode) return fail(res, e.statusCode, e.message); return fail(res, 401, 'Invalid or expired session. Please sign in again.'); }
});
const audit = async (req, action, entity, entityId = '', before = null, after = null) => Audit.create({ actorId: req.user?.id || 'system', actor: req.user?.name || 'System', role: req.user?.role || 'System', action, entity, entityId: String(entityId || ''), before: cleanAudit(before), after: cleanAudit(after) });
function cleanAudit(value) { if (!value) return value; const x = value.toObject ? value.toObject() : JSON.parse(JSON.stringify(value)); delete x.passwordHash; delete x.__v; return x; }
async function org() { let o = await Organization.findOne(); if (!o) o = await Organization.create({ companyName: 'My Company' }); return o; }
function localDateKey(date = new Date(), timeZone = 'Asia/Karachi') { const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date); const v = Object.fromEntries(parts.map(p => [p.type, p.value])); return `${v.year}-${v.month}-${v.day}`; }
function parseKey(key) { const [y,m,d] = String(key).split('-').map(Number); return new Date(Date.UTC(y, m - 1, d, 12)); }
function keyOfDate(date) { const d = new Date(date); return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`; }
function isWorkday(key, settings) { const weekday = parseKey(key).getUTCDay(); return !(settings.weekendDays || [0,6]).includes(weekday) && !(settings.holidays || []).some(h => h.dateKey === key); }
function workingDaysBetween(startKey, endKey, settings) { const list = []; for (let key = startKey; key <= endKey; key = keyOfDate(parseKey(key).getTime() + DAY_MS)) if (isWorkday(key, settings)) list.push(key); return list; }
function daysInclusive(start, end, settings) { return workingDaysBetween(start, end, settings).length; }
function timeToMinutes(value) { const [h,m] = String(value || '09:00').split(':').map(Number); return h * 60 + m; }
function dateTimeInZone(dateKey, clock, timeZone = 'Asia/Karachi') {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateKey)) || !/^\d{2}:\d{2}$/.test(String(clock))) return undefined;
  const [year, month, day] = dateKey.split('-').map(Number);
  const [hour, minute] = clock.split(':').map(Number);
  if (hour > 23 || minute > 59) return undefined;
  const wallClockAsUtc = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  let guess = wallClockAsUtc;
  for (let i = 0; i < 3; i++) {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(guess));
    const v = Object.fromEntries(parts.map(p => [p.type, p.value]));
    const renderedAsUtc = Date.UTC(Number(v.year), Number(v.month) - 1, Number(v.day), Number(v.hour), Number(v.minute));
    const offset = renderedAsUtc - guess;
    const next = wallClockAsUtc - offset;
    if (next === guess) break;
    guess = next;
  }
  return new Date(guess);
}
function haversineMeters(lat1, lon1, lat2, lon2) { const R = 6371000; const rad = d => d * Math.PI / 180; const a = Math.sin(rad(lat2-lat1)/2)**2 + Math.cos(rad(lat1))*Math.cos(rad(lat2))*Math.sin(rad(lon2-lon1)/2)**2; return 2 * R * Math.asin(Math.sqrt(a)); }
async function notifyUser(userId, title, body, type = 'info', link = '') { if (userId) await Notification.create({ userId, title, body, type, link }); }
async function notifyEmployee(employeeId, title, body, type = 'info', link = '') { const u = await User.findOne({ employeeId, active: true }); if (u) await notifyUser(u._id, title, body, type, link); }
function taxAnnual(annualGross) { if (annualGross <= 600000) return 0; if (annualGross <= 1200000) return (annualGross - 600000) * 0.05; if (annualGross <= 2400000) return 30000 + (annualGross - 1200000) * 0.15; if (annualGross <= 3600000) return 210000 + (annualGross - 2400000) * 0.25; return 510000 + (annualGross - 3600000) * 0.35; }
function isValidEmail(email) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '')); }
function tempPassword() { return `HCM-${crypto.randomBytes(4).toString('hex')}-!`; }
function csvRows(raw) { const lines = String(raw || '').replace(/^\uFEFF/, '').split(/\r?\n/).filter(x => x.trim()); if (!lines.length) return { headers: [], rows: [] }; const parse = line => { const out = []; let cur = '', quoted = false; for (let i=0;i<line.length;i++) { const ch=line[i]; if (ch === '"' && line[i+1] === '"' && quoted) { cur+='"'; i++; } else if (ch === '"') quoted=!quoted; else if (ch === ',' && !quoted) { out.push(cur.trim()); cur=''; } else cur+=ch; } out.push(cur.trim()); return out; }; const headers = parse(lines[0]).map(h=>h.replace(/^\"|\"$/g,'')); return { headers, rows: lines.slice(1).map(line=>Object.fromEntries(parse(line).map((v,i)=>[headers[i],v]))) }; }
const csvEscape = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
function scopedEmployeeFilter(user) { return user.role === 'Employee' ? { _id: user.employeeId || null } : {}; }
async function employeeSelf(req, res) { const e = req.user.employeeId ? await Employee.findById(req.user.employeeId) : null; if (!e) { fail(res, 404, 'This login is not linked to an employee profile. Ask HR/Admin to link your account.'); return null; } return e; }

app.get('/api/health', (req, res) => res.json({ ok: true, service: 'HCM Lite API', database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected' }));
app.get('/api/setup/status', asyncHandler(async (req, res) => res.json({ setupRequired: !(await User.exists({ role: 'Admin' })), databaseReady: mongoose.connection.readyState === 1 })));
app.post('/api/setup/initialize', asyncHandler(async (req, res) => {
  if (await User.exists({ role: 'Admin' })) return fail(res, 409, 'HCM Lite is already configured. Please sign in.');
  const { companyName, adminName, adminEmail, adminPassword, officeStart = '09:00', officeEnd = '17:00', graceMinutes = 15, weekendDays = [0,6] } = req.body;
  if (!String(companyName || '').trim() || !String(adminName || '').trim() || !isValidEmail(adminEmail) || String(adminPassword || '').length < 8) return fail(res, 422, 'Company, Admin name, valid email and a password of at least 8 characters are required.');
  if (await Organization.exists()) await Organization.deleteMany({});
  const settings = await Organization.create({ companyName: String(companyName).trim(), officeStart, officeEnd, graceMinutes: Number(graceMinutes), weekendDays: weekendDays.map(Number).filter(n=>n>=0&&n<=6) });
  const user = await User.create({ name: adminName.trim(), email: adminEmail.toLowerCase().trim(), passwordHash: await bcrypt.hash(adminPassword, 12), role: 'Admin', active: true, mustChangePassword: false });
  await Audit.create({ actorId: String(user._id), actor: user.name, role: 'Admin', action: 'FIRST_RUN_SETUP', entity: 'Organization', entityId: String(settings._id), before: null, after: { companyName: settings.companyName, officeStart, officeEnd, graceMinutes } });
  res.status(201).json({ configured: true, message: 'Company and Admin account created. Sign in to continue.' });
}));

app.post('/api/auth/login', asyncHandler(async (req, res) => {
  const email = String(req.body.email || '').toLowerCase().trim(); const password = String(req.body.password || '');
  const user = await User.findOne({ email, active: true });
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) return fail(res, 401, 'Email or password is incorrect.');
  const jti = crypto.randomUUID(); const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000);
  await Session.create({ jti, userId: String(user._id), expiresAt, active: true }); user.lastLoginAt = new Date(); await user.save();
  const token = jwt.sign({ id: String(user._id), role: user.role, jti }, JWT_SECRET || 'local-development-secret-change-me', { expiresIn: '8h' });
  await Audit.create({ actorId: String(user._id), actor: user.name, role: user.role, action: 'LOGIN', entity: 'Session', entityId: jti });
  res.json({ token, user: publicUser(user) });
}));
app.get('/api/auth/me', auth, asyncHandler(async (req, res) => { const u = await User.findById(req.user.id); res.json({ user: publicUser(u) }); }));
app.post('/api/auth/logout', auth, asyncHandler(async (req, res) => { const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, ''); const payload = jwt.decode(token); if (payload?.jti) await Session.updateOne({ jti: payload.jti }, { $set: { active: false } }); await audit(req, 'LOGOUT', 'Session', payload?.jti || ''); res.json({ ok: true }); }));
app.post('/api/auth/change-password', auth, asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body; if (String(newPassword || '').length < 8) return fail(res, 422, 'New password must contain at least 8 characters.');
  const u = await User.findById(req.user.id); if (!u || !(await bcrypt.compare(String(currentPassword || ''), u.passwordHash))) return fail(res, 400, 'Current password is incorrect.');
  const before = { mustChangePassword: u.mustChangePassword }; u.passwordHash = await bcrypt.hash(newPassword, 12); u.mustChangePassword = false; await u.save();
  await Session.updateMany({ userId: String(u._id), active: true }, { $set: { active: false } }); const jti = crypto.randomUUID(); const expiresAt = new Date(Date.now()+8*3600000); await Session.create({ jti, userId: String(u._id), expiresAt });
  const token = jwt.sign({ id: String(u._id), role: u.role, jti }, JWT_SECRET || 'local-development-secret-change-me', { expiresIn: '8h' });
  await audit(req, 'CHANGE_PASSWORD', 'User', u._id, before, { mustChangePassword: false }); res.json({ token, user: publicUser(u), message: 'Password changed successfully.' });
}));

app.get('/api/org/public', auth, asyncHandler(async (req,res) => { const s=await org(); res.json({companyName:s.companyName,leaveTypes:(s.leaveTypes||[]).map(x=>({name:x.name,quota:x.quota,paid:x.paid})),holidays:(s.holidays||[]).map(x=>({name:x.name,dateKey:x.dateKey})),departments:s.departments||[],designations:s.designations||[],weekendDays:s.weekendDays,timeZone:s.timeZone,officeStart:s.officeStart,graceMinutes:s.graceMinutes,halfDayHours:s.halfDayHours}); }));
app.get('/api/org/setup', auth, roles('Admin','HR'), asyncHandler(async (req,res) => res.json({ organization: plain(await org()) })));
app.patch('/api/org/setup', auth, roles('Admin'), asyncHandler(async (req,res) => {
  const s = await org(); const allowed = ['companyName','officeStart','officeEnd','graceMinutes','halfDayHours','weekendDays','timeZone','officeLat','officeLng','officeRadiusM','latePenaltyEnabled','darkModeDefault']; const before = plain(s);
  for (const k of allowed) if (req.body[k] !== undefined) s[k] = req.body[k]; if (s.graceMinutes < 0 || s.officeRadiusM < 1) return fail(res,422,'Grace minutes must be non-negative and radius must be positive.'); await s.save(); await audit(req,'UPDATE','Organization',s._id,before,plain(s)); res.json({organization:plain(s)});
}));
const orgListConfig = { departments: { field:'departments', value:'string' }, designations: { field:'designations', value:'string' }, leaveTypes: { field:'leaveTypes', value:'object' }, holidays: { field:'holidays', value:'object' } };
app.get('/api/org/lists/:kind', auth, roles('Admin','HR'), asyncHandler(async (req,res) => { const cfg=orgListConfig[req.params.kind]; if(!cfg) return fail(res,404,'Unknown organization list.'); const s=await org(); res.json({items:s[cfg.field]}); }));
app.post('/api/org/lists/:kind', auth, roles('Admin'), asyncHandler(async (req,res) => {
  const cfg=orgListConfig[req.params.kind]; if(!cfg) return fail(res,404,'Unknown organization list.'); const s=await org(); const before=plain(s); let v;
  if(cfg.value==='string') { v=String(req.body.name||'').trim(); if(!v) return fail(res,422,'A name is required.'); if(s[cfg.field].some(x=>x.toLowerCase()===v.toLowerCase())) return fail(res,409,'This value already exists.'); }
  else if(req.params.kind==='leaveTypes') { v={name:String(req.body.name||'').trim(),quota:Number(req.body.quota||0),paid:!!req.body.paid}; if(!v.name||v.quota<0||v.quota>365) return fail(res,422,'Leave type name and valid quota are required.'); if(s.leaveTypes.some(x=>x.name.toLowerCase()===v.name.toLowerCase())) return fail(res,409,'This leave type already exists.'); }
  else { v={name:String(req.body.name||'').trim(),dateKey:String(req.body.dateKey||'')}; if(!v.name||!/^\d{4}-\d{2}-\d{2}$/.test(v.dateKey)) return fail(res,422,'Holiday name and date (YYYY-MM-DD) are required.'); if(s.holidays.some(x=>x.dateKey===v.dateKey)) return fail(res,409,'A holiday already exists on this date.'); }
  s[cfg.field].push(v); await s.save(); await audit(req,'CREATE',req.params.kind,v.name||v.dateKey,before,plain(s)); res.status(201).json({items:s[cfg.field]});
}));
app.patch('/api/org/lists/:kind/:index', auth, roles('Admin'), asyncHandler(async (req,res) => {
  const cfg=orgListConfig[req.params.kind]; if(!cfg) return fail(res,404,'Unknown organization list.'); const s=await org(); const i=Number(req.params.index); if(!Number.isInteger(i)||i<0||i>=s[cfg.field].length) return fail(res,404,'List item not found.'); const before=plain(s); const old=s[cfg.field][i];
  if(cfg.value==='string') s[cfg.field][i]=String(req.body.name||'').trim(); else if(req.params.kind==='leaveTypes') s.leaveTypes[i]={name:String(req.body.name??old.name).trim(),quota:Number(req.body.quota??old.quota),paid:req.body.paid===undefined?old.paid:!!req.body.paid}; else s.holidays[i]={name:String(req.body.name??old.name).trim(),dateKey:String(req.body.dateKey??old.dateKey)};
  await s.save(); await audit(req,'UPDATE',req.params.kind,req.params.index,before,plain(s)); res.json({items:s[cfg.field]});
}));
app.delete('/api/org/lists/:kind/:index', auth, roles('Admin'), asyncHandler(async (req,res) => { const cfg=orgListConfig[req.params.kind]; if(!cfg) return fail(res,404,'Unknown organization list.'); const s=await org(); const i=Number(req.params.index); if(!Number.isInteger(i)||i<0||i>=s[cfg.field].length) return fail(res,404,'List item not found.'); const before=plain(s); s[cfg.field].splice(i,1); await s.save(); await audit(req,'DELETE',req.params.kind,req.params.index,before,plain(s)); res.json({items:s[cfg.field]}); }));

app.get('/api/users', auth, roles('Admin'), asyncHandler(async (req,res)=>{ const users=await User.find().populate('employeeId','employeeCode name'); res.json({items:users.map(u=>({...publicUser(u),active:u.active,createdAt:u.createdAt,lastLoginAt:u.lastLoginAt}))}); }));
app.post('/api/users/hr', auth, roles('Admin'), asyncHandler(async(req,res)=>{
  const {name,email,employeeId}=req.body; if(!String(name||'').trim()||!isValidEmail(email)) return fail(res,422,'Name and valid email are required.'); if(await User.exists({email:String(email).toLowerCase().trim()})) return fail(res,409,'An account already uses this email.');
  if(employeeId && !(await Employee.exists({_id:employeeId}))) return fail(res,404,'Linked employee profile not found.'); const password=tempPassword(); const u=await User.create({name:String(name).trim(),email:String(email).toLowerCase().trim(),passwordHash:await bcrypt.hash(password,12),role:'HR',employeeId:employeeId||null,mustChangePassword:true}); await audit(req,'CREATE','User',u._id,null,{name:u.name,email:u.email,role:u.role}); res.status(201).json({user:publicUser(u),credentials:{email:u.email,temporaryPassword:password},message:'Share this temporary password securely. It is shown only once.'});
}));
app.patch('/api/users/:id/active', auth, roles('Admin'), asyncHandler(async(req,res)=>{const u=await User.findById(req.params.id);if(!u)return fail(res,404,'Account not found.'); if(String(u._id)===req.user.id)return fail(res,422,'You cannot deactivate your own current account.');const before={active:u.active};u.active=!!req.body.active;await u.save();if(!u.active)await Session.updateMany({userId:String(u._id),active:true},{$set:{active:false}});await audit(req,'UPDATE','User',u._id,before,{active:u.active});res.json({user:{...publicUser(u),active:u.active}});}));
app.post('/api/users/:id/reset-password', auth, roles('Admin'), asyncHandler(async(req,res)=>{const u=await User.findById(req.params.id);if(!u)return fail(res,404,'Account not found.');const p=tempPassword();u.passwordHash=await bcrypt.hash(p,12);u.mustChangePassword=true;await u.save();await Session.updateMany({userId:String(u._id),active:true},{$set:{active:false}});await audit(req,'RESET_PASSWORD','User',u._id,null,{mustChangePassword:true});res.json({credentials:{email:u.email,temporaryPassword:p},message:'Password reset. Share the temporary password securely.'});}));

app.get('/api/employees', auth, asyncHandler(async(req,res)=>{
  if(req.user.role==='Employee'){const e=await employeeSelf(req,res);if(!e)return;return res.json({items:[safeEmployee(e)],total:1,page:1,limit:1});}
  const q=String(req.query.q||'').slice(0,100);const dept=String(req.query.department||'');const status=String(req.query.status||'');const page=Math.max(1,Number(req.query.page||1));const limit=Math.min(100,Math.max(1,Number(req.query.limit||20)));const filter={};if(q){const re=new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'i');filter.$or=[{name:re},{email:re},{employeeCode:re},{department:re},{designation:re}];}if(dept)filter.department=dept;if(status)filter.status=status;
  const [items,total]=await Promise.all([Employee.find(filter).sort({createdAt:-1}).skip((page-1)*limit).limit(limit),Employee.countDocuments(filter)]);res.json({items:items.map(plain),total,page,limit});
}));
app.get('/api/employees/export.csv', auth, roles('HR'), asyncHandler(async(req,res)=>{const items=await Employee.find().sort({employeeCode:1});const header=['employeeCode','name','email','department','designation','joinDate','basicSalary','status','phone','address'];const lines=[header.join(','),...items.map(e=>header.map(k=>csvEscape(k==='joinDate'?keyOfDate(e.joinDate):e[k])).join(','))];res.setHeader('Content-Type','text/csv; charset=utf-8');res.setHeader('Content-Disposition','attachment; filename="hcm-employees.csv"');res.send('\uFEFF'+lines.join('\r\n'));}));
app.post('/api/employees/import/dry-run', auth, roles('HR'), asyncHandler(async(req,res)=>{
  const {headers,rows}=csvRows(req.body.csv||'');if(!headers.length)return fail(res,422,'Paste or upload a CSV with a header row.');const required=['employeeCode','name','email','department','designation','joinDate','basicSalary'];const missing=required.filter(h=>!headers.includes(h));if(missing.length)return fail(res,422,`CSV is missing required headers: ${missing.join(', ')}`);
  const s=await org();const codes=new Set((await Employee.find().select('employeeCode')).map(e=>e.employeeCode.toLowerCase()));const emails=new Set((await Employee.find().select('email')).map(e=>e.email.toLowerCase()));const report=rows.map((r,i)=>{const errors=[];for(const f of required)if(!String(r[f]||'').trim())errors.push({field:f,reason:'Required field is empty'});if(r.email&&!isValidEmail(r.email))errors.push({field:'email',reason:'Invalid email format'});if(r.joinDate&&!/^\d{4}-\d{2}-\d{2}$/.test(r.joinDate))errors.push({field:'joinDate',reason:'Use ISO date YYYY-MM-DD'});if(r.basicSalary&&(!Number.isFinite(Number(r.basicSalary))||Number(r.basicSalary)<=0))errors.push({field:'basicSalary',reason:'Salary must be greater than zero'});if(r.employeeCode&&codes.has(r.employeeCode.toLowerCase()))errors.push({field:'employeeCode',reason:'Code already exists or appears earlier in this file'});if(r.email&&emails.has(r.email.toLowerCase()))errors.push({field:'email',reason:'Email already exists or appears earlier in this file'});if(r.department&&!s.departments.some(d=>d.toLowerCase()===r.department.toLowerCase()))errors.push({field:'department',reason:'Unknown department; add it in Organization Setup first'});if(r.designation&&!s.designations.some(d=>d.toLowerCase()===r.designation.toLowerCase()))errors.push({field:'designation',reason:'Unknown designation; add it in Organization Setup first'});if(r.employeeCode)codes.add(r.employeeCode.toLowerCase());if(r.email)emails.add(r.email.toLowerCase());return {row:i+2,values:r,errors};});req.app.locals.imports=req.app.locals.imports||new Map();const key=crypto.randomUUID();req.app.locals.imports.set(key,{createdBy:req.user.id,rows:report.filter(r=>!r.errors.length).map(r=>r.values),createdAt:Date.now()});res.json({importId:key,totalRows:rows.length,validRows:report.filter(r=>!r.errors.length).length,invalidRows:report.filter(r=>r.errors.length).length,report});
}));
app.post('/api/employees/import/:importId/commit', auth, roles('HR'), asyncHandler(async(req,res)=>{const record=req.app.locals.imports?.get(req.params.importId);if(!record||record.createdBy!==req.user.id||Date.now()-record.createdAt>15*60*1000)return fail(res,404,'Import preview expired. Run the dry-run again.');const created=[];for(const r of record.rows){const password=tempPassword();const employee=await Employee.create({employeeCode:r.employeeCode,name:r.name,email:r.email,department:r.department,designation:r.designation,joinDate:new Date(`${r.joinDate}T12:00:00Z`),basicSalary:Number(r.basicSalary),status:r.status||'Active',phone:r.phone||'',address:r.address||''});const user=await User.create({name:employee.name,email:employee.email,passwordHash:await bcrypt.hash(password,12),role:'Employee',employeeId:employee._id,mustChangePassword:true});created.push({employeeId:String(employee._id),employeeCode:employee.employeeCode,email:user.email,temporaryPassword:password});await audit(req,'IMPORT','Employee',employee._id,null,plain(employee));}req.app.locals.imports.delete(req.params.importId);res.status(201).json({created,total:created.length,message:'Valid rows imported; temporary credentials are shown once.'});}));
app.post('/api/employees', auth, roles('HR'), asyncHandler(async(req,res)=>{
  const b=req.body; if(!String(b.employeeCode||'').trim()||!String(b.name||'').trim()||!isValidEmail(b.email)||!String(b.department||'').trim()||!String(b.designation||'').trim()||Number(b.basicSalary)<=0||!b.joinDate)return fail(res,422,'Employee code, name, valid email, department, designation, join date and positive basic salary are required.');
  const s=await org();if(s.departments.length&&!s.departments.includes(b.department))return fail(res,422,'Select a department configured in Organization Setup.');if(s.designations.length&&!s.designations.includes(b.designation))return fail(res,422,'Select a designation configured in Organization Setup.');if(await User.exists({email:String(b.email).toLowerCase().trim()}))return fail(res,409,'An account already uses this email.');
  const password=tempPassword();const employee=await Employee.create({employeeCode:b.employeeCode,name:b.name,email:b.email,department:b.department,designation:b.designation,joinDate:new Date(`${b.joinDate}T12:00:00Z`),basicSalary:Number(b.basicSalary),hraRate:Number(b.hraRate??0.4),medicalRate:Number(b.medicalRate??0.1),status:b.status||'Active',phone:b.phone||'',address:b.address||'',gender:b.gender||'',manager:b.manager||''});
  await User.create({name:employee.name,email:employee.email,passwordHash:await bcrypt.hash(password,12),role:'Employee',employeeId:employee._id,mustChangePassword:true});await audit(req,'CREATE','Employee',employee._id,null,plain(employee));res.status(201).json({employee:plain(employee),credentials:{email:employee.email,temporaryPassword:password},message:'Employee and login created. Share the temporary password securely.'});
}));
app.get('/api/employees/:id', auth, asyncHandler(async(req,res)=>{if(req.user.role==='Employee'&&String(req.user.employeeId)!==String(req.params.id))return fail(res,403,'You can only view your own profile.');const e=await Employee.findById(req.params.id);if(!e)return fail(res,404,'Employee not found.');if(req.user.role==='Employee')return res.json({employee:safeEmployee(e)});if(!['Admin','HR'].includes(req.user.role))return fail(res,403,'Forbidden.');const [attendance,leaves,payroll,user]=await Promise.all([Attendance.find({employeeId:e._id}).sort({dateKey:-1}).limit(30),Leave.find({employeeId:e._id}).sort({createdAt:-1}).limit(20),Payroll.find({'rows.employeeId':e._id}).sort({month:-1}).limit(12),User.findOne({employeeId:e._id})]);res.json({employee:plain(e),attendance:attendance.map(plain),leaves:leaves.map(plain),payroll:payroll.map(p=>({...plain(p),rows:p.rows.filter(r=>String(r.employeeId)===String(e._id))})),account:user?{id:String(user._id),active:user.active,mustChangePassword:user.mustChangePassword}:null});}));
app.patch('/api/employees/:id', auth, asyncHandler(async(req,res)=>{const employee=await Employee.findById(req.params.id);if(!employee)return fail(res,404,'Employee not found.');if(req.body.email!==undefined&&String(req.body.email).toLowerCase()!==employee.email.toLowerCase())return fail(res,422,'Email changes must be made by Admin with account identity checks.');const before=plain(employee);let allowed=[];if(req.user.role==='HR')allowed=['name','department','designation','joinDate','basicSalary','hraRate','medicalRate','status','phone','address','gender','manager','exitDate','employeeCode'];else if(req.user.role==='Employee'&&String(req.user.employeeId)===String(employee._id))allowed=['phone','address'];else return fail(res,403,'Only HR can manage employee details; employees can update their own phone and address.');for(const k of allowed)if(req.body[k]!==undefined)employee[k]=req.body[k];if(req.user.role==='HR'&&req.body.status==='Exited'&&req.body.exitDate===undefined&&!employee.exitDate){const cfg=await org();employee.exitDate=parseKey(localDateKey(new Date(),cfg.timeZone));}await employee.save();await User.updateMany({employeeId:employee._id},{$set:{name:employee.name}});await audit(req,'UPDATE','Employee',employee._id,before,plain(employee));res.json({employee:plain(employee)});}));
app.delete('/api/employees/:id', auth, roles('Admin'), asyncHandler(async(req,res)=>{const e=await Employee.findById(req.params.id);if(!e)return fail(res,404,'Employee not found.');const before=plain(e);await Promise.all([Attendance.deleteMany({employeeId:e._id}),Leave.deleteMany({employeeId:e._id}),Correction.deleteMany({employeeId:e._id}),User.updateMany({employeeId:e._id},{$set:{active:false}})]);await Employee.deleteOne({_id:e._id});await audit(req,'DELETE','Employee',e._id,before,null);res.json({message:'Employee deleted. The linked login was deactivated; historical payroll snapshots remain.'});}));

async function getAttendanceList(user, query = {}) { const filter={}; if(user.role==='Employee'||(user.role==='HR'&&query.mine==='true'))filter.employeeId=user.employeeId; if(query.from||query.to){filter.dateKey={};if(query.from)filter.dateKey.$gte=query.from;if(query.to)filter.dateKey.$lte=query.to;} if(query.department&&user.role!=='Employee'){const ids=(await Employee.find({department:query.department}).select('_id')).map(e=>e._id);filter.employeeId={$in:ids};}return Attendance.find(filter).populate('employeeId','employeeCode name department designation').sort({dateKey:-1,checkIn:-1}).limit(1000); }
app.get('/api/attendance/calendar', auth, asyncHandler(async(req,res)=>{
  if(!['Admin','HR','Employee'].includes(req.user.role))return fail(res,403,'Forbidden.');
  const s=await org();const month=String(req.query.month||localDateKey(new Date(),s.timeZone).slice(0,7));if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))return fail(res,422,'Month must use YYYY-MM format.');
  const [year,mon]=month.split('-').map(Number);const first=`${month}-01`;const last=keyOfDate(new Date(Date.UTC(year,mon,0,12)));const today=localDateKey(new Date(),s.timeZone);
  let employees;if(req.user.role==='Employee'||(req.user.role==='HR'&&req.query.mine==='true')){const own=req.user.employeeId?await Employee.findById(req.user.employeeId):null;employees=own?[own]:[];}else employees=await Employee.find({status:{$in:['Active','Probation']}}).sort({employeeCode:1});
  const ids=employees.map(e=>e._id);const [records,leaves]=await Promise.all([Attendance.find({employeeId:{$in:ids},dateKey:{$gte:first,$lte:last}}),Leave.find({employeeId:{$in:ids},status:'Approved',startDate:{$lte:parseKey(last)},endDate:{$gte:parseKey(first)}})]);
  const byKey=new Map(records.map(a=>[`${String(a.employeeId)}:${a.dateKey}`,a]));const days=[];
  for(let key=first;key<=last;key=keyOfDate(parseKey(key).getTime()+DAY_MS)){
    const workingDay=isWorkday(key,s);const entries=employees.map(e=>{const a=byKey.get(`${String(e._id)}:${key}`)||null;const leave=leaves.find(l=>String(l.employeeId)===String(e._id)&&keyOfDate(l.startDate)<=key&&keyOfDate(l.endDate)>=key);const employed=key>=keyOfDate(e.joinDate)&&(!e.exitDate||key<=keyOfDate(e.exitDate));const status=a?.status||(leave&&workingDay?'on_leave':!workingDay?'off_day':!employed?'not_due':key<=today?'absent':'not_due');return {employee:safeEmployee(e),attendance:a?plain(a):null,status,dateKey:key};});
    const counts={};for(const entry of entries)counts[entry.status]=(counts[entry.status]||0)+1;days.push({dateKey:key,workingDay,counts,entries});
  }
  res.json({month,first,last,days});
}));
app.get('/api/attendance', auth, asyncHandler(async(req,res)=>{if(!['Admin','HR','Employee'].includes(req.user.role))return fail(res,403,'Forbidden.');const items=await getAttendanceList(req.user,req.query);res.json({items:items.map(a=>{const x=plain(a);x.employee=a.employeeId?plain(a.employeeId):null;return x;})});}));
app.get('/api/attendance/board', auth, roles('Admin','HR'), asyncHandler(async(req,res)=>{const s=await org();const dateKey=/^\d{4}-\d{2}-\d{2}$/.test(req.query.date||'')?req.query.date:localDateKey(new Date(),s.timeZone);const filter={status:{$in:['Active','Probation']}};if(req.query.department)filter.department=req.query.department;const employees=await Employee.find(filter).sort({employeeCode:1});const recs=await Attendance.find({dateKey,employeeId:{$in:employees.map(e=>e._id)}});const byId=new Map(recs.map(a=>[String(a.employeeId),a]));const leaves=await Leave.find({status:'Approved',startDate:{$lte:parseKey(dateKey)},endDate:{$gte:parseKey(dateKey)}});const onLeave=new Set(leaves.filter(l=>isWorkday(dateKey,s)).map(l=>String(l.employeeId)));const items=employees.map(e=>{let a=byId.get(String(e._id));const employed=dateKey>=keyOfDate(e.joinDate)&&(!e.exitDate||dateKey<=keyOfDate(e.exitDate));let status=a?.status|| (onLeave.has(String(e._id))?'on_leave':!employed?'not_due':isWorkday(dateKey,s)&&dateKey<=localDateKey(new Date(),s.timeZone)?'absent':'not_due');return {employee:plain(e),attendance:a?plain(a):null,status,dateKey};});res.json({dateKey,workingDay:isWorkday(dateKey,s),items});}));
app.post('/api/attendance', auth, roles('HR'), asyncHandler(async(req,res)=>{const b=req.body;if(!b.employeeId||!/^\d{4}-\d{2}-\d{2}$/.test(b.dateKey||'')||!ATTENDANCE_STATUSES.includes(b.status||'present'))return fail(res,422,'Employee, valid date and status are required.');if(!(await Employee.exists({_id:b.employeeId})))return fail(res,404,'Employee not found.');const s=await org();const inAt=b.checkIn?dateTimeInZone(b.dateKey,b.checkIn,s.timeZone):undefined;const outAt=b.checkOut?dateTimeInZone(b.dateKey,b.checkOut,s.timeZone):undefined;if(await Attendance.exists({employeeId:b.employeeId,dateKey:b.dateKey}))return fail(res,409,'An attendance record already exists for this employee on that date. Edit the existing record instead.');const item=await Attendance.create({employeeId:b.employeeId,dateKey:b.dateKey,status:b.status||'present',checkIn:inAt,checkOut:outAt,source:'manual',note:String(b.note||'')});if(inAt&&outAt)item.hoursWorked=Math.max(0,(outAt-inAt)/3600000);await item.save();await audit(req,'CREATE','Attendance',item._id,null,plain(item));res.status(201).json({item:plain(item)});}));
app.patch('/api/attendance/:id', auth, roles('HR'), asyncHandler(async(req,res)=>{const a=await Attendance.findById(req.params.id);if(!a)return fail(res,404,'Attendance record not found.');if(a.status==='absent'&&req.body.status==='present'){}const before=plain(a);if(req.body.status!==undefined){if(!ATTENDANCE_STATUSES.includes(req.body.status))return fail(res,422,'Choose a valid attendance status.');a.status=req.body.status;}if(req.body.note!==undefined)a.note=String(req.body.note);if(req.body.checkIn!==undefined){const settings=await org();a.checkIn=req.body.checkIn?dateTimeInZone(a.dateKey,req.body.checkIn,settings.timeZone):undefined;}if(req.body.checkOut!==undefined){const settings=await org();a.checkOut=req.body.checkOut?dateTimeInZone(a.dateKey,req.body.checkOut,settings.timeZone):undefined;}if(a.checkIn&&a.checkOut)a.hoursWorked=Math.max(0,(a.checkOut-a.checkIn)/3600000);await a.save();await audit(req,'UPDATE','Attendance',a._id,before,plain(a));await notifyEmployee(a.employeeId,'Attendance updated',`Your attendance for ${a.dateKey} was updated to ${a.status}.`,'attendance','/attendance');res.json({item:plain(a)});}));
app.delete('/api/attendance/:id', auth, roles('Admin'), asyncHandler(async(req,res)=>{const a=await Attendance.findById(req.params.id);if(!a)return fail(res,404,'Attendance record not found.');const before=plain(a);await a.deleteOne();await audit(req,'DELETE','Attendance',a._id,before,null);res.json({message:'Attendance record deleted by Admin.'});}));
app.post('/api/attendance/check-in', auth, roles('Employee','HR'), asyncHandler(async(req,res)=>{const e=await employeeSelf(req,res);if(!e)return;const s=await org();const dateKey=localDateKey(new Date(),s.timeZone);const existing=await Attendance.findOne({employeeId:e._id,dateKey});if(existing)return fail(res,409,'You already checked in today. Use Check out for the existing record.');const b=req.body||{};let distance;
  if(b.source==='camera'){if(!b.faceDetected)return fail(res,422,'Exactly one face must be detected in the camera frame.');if(!Number.isFinite(Number(b.latitude))||!Number.isFinite(Number(b.longitude)))return fail(res,422,'Location permission is required for camera check-in.');if(!Number.isFinite(Number(b.accuracy))||Number(b.accuracy)>100)return fail(res,422,'GPS accuracy must be 100 metres or better.');if(!Number.isFinite(s.officeLat)||!Number.isFinite(s.officeLng))return fail(res,422,'Admin must configure office latitude and longitude first.');distance=haversineMeters(Number(s.officeLat),Number(s.officeLng),Number(b.latitude),Number(b.longitude));if(distance>Number(s.officeRadiusM||150))return fail(res,422,`You are outside the office radius (${Math.round(distance)} m away; allowed ${s.officeRadiusM} m).`);}
  const now=new Date();const localTime=new Intl.DateTimeFormat('en-GB',{timeZone:s.timeZone,hour:'2-digit',minute:'2-digit',hour12:false}).format(now);const status=timeToMinutes(localTime)>timeToMinutes(s.officeStart)+Number(s.graceMinutes||15)?'late':'present';const item=await Attendance.create({employeeId:e._id,dateKey,checkIn:now,status,source:b.source==='camera'?'camera':'web',locationDistanceM:distance,gpsAccuracyM:b.accuracy?Number(b.accuracy):undefined,faceDetected:b.source==='camera'?!!b.faceDetected:undefined});await audit(req,'CHECK_IN','Attendance',item._id,null,plain(item));res.status(201).json({item:plain(item),message:`Check-in recorded at ${localTime}. Status: ${status}.`});}));
app.post('/api/attendance/:id/check-out', auth, roles('Employee','HR'), asyncHandler(async(req,res)=>{const a=await Attendance.findById(req.params.id);if(!a)return fail(res,404,'Attendance record not found.');if(String(a.employeeId)!==String(req.user.employeeId))return fail(res,403,'You can only check out your own attendance.');if(a.checkOut)return fail(res,409,'Check-out has already been recorded.');const before=plain(a);a.checkOut=new Date();a.hoursWorked=Math.max(0,(a.checkOut-(a.checkIn||a.checkOut))/3600000);const s=await org();if(a.hoursWorked<Number(s.halfDayHours||5)&&!['absent','on_leave'].includes(a.status))a.status='half_day';await a.save();await audit(req,'CHECK_OUT','Attendance',a._id,before,plain(a));res.json({item:plain(a),message:'Check-out recorded.'});}));
app.post('/api/attendance/corrections', auth, roles('Employee','HR'), asyncHandler(async(req,res)=>{const e=await employeeSelf(req,res);if(!e)return;const b=req.body;if(!/^\d{4}-\d{2}-\d{2}$/.test(b.dateKey||'')||!ATTENDANCE_STATUSES.includes(b.requestedStatus)||String(b.reason||'').trim().length<5)return fail(res,422,'Date, requested status and a reason of at least 5 characters are required.');const existing=await Correction.findOne({employeeId:e._id,dateKey:b.dateKey,status:'Pending'});if(existing)return fail(res,409,'A pending correction already exists for this date.');const settings=await org();const attendance=await Attendance.findOne({employeeId:e._id,dateKey:b.dateKey});const c=await Correction.create({employeeId:e._id,attendanceId:attendance?._id||null,dateKey:b.dateKey,requestedStatus:b.requestedStatus,reason:b.reason,requestedCheckIn:b.requestedCheckIn?dateTimeInZone(b.dateKey,b.requestedCheckIn,settings.timeZone):undefined,requestedCheckOut:b.requestedCheckOut?dateTimeInZone(b.dateKey,b.requestedCheckOut,settings.timeZone):undefined});await audit(req,'CREATE','AttendanceCorrection',c._id,null,plain(c));const hrs=await User.find({role:'HR',active:true});for(const h of hrs)await notifyUser(h._id,'Attendance correction requested',`${e.name} requested a correction for ${b.dateKey}.`,'correction','/attendance');res.status(201).json({item:plain(c),message:'Correction request submitted to HR.'});}));
app.get('/api/attendance/corrections', auth, asyncHandler(async(req,res)=>{const filter=(req.user.role==='Employee'||(req.user.role==='HR'&&req.query.mine==='true'))?{employeeId:req.user.employeeId}:{};if(!['Admin','HR','Employee'].includes(req.user.role))return fail(res,403,'Forbidden.');const items=await Correction.find(filter).populate('employeeId','employeeCode name department').sort({createdAt:-1});res.json({items:items.map(c=>({...plain(c),employee:c.employeeId?plain(c.employeeId):null}))});}));
app.patch('/api/attendance/corrections/:id/review', auth, roles('HR'), asyncHandler(async(req,res)=>{const c=await Correction.findById(req.params.id);if(!c)return fail(res,404,'Correction request not found.');if(c.status!=='Pending')return fail(res,409,'This correction was already reviewed.');if(!['Approved','Rejected'].includes(req.body.status))return fail(res,422,'Choose Approved or Rejected.');const before=plain(c);c.status=req.body.status;c.reviewComment=String(req.body.comment||'');c.reviewedBy=req.user.name;c.reviewedAt=new Date();await c.save();if(c.status==='Approved'){let a=c.attendanceId?await Attendance.findById(c.attendanceId):await Attendance.findOne({employeeId:c.employeeId,dateKey:c.dateKey});if(!a)a=await Attendance.create({employeeId:c.employeeId,dateKey:c.dateKey,status:c.requestedStatus,source:'hr-correction'});a.status=c.requestedStatus;if(c.requestedCheckIn)a.checkIn=c.requestedCheckIn;if(c.requestedCheckOut)a.checkOut=c.requestedCheckOut;a.source='hr-correction';if(a.checkIn&&a.checkOut)a.hoursWorked=Math.max(0,(a.checkOut-a.checkIn)/3600000);await a.save();}await audit(req,'REVIEW','AttendanceCorrection',c._id,before,plain(c));await notifyEmployee(c.employeeId,'Attendance correction '+c.status.toLowerCase(),`Your correction for ${c.dateKey} was ${c.status.toLowerCase()}. ${c.reviewComment}`,'correction','/attendance');res.json({item:plain(c)});}));

app.get('/api/leaves', auth, asyncHandler(async(req,res)=>{const filter=(req.user.role==='Employee'||(req.user.role==='HR'&&req.query.mine==='true'))?{employeeId:req.user.employeeId}:{};if(!['Admin','HR','Employee'].includes(req.user.role))return fail(res,403,'Forbidden.');const items=await Leave.find(filter).populate('employeeId','employeeCode name department').sort({createdAt:-1});res.json({items:items.map(l=>({...plain(l),employee:l.employeeId?plain(l.employeeId):null}))});}));
app.get('/api/leaves/balance', auth, roles('Employee','HR'), asyncHandler(async(req,res)=>{const e=await employeeSelf(req,res);if(!e)return;const year=Number(req.query.year||localDateKey().slice(0,4));const start=`${year}-01-01`,end=`${year}-12-31`;const s=await org();const approved=await Leave.find({employeeId:e._id,status:'Approved',startDate:{$lte:parseKey(end)},endDate:{$gte:parseKey(start)}});const types=(s.leaveTypes||[{name:'Annual',quota:14,paid:true},{name:'Sick',quota:8,paid:true},{name:'Casual',quota:10,paid:true},{name:'Unpaid',quota:0,paid:false}]);const items=types.map(t=>{const type=t.name;const used=approved.filter(l=>l.type===type).reduce((sum,l)=>{const a=keyOfDate(l.startDate)<start?start:keyOfDate(l.startDate);const b=keyOfDate(l.endDate)>end?end:keyOfDate(l.endDate);return sum+(a<=b?daysInclusive(a,b,s):0);},0);const quota=t.paid?Number(t.quota||0):null;return {type,quota,used,remaining:quota===null?null:Math.max(0,quota-used)};});res.json({year,items});}));
app.post('/api/leaves', auth, roles('Employee','HR'), asyncHandler(async(req,res)=>{const e=await employeeSelf(req,res);if(!e)return;const b=req.body;const type=String(b.type||'');const start=String(b.startDate||'');const end=String(b.endDate||'');const s=await org();if(!(s.leaveTypes||[]).some(x=>x.name===type)||!/^\d{4}-\d{2}-\d{2}$/.test(start)||!/^\d{4}-\d{2}-\d{2}$/.test(end)||end<start||String(b.reason||'').trim().length<3)return fail(res,422,'Choose a configured leave type, valid date range and reason.');const days=daysInclusive(start,end,s);if(days<=0)return fail(res,422,'The selected range has no working days. Weekends and public holidays are excluded.');const overlap=await Leave.findOne({employeeId:e._id,status:{$in:['Pending','Approved']},startDate:{$lte:parseKey(end)},endDate:{$gte:parseKey(start)}});if(overlap)return fail(res,422,'These dates overlap another pending or approved request.');const leaveConfig=(s.leaveTypes||[]).find(x=>x.name===type);if(leaveConfig?.paid!==false){const quota=Number(leaveConfig?.quota??0);for(let year=Number(start.slice(0,4));year<=Number(end.slice(0,4));year++){const yearStart=`${year}-01-01`,yearEnd=`${year}-12-31`;const requestStart=start>yearStart?start:yearStart,requestEnd=end<yearEnd?end:yearEnd;const requestedYearDays=requestStart<=requestEnd?daysInclusive(requestStart,requestEnd,s):0;const yearLeaves=await Leave.find({employeeId:e._id,type,status:{$in:['Approved','Pending']},startDate:{$lte:parseKey(yearEnd)},endDate:{$gte:parseKey(yearStart)}});const used=yearLeaves.reduce((sum,l)=>{const a=keyOfDate(l.startDate)<yearStart?yearStart:keyOfDate(l.startDate);const b=keyOfDate(l.endDate)>yearEnd?yearEnd:keyOfDate(l.endDate);return sum+(a<=b?daysInclusive(a,b,s):0);},0);if(used+requestedYearDays>quota)return fail(res,422,`Not enough ${type.toLowerCase()} leave balance for ${year}. Remaining: ${Math.max(0,quota-used)} day(s).`);}}const l=await Leave.create({employeeId:e._id,type,startDate:parseKey(start),endDate:parseKey(end),days,reason:String(b.reason).trim()});await audit(req,'CREATE','LeaveRequest',l._id,null,plain(l));const hrs=await User.find({role:'HR',active:true});for(const h of hrs)await notifyUser(h._id,'New leave request',`${e.name} requested ${days} day(s) of ${type.toLowerCase()} leave.`,'leave','/leave');res.status(201).json({item:plain(l),message:'Leave request submitted. HR will review it.'});}));
app.post('/api/leaves/:id/cancel', auth, roles('Employee','HR'), asyncHandler(async(req,res)=>{const e=await employeeSelf(req,res);if(!e)return;const l=await Leave.findById(req.params.id);if(!l)return fail(res,404,'Leave request not found.');if(String(l.employeeId)!==String(e._id))return fail(res,403,'You can only cancel your own leave request.');if(!['Pending','Approved'].includes(l.status))return fail(res,409,'This leave request can no longer be cancelled.');const before=plain(l);l.status='Cancelled';await l.save();await audit(req,'CANCEL','LeaveRequest',l._id,before,plain(l));res.json({item:plain(l)});}));
app.patch('/api/leaves/:id/review', auth, roles('HR'), asyncHandler(async(req,res)=>{
  const l=await Leave.findById(req.params.id).populate('employeeId','name');
  if(!l)return fail(res,404,'Leave request not found.');
  if(l.status!=='Pending')return fail(res,409,'Only pending leave requests can be reviewed.');
  if(!['Approved','Rejected'].includes(req.body.status))return fail(res,422,'Choose Approved or Rejected.');
  if(req.body.status==='Approved'){
    const s=await org();const typeConfig=(s.leaveTypes||[]).find(t=>t.name===l.type);
    if(typeConfig?.paid!==false){const quota=Number(typeConfig?.quota??0);const start=keyOfDate(l.startDate),end=keyOfDate(l.endDate);
      for(let year=Number(start.slice(0,4));year<=Number(end.slice(0,4));year++){
        const yearStart=`${year}-01-01`,yearEnd=`${year}-12-31`;const reqStart=start>yearStart?start:yearStart,reqEnd=end<yearEnd?end:yearEnd;const requested=reqStart<=reqEnd?daysInclusive(reqStart,reqEnd,s):0;
        const approved=await Leave.find({employeeId:l.employeeId?._id||l.employeeId,_id:{$ne:l._id},type:l.type,status:'Approved',startDate:{$lte:parseKey(yearEnd)},endDate:{$gte:parseKey(yearStart)}});
        const used=approved.reduce((sum,x)=>{const a=keyOfDate(x.startDate)<yearStart?yearStart:keyOfDate(x.startDate),b=keyOfDate(x.endDate)>yearEnd?yearEnd:keyOfDate(x.endDate);return sum+(a<=b?daysInclusive(a,b,s):0);},0);
        if(used+requested>quota)return fail(res,422,`Approval would exceed ${l.type.toLowerCase()} quota for ${year}. Remaining: ${Math.max(0,quota-used)} day(s).`);
      }
    }
  }
  const before=plain(l);l.status=req.body.status;l.reviewerComment=String(req.body.comment||'');l.reviewedBy=req.user.name;l.reviewedAt=new Date();await l.save();
  await audit(req,'REVIEW','LeaveRequest',l._id,before,plain(l));await notifyEmployee(l.employeeId?._id||l.employeeId,`Leave ${l.status.toLowerCase()}`,`${l.type} leave from ${keyOfDate(l.startDate)} to ${keyOfDate(l.endDate)} was ${l.status.toLowerCase()}. ${l.reviewerComment}`,'leave','/leave');res.json({item:plain(l)});
}));

app.get('/api/payroll', auth, asyncHandler(async(req,res)=>{const all=await Payroll.find().sort({month:-1});if(req.user.role==='Employee'){if(!req.user.employeeId)return res.json({items:[]});return res.json({items:all.map(p=>{const x={...plain(p),rows:p.rows.filter(r=>String(r.employeeId)===String(req.user.employeeId))};delete x.totalGross;delete x.totalDeductions;delete x.totalTax;delete x.totalNet;return x;}).filter(p=>p.rows.length)});}if(!['Admin','HR'].includes(req.user.role))return fail(res,403,'Forbidden.');res.json({items:all.map(plain)});}));
app.post('/api/payroll/run', auth, roles('HR'), asyncHandler(async(req,res)=>{
  const month=String(req.body.month||'');if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))return fail(res,422,'Month must use YYYY-MM format.');if(await Payroll.exists({month}))return fail(res,409,'A payroll run already exists for this month.');const s=await org();const [yy,mm]=month.split('-').map(Number);const first=`${month}-01`;const last=keyOfDate(new Date(Date.UTC(yy,mm,0,12)));const monthDays=workingDaysBetween(first,last,s);const monthWorkDays=monthDays.length;const today=localDateKey(new Date(),s.timeZone);const attendanceEnd=last>today?today:last;const records=await Attendance.find({dateKey:{$gte:first,$lte:attendanceEnd}});const leaves=await Leave.find({status:'Approved',startDate:{$lte:parseKey(last)},endDate:{$gte:parseKey(first)}});const employees=await Employee.find({status:{$in:['Active','Probation','Exited']},joinDate:{$lte:parseKey(last)},$or:[{exitDate:null},{exitDate:{$gte:parseKey(first)}}]});const rows=[];
  for(const e of employees){const eStart=keyOfDate(e.joinDate)>first?keyOfDate(e.joinDate):first;const eEnd=e.exitDate&&keyOfDate(e.exitDate)<last?keyOfDate(e.exitDate):last;const employedDays=monthDays.filter(k=>k>=eStart&&k<=eEnd);const payDays=employedDays.length;const basicFull=Number(e.basicSalary);const grossFull=Math.round(basicFull*(1+Number(e.hraRate??0.4)+Number(e.medicalRate??0.1)));const gross=Math.round(grossFull*(monthWorkDays?payDays/monthWorkDays:1));const basic=Math.round(basicFull*(monthWorkDays?payDays/monthWorkDays:1));const hra=Math.round(basic*Number(e.hraRate??0.4));const medical=Math.round(basic*Number(e.medicalRate??0.1));let absentDays=0,unpaidDays=0,halfDays=0,lateCount=0;
    for(const key of employedDays){if(key>attendanceEnd)continue;const a=records.find(x=>String(x.employeeId)===String(e._id)&&x.dateKey===key);const approved=leaves.find(l=>String(l.employeeId)===String(e._id)&&keyOfDate(l.startDate)<=key&&keyOfDate(l.endDate)>=key);if(approved){const config=(s.leaveTypes||[]).find(t=>t.name===approved.type);if(config?.paid===false)unpaidDays++;continue;}if(!a){absentDays++;continue;}if(a.status==='absent')absentDays++;else if(a.status==='half_day')halfDays++;if(a.status==='late')lateCount++;}
    const latePenaltyDays=s.latePenaltyEnabled?Math.floor(lateCount/3)*0.5:0;const perDay=monthWorkDays?grossFull/monthWorkDays:0;const deductions=Math.round((absentDays+unpaidDays+halfDays*0.5+latePenaltyDays)*perDay);const tax=Math.round(taxAnnual(gross*12)/12);const net=Math.max(0,gross-deductions-tax);rows.push({employeeId:e._id,employeeCode:e.employeeCode,employeeName:e.name,department:e.department,designation:e.designation,basic,hra,medical,gross,workedDays:Math.max(0,payDays-absentDays-unpaidDays-halfDays*0.5),workingDays:monthWorkDays,absentDays,unpaidDays,halfDays,lateCount,latePenaltyDays,deductions,tax,net});}
  const run=await Payroll.create({month,rows,totalGross:rows.reduce((a,r)=>a+r.gross,0),totalDeductions:rows.reduce((a,r)=>a+r.deductions,0),totalTax:rows.reduce((a,r)=>a+r.tax,0),totalNet:rows.reduce((a,r)=>a+r.net,0)});await audit(req,'CREATE','PayrollRun',run._id,null,plain(run));res.status(201).json({run:plain(run),message:'Payroll draft calculated from employee salaries, attendance, approved unpaid leave and the illustrative tax slabs. Admin must finalize it.'});
}));
app.post('/api/payroll/:id/finalize', auth, roles('Admin'), asyncHandler(async(req,res)=>{const p=await Payroll.findById(req.params.id);if(!p)return fail(res,404,'Payroll run not found.');if(p.status==='Finalized')return fail(res,409,'This month is already finalized and locked.');const before=plain(p);p.status='Finalized';p.finalizedBy=req.user.name;p.finalizedAt=new Date();await p.save();await audit(req,'FINALIZE','PayrollRun',p._id,before,plain(p));for(const r of p.rows)await notifyEmployee(r.employeeId,'Payslip available',`Your ${p.month} payslip is available to download.`,'payslip','/payroll');res.json({run:plain(p),message:'Payroll finalized and locked.'});}));
app.get('/api/payroll/:id/payslip/:employeeId.pdf', auth, asyncHandler(async(req,res)=>{const p=await Payroll.findById(req.params.id);if(!p)return fail(res,404,'Payroll run not found.');if(p.status!=='Finalized'&&req.user.role==='Employee')return fail(res,403,'Payslips are available after Admin finalizes payroll.');if(req.user.role==='Employee'&&String(req.user.employeeId)!==String(req.params.employeeId))return fail(res,403,'You can only download your own payslip.');if(!['Admin','HR','Employee'].includes(req.user.role))return fail(res,403,'Forbidden.');const row=p.rows.find(r=>String(r.employeeId)===String(req.params.employeeId));if(!row)return fail(res,404,'Payslip not found.');const s=await org();res.setHeader('Content-Type','application/pdf');res.setHeader('Content-Disposition',`attachment; filename="payslip-${p.month}-${row.employeeCode}.pdf"`);const doc=new PDFDocument({size:'A4',margin:48});doc.pipe(res);doc.fontSize(23).fillColor('#183b56').text(s.companyName,{align:'center'});doc.moveDown(0.3);doc.fontSize(18).fillColor('#111827').text('Salary Payslip',{align:'center'});doc.fontSize(12).fillColor('#4b5563').text(`Pay period: ${p.month}`,{align:'center'});doc.moveDown();doc.fillColor('#111827').fontSize(11).text(`Employee: ${row.employeeName}`).text(`Employee code: ${row.employeeCode}`).text(`Department: ${row.department}`).text(`Designation: ${row.designation}`).text(`Payroll status: ${p.status}`);doc.moveDown();doc.fontSize(13).text('Earnings and deductions');doc.moveDown(0.3);const items=[['Basic salary',row.basic],['House rent allowance',row.hra],['Medical allowance',row.medical],['Gross earnings',row.gross],['Absence / unpaid / half-day deductions',row.deductions],['Illustrative income tax',row.tax],['NET PAY',row.net]];for(const [label,value] of items){doc.fontSize(11).fillColor(label==='NET PAY'?'#0f766e':'#111827').text(label,54,doc.y,{continued:true,width:330}).text(`PKR ${Number(value||0).toLocaleString('en-PK')}`,{align:'right'});doc.moveDown(0.45);}doc.moveDown();doc.fontSize(8).fillColor('#6b7280').text('Hackathon payroll calculation. Tax slabs are illustrative and not tax advice. Keep this document confidential.');doc.end();}));

app.get('/api/announcements', auth, asyncHandler(async(req,res)=>{const items=await Announcement.find({active:true}).sort({createdAt:-1});res.json({items:items.map(plain)});}));
app.post('/api/announcements', auth, roles('Admin','HR'), asyncHandler(async(req,res)=>{const title=String(req.body.title||'').trim(),body=String(req.body.body||'').trim();if(!title||!body)return fail(res,422,'Title and message are required.');const a=await Announcement.create({title,body,author:req.user.name});await audit(req,'CREATE','Announcement',a._id,null,plain(a));const users=await User.find({active:true,_id:{$ne:req.user.id}}).select('_id');await Notification.insertMany(users.map(u=>({userId:u._id,title:`Announcement: ${title}`,body:body.slice(0,220),type:'announcement',link:'/announcements'})));res.status(201).json({item:plain(a)});}));
app.get('/api/notifications', auth, asyncHandler(async(req,res)=>{const items=await Notification.find({userId:req.user.id}).sort({createdAt:-1}).limit(100);res.json({items:items.map(plain),unread:items.filter(x=>!x.readAt).length});}));
app.patch('/api/notifications/:id/read', auth, asyncHandler(async(req,res)=>{const n=await Notification.findOne({_id:req.params.id,userId:req.user.id});if(!n)return fail(res,404,'Notification not found.');n.readAt=new Date();await n.save();res.json({item:plain(n)});}));
app.post('/api/notifications/read-all', auth, asyncHandler(async(req,res)=>{await Notification.updateMany({userId:req.user.id,readAt:null},{$set:{readAt:new Date()}});res.json({ok:true});}));
app.get('/api/audit', auth, roles('Admin'), asyncHandler(async(req,res)=>{const filter={};if(req.query.entity)filter.entity=String(req.query.entity);const items=await Audit.find(filter).sort({createdAt:-1}).limit(Math.min(500,Number(req.query.limit||200)));res.json({items:items.map(plain)});}));

app.get('/api/dashboard', auth, asyncHandler(async (req, res) => {
  const settings = await org();
  const today = localDateKey(new Date(), settings.timeZone || 'Asia/Karachi');
  const from = String(req.query.from || `${today.slice(0, 7)}-01`);
  const to = String(req.query.to || today);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) {
    return fail(res, 422, 'Choose a valid date range (YYYY-MM-DD) where From is not after To.');
  }
  const department = req.user.role === 'Employee' ? '' : String(req.query.department || '');
  const employeeFilter = { status: req.user.role === 'Employee' ? { $in: ['Active', 'Probation', 'Exited'] } : { $in: ['Active', 'Probation'] } };
  if (department) employeeFilter.department = department;
  if (req.user.role === 'Employee') employeeFilter._id = req.user.employeeId || null;
  const employees = await Employee.find(employeeFilter).sort({ employeeCode: 1 });
  const employeeIds = employees.map(e => e._id);
  const idStrings = new Set(employeeIds.map(String));
  const [attendance, leave, payrollRuns, pendingCorrections, activeUsers] = await Promise.all([
    Attendance.find({ employeeId: { $in: employeeIds }, dateKey: { $gte: from, $lte: to } }),
    Leave.find({ employeeId: { $in: employeeIds }, startDate: { $lte: parseKey(to) }, endDate: { $gte: parseKey(from) } }),
    Payroll.find({ month: { $gte: from.slice(0, 7), $lte: to.slice(0, 7) } }).sort({ month: -1 }),
    Correction.countDocuments({ employeeId: { $in: employeeIds }, status: 'Pending' }),
    req.user.role === 'Admin' ? User.countDocuments({ active: true }) : Promise.resolve(0)
  ]);
  const approved = leave.filter(l => l.status === 'Approved');
  const pending = leave.filter(l => l.status === 'Pending');
  const attendanceByDay = new Map(attendance.map(a => [`${String(a.employeeId)}:${a.dateKey}`, a]));
  const approvedByDay = new Map();
  for (const l of approved) {
    const startDay = keyOfDate(l.startDate) < from ? from : keyOfDate(l.startDate);
    const endDay = keyOfDate(l.endDate) > to ? to : keyOfDate(l.endDate);
    for (const key of workingDaysBetween(startDay, endDay, settings)) {
      const k = `${String(l.employeeId)}:${key}`;
      approvedByDay.set(k, l);
    }
  }
  const workKeys = workingDaysBetween(from, to, settings);
  let expectedWorkdayRecords = 0;
  let approvedLeaveWorkdays = 0;
  let attendanceCredits = 0;
  let absentDays = 0;
  let lateDays = 0;
  let presentDays = 0;
  let halfDays = 0;
  const perEmployee = new Map();
  for (const e of employees) perEmployee.set(String(e._id), { absent: 0, late: 0, present: 0, halfDay: 0 });
  for (const e of employees) {
    const empId = String(e._id);
    const joinKey = keyOfDate(e.joinDate);
    const exitKey = e.exitDate ? keyOfDate(e.exitDate) : '9999-12-31';
    for (const key of workKeys) {
      if (key < joinKey || key > exitKey) continue;
      const keyId = `${empId}:${key}`;
      const leaveForDay = approvedByDay.get(keyId);
      const record = attendanceByDay.get(keyId);
      expectedWorkdayRecords++;
      if (leaveForDay || record?.status === 'on_leave') {
        approvedLeaveWorkdays++;
        continue;
      }
      const stats = perEmployee.get(empId);
      if (!record || record.status === 'absent') {
        absentDays++; stats.absent++;
      } else if (record.status === 'late') {
        lateDays++; attendanceCredits++; stats.late++;
      } else if (record.status === 'half_day') {
        halfDays++; attendanceCredits += 0.5; stats.halfDay++;
      } else if (record.status === 'present' || record.status === 'missing_checkout') {
        presentDays++; attendanceCredits++; stats.present++;
      }
    }
  }
  const denominator = Math.max(0, expectedWorkdayRecords - approvedLeaveWorkdays);
  const attendanceRate = denominator ? Math.round(attendanceCredits / denominator * 100) : 0;
  const latePercent = presentDays + lateDays ? Math.round(lateDays / (presentDays + lateDays) * 100) : 0;
  const absenteeism = denominator ? Math.round(absentDays / denominator * 100) : 0;
  const headcount = employees.length;
  const todayRecords = employees.map(e => attendanceByDay.get(`${String(e._id)}:${today}`)).filter(Boolean);
  const presentToday = todayRecords.filter(a => ['present', 'late', 'half_day', 'missing_checkout'].includes(a.status)).length;
  const lateToday = todayRecords.filter(a => a.status === 'late').length;
  const onLeaveIds = new Set(approved.filter(l => keyOfDate(l.startDate) <= today && keyOfDate(l.endDate) >= today && isWorkday(today, settings)).map(l => String(l.employeeId)));
  const onLeave = onLeaveIds.size;
  const yearStart = `${today.slice(0, 4)}-01-01`;
  const attritionFilter = department ? { department } : {};
  const [exitsYtd, startHeadcount, activeToday] = await Promise.all([
    Employee.countDocuments({ ...attritionFilter, status: 'Exited', exitDate: { $gte: parseKey(yearStart), $lte: parseKey(today) } }),
    Employee.countDocuments({ ...attritionFilter, joinDate: { $lt: parseKey(yearStart) }, $or: [{ exitDate: null }, { exitDate: { $gte: parseKey(yearStart) } }] }),
    Employee.countDocuments({ ...attritionFilter, status: { $in: ['Active', 'Probation'] }, joinDate: { $lte: parseKey(today) } })
  ]);
  const averageHeadcount = (startHeadcount + activeToday) / 2;
  const attritionYTD = averageHeadcount ? Math.round(exitsYtd / averageHeadcount * 100) : 0;

  const departments = [...new Set(employees.map(e => e.department).filter(Boolean))].map(name => {
    const people = employees.filter(e => e.department === name);
    const ids = new Set(people.map(e => String(e._id)));
    return { department: name, headcount: people.length,
      payrollCost: people.reduce((sum, e) => sum + Math.round(Number(e.basicSalary || 0) * (1 + Number(e.hraRate ?? 0.4) + Number(e.medicalRate ?? 0.1))), 0),
      late: attendance.filter(a => a.status === 'late' && ids.has(String(a.employeeId))).length };
  });
  const lateCounts = new Map();
  for (const a of attendance.filter(x => x.status === 'late')) lateCounts.set(String(a.employeeId), (lateCounts.get(String(a.employeeId)) || 0) + 1);
  const topLateComers = [...lateCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([employeeId, count]) => {
    const e = employees.find(x => String(x._id) === employeeId);
    return e ? { employeeId, name: e.name, department: e.department, count } : null;
  }).filter(Boolean);
  const trendEnd = to;
  const trendStartCandidate = keyOfDate(parseKey(trendEnd).getTime() - 6 * DAY_MS);
  const trendStart = trendStartCandidate < from ? from : trendStartCandidate;
  const trends = [];
  for (const key of workingDaysBetween(trendStart, trendEnd, settings)) {
    const day = attendance.filter(a => a.dateKey === key);
    const dayLeave = new Set(approved.filter(l => keyOfDate(l.startDate) <= key && keyOfDate(l.endDate) >= key).map(l => String(l.employeeId)));
    trends.push({ date: key,
      present: day.filter(a => ['present', 'missing_checkout'].includes(a.status)).length,
      late: day.filter(a => a.status === 'late').length,
      absent: day.filter(a => a.status === 'absent').length + employees.filter(e => key >= keyOfDate(e.joinDate) && (!e.exitDate || key <= keyOfDate(e.exitDate)) && !dayLeave.has(String(e._id)) && !attendanceByDay.has(`${String(e._id)}:${key}`)).length });
  }
  const leaveTypeCounts = {};
  for (const l of approved) {
    const startDay = keyOfDate(l.startDate) < from ? from : keyOfDate(l.startDate);
    const endDay = keyOfDate(l.endDate) > to ? to : keyOfDate(l.endDate);
    leaveTypeCounts[l.type] = (leaveTypeCounts[l.type] || 0) + daysInclusive(startDay, endDay, settings);
  }
  const paidTypes = (settings.leaveTypes || []).filter(t => t.paid !== false);
  const leaveUsed = paidTypes.reduce((sum, t) => sum + (leaveTypeCounts[t.name] || 0), 0);
  const leaveCapacity = Math.max(0, paidTypes.reduce((sum, t) => sum + Number(t.quota || 0), 0) * headcount);
  const leaveUtilization = leaveCapacity ? Math.round(leaveUsed / leaveCapacity * 100) : 0;
  const payrollRows = payrollRuns.flatMap(run => (run.rows || []).map(row => ({ ...(row.toObject ? row.toObject() : row), month: run.month, status: run.status })));
  const relevantPayrollRows = req.user.role === 'Employee'
    ? payrollRows.filter(row => String(row.employeeId) === String(req.user.employeeId))
    : department ? payrollRows.filter(row => row.department === department) : payrollRows;
  const payrollCost = relevantPayrollRows.reduce((sum, row) => sum + Number(row.gross || 0), 0);
  const netPayrollCost = relevantPayrollRows.reduce((sum, row) => sum + Number(row.net || 0), 0);
  const averageGrossSalary = headcount ? Math.round(employees.reduce((sum, e) => sum + Number(e.basicSalary || 0) * (1 + Number(e.hraRate ?? 0.4) + Number(e.medicalRate ?? 0.1)), 0) / headcount) : 0;
  const absenceAnomalies = employees.map(e => {
    const stats = perEmployee.get(String(e._id)) || { absent: 0, late: 0 };
    const riskScore = Math.min(100, stats.absent * 15 + stats.late * 5);
    const flag = stats.absent >= 3 ? 'Repeated absences' : stats.late >= 6 ? 'Frequent late arrivals' : null;
    return { employeeId: String(e._id), name: e.name, department: e.department, absent: stats.absent, late: stats.late, riskScore, flag };
  }).filter(x => x.flag).sort((a, b) => b.riskScore - a.riskScore).slice(0, 10);

  const payload = {
    role: req.user.role, companyName: settings.companyName, filters: { from, to, department }, generatedAt: new Date().toISOString(),
    kpis: { headcount, present: presentToday, onLeave, lateToday, pendingApprovals: pending.length, attendanceRate, latePercent, latePct: latePercent, absenteeism, leaveUtilization, attritionYTD, payrollCost, netPayrollCost, averageGrossSalary, averageSalary: averageGrossSalary, pendingCorrections, activeUsers },
    trends, departments, leaveByType: Object.entries(leaveTypeCounts).map(([type, days]) => ({ type, days })), topLateComers, absenceAnomalies
  };
  if (req.user.role === 'Employee') {
    const employee = employees[0];
    payload.employee = employee ? safeEmployee(employee) : null;
    payload.myAttendance = attendance;
    payload.hoursThisWeek = attendance.filter(a => a.dateKey >= keyOfDate(parseKey(today).getTime() - 6 * DAY_MS)).reduce((sum, a) => sum + Number(a.hoursWorked || 0), 0);
    payload.lateCount = attendance.filter(a => a.status === 'late').length;
    payload.myLeaves = leave;
    payload.myPayslips = payrollRuns.map(run => { const own = { ...plain(run), rows: run.rows.filter(row => String(row.employeeId) === String(req.user.employeeId)) }; delete own.totalGross; delete own.totalDeductions; delete own.totalTax; delete own.totalNet; return own; }).filter(run => run.rows.length);
    delete payload.departments; delete payload.topLateComers; delete payload.absenceAnomalies;
    delete payload.kpis.payrollCost; delete payload.kpis.netPayrollCost; delete payload.kpis.averageGrossSalary; delete payload.kpis.averageSalary;
    delete payload.kpis.activeUsers; delete payload.kpis.pendingApprovals; delete payload.kpis.pendingCorrections; delete payload.kpis.attritionYTD;
  }
  res.json(payload);
}));
app.get('/api/analytics', auth, roles('Admin','HR'), asyncHandler(async(req,res)=>{res.json({message:'Analytics use the same server-calculated dashboard data.',dashboardEndpoint:'/api/dashboard',filters:{from:req.query.from||'',to:req.query.to||'',department:req.query.department||''}});}));

const AI_WINDOW_MS=60*60*1000;const AI_MAX_PER_HOUR=20;const aiRequests=new Map();
function enforceAIRateLimit(req,res){const now=Date.now();const history=(aiRequests.get(req.user.id)||[]).filter(t=>now-t<AI_WINDOW_MS);if(history.length>=AI_MAX_PER_HOUR){fail(res,429,'AI limit reached. Please try again in about an hour.');return false;}history.push(now);aiRequests.set(req.user.id,history);return true;}
function fallbackPolicyAnswer(question, settings = {}) {
  const q=String(question||'').toLowerCase();
  const types=(settings.leaveTypes||[{name:'Annual',quota:14,paid:true},{name:'Sick',quota:8,paid:true},{name:'Casual',quota:10,paid:true},{name:'Unpaid',quota:0,paid:false}]);
  if(/leave|chutti|چھٹی|holidays|quota|balance/.test(q)) return `Policy: ${types.map(t=>`${t.name} ${t.paid===false?'unpaid/unlimited':`quota ${Number(t.quota||0)} working days`}`).join(', ')}. Working-day calculations exclude configured weekends and public holidays. Overlapping dates or insufficient balance are rejected. HR approves or rejects requests with a comment.`;
  if(/late|attendance|hazri|present|absent|half.?day|check.?in|check.?out/.test(q)) return `Policy: office start time is ${settings.officeStart||'09:00'} with ${Number(settings.graceMinutes??15)} minutes grace. After the grace window, check-in is Late. A working day under ${Number(settings.halfDayHours??5)} hours is Half Day. Check-in/out times are stamped by the server. Missing attendance on a past working day counts as Absent unless there is approved leave.`;
  if(/payroll|salary|payslip|tax|tankhwa/.test(q)) return `Policy: gross is calculated from basic salary plus the configured HRA (40% default) and medical allowance (10% default). Absent, unpaid leave and half days affect deductions; ${settings.latePenaltyEnabled===false?'late penalty is disabled':'3 late arrivals = a 0.5-day penalty when enabled'}. Tax bands in this hackathon are illustrative only. HR creates the draft and Admin finalizes and locks it.`;
  if(/password|login|role|admin|hr|employee/.test(q))return 'Policy: accounts use bcrypt-hashed passwords and JWT sessions. Temporary passwords must be changed on first sign-in. Server-side role checks protect every API and Employees may only access their own data.';
  return 'I can answer questions about attendance, leave, payroll, passwords and company policy. Connect an OpenAI-compatible hosted LLM by setting AI_API_KEY and AI_MODEL in backend/.env for flexible natural-language answers. I will not guess details outside the configured policy or accessible records.';
}
async function scopedTools(req, toolName, args = {}) {
  const s=await org();const today=localDateKey(new Date(),s.timeZone);const employeeScope=req.user.role==='Employee'?{employeeId:req.user.employeeId||null}:{};const dept=String(args.department||'');let empFilter={...employeeScope};if(dept&&req.user.role!=='Employee')empFilter.department=dept;
  if(toolName==='get_headcount'){if(req.user.role==='Employee')return {active:1};return {active:await Employee.countDocuments({...empFilter,status:{$in:['Active','Probation']}}),department:dept||'all'};}
  if(toolName==='get_attendance_summary'){
    const from=args.from||`${today.slice(0,7)}-01`,to=args.to||today;
    const people=await Employee.find(req.user.role==='Employee'?empFilter:{...empFilter,status:{$in:['Active','Probation']}});
    const ids=people.map(e=>e._id);
    const rows=await Attendance.find({employeeId:{$in:ids},dateKey:{$gte:from,$lte:to}});
    const leaveRows=await Leave.find({employeeId:{$in:ids},status:'Approved',startDate:{$lte:parseKey(to)},endDate:{$gte:parseKey(from)}});
    const byDay=new Map(rows.map(x=>[`${String(x.employeeId)}:${x.dateKey}`,x]));
    const workKeys=workingDaysBetween(from,to,s);let expected=0,leaveDays=0,credits=0,absentDays=0;
    for(const e of people){const joined=keyOfDate(e.joinDate),exited=e.exitDate?keyOfDate(e.exitDate):'9999-12-31';for(const key of workKeys){if(key<joined||key>exited)continue;expected++;const onLeave=leaveRows.some(l=>String(l.employeeId)===String(e._id)&&keyOfDate(l.startDate)<=key&&keyOfDate(l.endDate)>=key);const row=byDay.get(`${String(e._id)}:${key}`);if(onLeave||row?.status==='on_leave'){leaveDays++;continue;}if(!row||row.status==='absent'){absentDays++;continue;}if(['present','late','missing_checkout'].includes(row.status))credits++;else if(row.status==='half_day')credits+=0.5;}}
    const denominator=Math.max(0,expected-leaveDays);const summary={period:{from,to},records:rows.length,expectedWorkdayRecords:expected,approvedLeaveWorkdays:leaveDays,absentDays,attendanceRate:denominator?Math.round(credits/denominator*100):0,absenteeism:denominator?Math.round(absentDays/denominator*100):0};
    for(const st of ATTENDANCE_STATUSES)summary[st]=rows.filter(x=>x.status===st).length;
    return summary;
  }
  if(toolName==='get_late_comers'){const from=args.from||`${today.slice(0,7)}-01`,to=args.to||today;const ids=req.user.role==='Employee'?[req.user.employeeId]:(await Employee.find({...empFilter,status:{$in:['Active','Probation']}}).select('_id')).map(e=>e._id);const rows=await Attendance.find({employeeId:{$in:ids},dateKey:{$gte:from,$lte:to},status:'late'}).populate('employeeId','name department');const map=new Map();for(const x of rows){const k=String(x.employeeId?._id);const old=map.get(k)||{name:x.employeeId?.name,department:x.employeeId?.department,count:0};old.count++;map.set(k,old);}return [...map.values()].sort((a,b)=>b.count-a.count).slice(0,10);}
  if(toolName==='get_leave_summary'){const from=args.from||`${today.slice(0,7)}-01`,to=args.to||today;const ids=req.user.role==='Employee'?[req.user.employeeId]:(await Employee.find({...empFilter,status:{$in:['Active','Probation']}}).select('_id')).map(e=>e._id);const rows=await Leave.find({employeeId:{$in:ids},startDate:{$lte:parseKey(to)},endDate:{$gte:parseKey(from)}});return {period:{from,to},total:rows.length,pending:rows.filter(x=>x.status==='Pending').length,approved:rows.filter(x=>x.status==='Approved').length,rejected:rows.filter(x=>x.status==='Rejected').length,daysApproved:rows.filter(x=>x.status==='Approved').reduce((sum,x)=>sum+x.days,0)};}
  if(toolName==='get_my_leave_balance'){if(!req.user.employeeId)return {message:'This login is not linked to an employee profile.'};const e=await Employee.findById(req.user.employeeId);if(!e)return {message:'Employee profile not found.'};const year=Number(args.year||today.slice(0,4));const yearStart=`${year}-01-01`,yearEnd=`${year}-12-31`;const rows=await Leave.find({employeeId:e._id,status:'Approved',startDate:{$lte:parseKey(yearEnd)},endDate:{$gte:parseKey(yearStart)}});return (s.leaveTypes||[]).map(t=>{const type=t.name;const quota=t.paid?Number(t.quota||0):null;const used=rows.filter(x=>x.type===type).reduce((n,x)=>{const start=keyOfDate(x.startDate)<yearStart?yearStart:keyOfDate(x.startDate);const end=keyOfDate(x.endDate)>yearEnd?yearEnd:keyOfDate(x.endDate);return n+(start<=end?daysInclusive(start,end,s):0);},0);return {type,quota,used,remaining:quota===null?null:Math.max(0,quota-used)};});}
  if(toolName==='get_payroll_summary'){if(req.user.role==='Employee')return {message:'Employees can only access their own finalized payslips through the payslip page.'};const month=args.month||today.slice(0,7);const p=await Payroll.findOne({month});return p?{month:p.month,status:p.status,totalGross:p.totalGross,totalDeductions:p.totalDeductions,totalTax:p.totalTax,totalNet:p.totalNet,employees:p.rows.length}: {month,status:'No payroll run created yet'};}
  if(toolName==='search_employees'){if(req.user.role==='Employee')return {message:'Employees cannot search colleagues or view other people’s details.'};const q=String(args.query||'').slice(0,80);const re=new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'i');const rows=await Employee.find({...empFilter,$or:[{name:re},{employeeCode:re},{department:re}]}).limit(10);return rows.map(e=>({employeeCode:e.employeeCode,name:e.name,department:e.department,designation:e.designation,status:e.status}));}
  return {error:'Unknown tool'};
}
const aiTools=[{type:'function',function:{name:'get_headcount',description:'Get active/probation employee count, optionally by department. Employee role sees own profile only.',parameters:{type:'object',properties:{department:{type:'string'}},additionalProperties:false}}},{type:'function',function:{name:'get_attendance_summary',description:'Summarize attendance status counts from stored attendance rows for a date range.',parameters:{type:'object',properties:{from:{type:'string'},to:{type:'string'},department:{type:'string'}},additionalProperties:false}}},{type:'function',function:{name:'get_late_comers',description:'Find most frequent late arrivals in a date range.',parameters:{type:'object',properties:{from:{type:'string'},to:{type:'string'},department:{type:'string'}},additionalProperties:false}}},{type:'function',function:{name:'get_leave_summary',description:'Summarize leave requests and approved days in a period.',parameters:{type:'object',properties:{from:{type:'string'},to:{type:'string'},department:{type:'string'}},additionalProperties:false}}},{type:'function',function:{name:'get_my_leave_balance',description:'Get current user leave balance only.',parameters:{type:'object',properties:{year:{type:'integer'}},additionalProperties:false}}},{type:'function',function:{name:'get_payroll_summary',description:'Summarize finalized or draft payroll; do not share other salaries with employees.',parameters:{type:'object',properties:{month:{type:'string'}},additionalProperties:false}}},{type:'function',function:{name:'search_employees',description:'Search employees by name/code/department without exposing salary fields.',parameters:{type:'object',properties:{query:{type:'string'},department:{type:'string'}},additionalProperties:false}}}];
async function hostedAI(messages, tools = []) { if(!process.env.AI_API_KEY||!process.env.AI_MODEL)return null;const base=(process.env.AI_BASE_URL||'https://api.openai.com/v1').replace(/\/$/,'');const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),15000);try{const resp=await fetch(`${base}/chat/completions`,{method:'POST',headers:{Authorization:`Bearer ${process.env.AI_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({model:process.env.AI_MODEL,messages,tools:tools.length?tools:undefined,tool_choice:tools.length?'auto':undefined,temperature:0.2}),signal:controller.signal});if(!resp.ok)throw new Error(`AI provider returned ${resp.status}`);return await resp.json();}finally{clearTimeout(timeout);}}
app.post('/api/ai/chat', auth, asyncHandler(async(req,res)=>{const q=String(req.body.message||'').trim();if(!q)return fail(res,422,'Type a question first.');if(!enforceAIRateLimit(req,res))return;const started=Date.now();const system=`You are HCM Lite's AI HR assistant. Use ONLY the supplied policy and tools; database is the only source of truth. Never invent or reveal another employee's salary or records. Employees only get their own scope. Do not modify or save records. Answer in the user's language (English or Roman Urdu). Label your answer AI-generated. Policy: default start 09:00, grace 15 minutes, half-day under 5 hours; Annual quota 14, Sick 8, Casual 10, Unpaid unlimited; weekends/public holidays excluded from leave workday counts; overlap and overbalance rejected; payroll gross = basic + HRA 40% + medical 10%; 3 late arrivals = half-day penalty when enabled; absence/unpaid/half-day deductions; tax slabs are illustrative; HR creates drafts and Admin finalizes/locks. Current scope: role=${req.user.role}, company=${(await org()).companyName}.`;
  let answer;const toolsUsed=[];try{const result=await hostedAI([{role:'system',content:system},{role:'user',content:q}],aiTools);if(result?.choices?.[0]?.message){let messages=[{role:'system',content:system},{role:'user',content:q},result.choices[0].message];let msg=result.choices[0].message;let rounds=0;while(msg.tool_calls?.length&&rounds<3){rounds++;for(const call of msg.tool_calls){let args={};try{args=JSON.parse(call.function.arguments||'{}')}catch{}const output=await scopedTools(req,call.function.name,args);toolsUsed.push(call.function.name);messages.push({role:'tool',tool_call_id:call.id,content:JSON.stringify(output).slice(0,6000)});}const next=await hostedAI(messages,aiTools);msg=next?.choices?.[0]?.message;if(!msg)break;messages.push(msg);}answer=msg?.content||'I could not create a response from the provider. Please try again.';}
  }catch(e){console.error('AI request fallback:',e.message);}if(!answer){answer=await localDataAnswer(req,q)||fallbackPolicyAnswer(q,await org());}await AILog.create({userId:req.user.id,role:req.user.role,question:q,toolsUsed,outcome:answer?'success':'fallback',durationMs:Date.now()-started});res.json({answer,aiGenerated:true,providerConfigured:!!(process.env.AI_API_KEY&&process.env.AI_MODEL),toolsUsed,source:toolsUsed.length?'Live company data tools':'Policy/data fallback'});
}));
async function localDataAnswer(req,q){const text=String(q).toLowerCase();const today=localDateKey(new Date(),(await org()).timeZone);if(/how many|kitne|kitni|headcount|active employees|staff/.test(text)){if(req.user.role==='Employee')return 'Aap apni profile aur personal attendance dekh sakte hain. Doosre employees ki directory aapke role ke liye available nahi hai.';const filter={status:{$in:['Active','Probation']}};const match=text.match(/department\s+([a-z &-]+)/i);if(match)filter.department=new RegExp(match[1].trim(),'i');const n=await Employee.countDocuments(filter);return `Current database ke mutabiq ${n} active/probation employee(s) hain${match?` in ${match[1].trim()}`:''}.`;}if(/who.*late|late comers|kaun late|kon late/.test(text)){const from=`${today.slice(0,7)}-01`;const tool=await scopedTools(req,'get_late_comers',{from,to:today});return `Is month (${from} se ${today}) ke late arrivals: ${JSON.stringify(tool)}.`;}if(/leave today|on leave today|chutti par|leave pe/.test(text)){const rows=await Leave.find({status:'Approved',startDate:{$lte:parseKey(today)},endDate:{$gte:parseKey(today)}}).populate('employeeId','name');const visible=req.user.role==='Employee'?rows.filter(x=>String(x.employeeId?._id)===String(req.user.employeeId)):rows;return `Aaj approved leave par ${visible.length} employee(s) hain. ${visible.map(x=>x.employeeId?.name).filter(Boolean).join(', ')||'Koi naam available nahi.'}`;}if(/attendance rate|hazri rate/.test(text)){const summary=await scopedTools(req,'get_attendance_summary',{from:`${today.slice(0,7)}-01`,to:today});return `Current data ke mutabiq is month attendance rate ${summary.attendanceRate||0}% aur absenteeism ${summary.absenteeism||0}% hai, dashboard ke same working-day formula ke mutabiq.`;}if(/my sick leave|sick leave.*left|kitni sick|leave balance/.test(text)&&req.user.employeeId){const data=await scopedTools(req,'get_my_leave_balance',{});return `Aapka current leave balance: ${JSON.stringify(data)}.`;}if(/salary of|salary.*colleague|colleague.*salary|dusre.*salary|iski salary/.test(text)&&req.user.role==='Employee')return 'Maazrat, privacy policy ke mutabiq aap doosre employee ki salary ya payslip nahi dekh sakte. Aap sirf apni payslip dekh sakte hain.';return null;}
app.post('/api/ai/smart-leave', auth, roles('Employee','HR'), asyncHandler(async(req,res)=>{
  const sentence=String(req.body.text||'').trim(); if(!sentence)return fail(res,422,'Describe your leave request in plain language.');if(!enforceAIRateLimit(req,res))return;const started=Date.now();
  const s=await org(); const today=localDateKey(new Date(),s.timeZone); let draft=null;
  try {
    const result=await hostedAI([
      {role:'system',content:'Extract a leave request into JSON only: {"type":"Annual|Sick|Casual|Unpaid","startDate":"YYYY-MM-DD","endDate":"YYYY-MM-DD","reason":"short reason"}. Convert relative days using today '+today+'. Never save it.'},
      {role:'user',content:sentence}
    ],[]);
    const content=result?.choices?.[0]?.message?.content||''; const match=content.match(/\{[\s\S]*\}/);
    if(match){const x=JSON.parse(match[0]);if((s.leaveTypes||[]).some(t=>t.name===x.type)&&/^\d{4}-\d{2}-\d{2}$/.test(x.startDate)&&/^\d{4}-\d{2}-\d{2}$/.test(x.endDate)&&x.endDate>=x.startDate&&String(x.reason||'').length>=3)draft={type:x.type,startDate:x.startDate,endDate:x.endDate,reason:x.reason};}
  }catch(e){console.error('Smart leave provider fallback:',e.message);}
  if(!draft){const q=sentence.toLowerCase();let type=/sick|ill|fever|tabiyat|bimar/.test(q)?'Sick':/annual/.test(q)?'Annual':/unpaid/.test(q)?'Unpaid':'Casual';const dates=[...sentence.matchAll(/\b(20\d{2}-\d{2}-\d{2})\b/g)].map(x=>x[1]);let start=dates[0],end=dates[1]||dates[0];if(!start){const wd=q.match(/next (monday|tuesday|wednesday|thursday|friday)|aglay (monday|tuesday|wednesday|thursday|friday)/);if(wd){const map={monday:1,tuesday:2,wednesday:3,thursday:4,friday:5};const target=map[wd[1]||wd[2]];const base=parseKey(today);let add=(target-base.getUTCDay()+7)%7;if(add===0)add=7;start=keyOfDate(base.getTime()+add*DAY_MS);end=q.includes('and tuesday')||q.includes('and wednesday')||q.includes('and thursday')||q.includes('and friday')?keyOfDate(parseKey(start).getTime()+DAY_MS):start;}}if(!start){const n=sentence.match(/\b(\d{1,2})\s+days?\b/i);const count=n?Math.max(1,Math.min(30,Number(n[1]))):1;start=keyOfDate(parseKey(today).getTime()+DAY_MS);end=keyOfDate(parseKey(start).getTime()+(count-1)*DAY_MS);}draft={type,startDate:start,endDate:end,reason:sentence};}
  draft.workingDays=daysInclusive(draft.startDate,draft.endDate,s);if(draft.endDate<draft.startDate||draft.workingDays<1)return fail(res,422,'Could not create a valid working-day date range. Please fill the form manually.');
  await AILog.create({userId:req.user.id,role:req.user.role,question:`Smart leave: ${sentence}`,toolsUsed:[],outcome:draft?'draft':'fallback',durationMs:Date.now()-started});res.json({draft,aiGenerated:true,needsConfirmation:true,providerConfigured:!!(process.env.AI_API_KEY&&process.env.AI_MODEL)});
}));
app.post('/api/ai/summary', auth, roles('Admin','HR'), asyncHandler(async(req,res)=>{
  if(!enforceAIRateLimit(req,res))return;const started=Date.now();const k=req.body.kpis||{};const data={headcount:Number(k.headcount||0),present:Number(k.present||0),onLeave:Number(k.onLeave||0),lateToday:Number(k.lateToday||0),pendingApprovals:Number(k.pendingApprovals||0),attendanceRate:Number(k.attendanceRate||0),absenteeism:Number(k.absenteeism||0),payrollCost:Number(k.payrollCost||0),topLateComers:Array.isArray(req.body.topLateComers)?req.body.topLateComers.slice(0,5):[]};let summary=null;
  try{const result=await hostedAI([{role:'system',content:'Write 3 to 5 concise HR dashboard insight bullets using ONLY the JSON data provided. Do not infer causes or invent numbers. Mention when values are zero or unavailable.'},{role:'user',content:JSON.stringify(data)}],[]);summary=result?.choices?.[0]?.message?.content||null;}catch(e){console.error('Summary provider fallback:',e.message);}
  if(!summary){const arr=[`Active/probation headcount: ${data.headcount}.`,`Today: ${data.present} present, ${data.lateToday} late, ${data.onLeave} on leave.`,`Attendance rate in selected period: ${data.attendanceRate}%; absenteeism: ${data.absenteeism}%.`,`Pending leave approvals: ${data.pendingApprovals}.`];if(data.payrollCost)arr.push(`Payroll gross total in selected months: PKR ${data.payrollCost.toLocaleString('en-PK')}.`);summary=arr.join('\n');}
  await AILog.create({userId:req.user.id,role:req.user.role,question:'Dashboard summary',toolsUsed:[],outcome:'summary',durationMs:Date.now()-started});res.json({summary,aiGenerated:true,source:'Selected dashboard KPI JSON'});
}));

app.use((req,res)=>fail(res,404,`Route not found: ${req.method} ${req.path}`));
app.use((err,req,res,next)=>{console.error(err);if(err?.code===11000)return fail(res,409,'A record with this code or email already exists.');if(err?.name==='ValidationError')return fail(res,422,'Some fields are invalid.',Object.values(err.errors||{}).map(x=>x.message));if(err?.name==='CastError')return fail(res,422,'Invalid record ID or field value.');res.status(500).json({message:'Unexpected server error.',detail:process.env.NODE_ENV==='development'?err.message:undefined});});

async function start(){if(!JWT_SECRET&&process.env.NODE_ENV==='production')throw new Error('JWT_SECRET must be set in production.');await mongoose.connect(process.env.MONGODB_URI||'mongodb://127.0.0.1:27017/hcm_lite');
  if(process.env.ADMIN_EMAIL&&process.env.ADMIN_PASSWORD&&!(await User.exists({role:'Admin'}))){const settings=await Organization.findOne();if(!settings)await Organization.create({companyName:process.env.COMPANY_NAME||'My Company'});const user=await User.create({name:process.env.ADMIN_NAME||'System Admin',email:process.env.ADMIN_EMAIL.toLowerCase(),passwordHash:await bcrypt.hash(process.env.ADMIN_PASSWORD,12),role:'Admin'});console.log(`Admin bootstrap account created: ${user.email}`);}
  app.listen(PORT,()=>console.log(`HCM Lite API listening at http://localhost:${PORT}`));
}
start().catch(err=>{console.error('HCM Lite backend failed to start:',err.message);process.exit(1);});
