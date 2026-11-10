# HCM Lite — Saylani Hackathon Challenge

AI-assisted Human Capital Management for **Admin, HR and Employees**, based on the 24 October 2026 challenge brief. The web app starts with a blank company database: do the first-run setup, add company rules and organization lists, then register users and enter activity. There are no pre-loaded employee, attendance, leave or payroll demo records.

## Quick start (Windows + VS Code)

### 1. Install prerequisites

- Node.js LTS (includes npm).
- MongoDB Community Server running on the PC, **or** a MongoDB Atlas connection string.

### 2. Configure the backend

1. Extract the ZIP and open the **top-level** `HCM_Lite_Hackathon` folder in VS Code.
2. Copy `backend/.env.example` to a new file named `backend/.env`.
3. Keep local MongoDB as `mongodb://127.0.0.1:27017/hcm_lite`, or replace `MONGODB_URI` with your Atlas connection string.
4. Replace `JWT_SECRET` with a long random secret. Do not share the `.env` file or put AI keys in frontend files.
5. Optional: add `AI_API_KEY`, `AI_MODEL`, and (if needed) `AI_BASE_URL` for a hosted OpenAI-compatible LLM. See **AI setup** below.

### 3. Install and run both apps

Open the VS Code terminal at the **top-level project folder**, not inside `frontend` or `backend`:

```bash
npm install
npm run dev
```

The terminal starts both the API and web UI. Open **http://localhost:5173**. The API is **http://localhost:5000**. If PowerShell blocks `npm.ps1`, choose **Command Prompt (CMD)** from the VS Code terminal dropdown and run the same commands.

### 4. First login / demo journey

1. On a fresh database, complete **Set up your company** and create the Admin credentials.
2. Admin opens **Organization setup** and adds departments, designations, leave types, holidays, time zone, office hours and (for camera check-in) office coordinates/radius.
3. Admin uses **User accounts → Create HR login**. Copy the temporary password and give it to HR securely.
4. HR signs in and must change the temporary password. HR uses **Employees → Register employee**; each employee automatically gets a login and a temporary password shown once.
5. Employee changes the temporary password on first sign-in, then uses **My attendance**, **My leave**, **My payslips**, profile and AI assistant.
6. Employee submits a leave request (or asks Smart Leave to pre-fill it); HR approves/rejects with a comment. HR creates the monthly payroll draft; Admin finalizes it and locks the month. Employee then downloads their own payslip PDF.
7. Admin opens **Audit log**. Try asking the AI assistant a policy or data question; the answer uses server-scoped tools when a hosted AI provider is configured, otherwise it uses a policy/data fallback.

## Architecture

- `frontend/` — React, Vite, responsive dashboards, role-based menus, charts, forms, PWA manifest and optional camera UI.
- `backend/` — Express REST API, Mongoose/MongoDB models, JWT sessions, bcrypt password hashing, role/data-scope guards, payroll engine, PDF generation and AI tool-calling gateway.
- Data is stored in MongoDB. The frontend does not create dummy records. Dashboards and calculations are based on stored company data.

## Challenge checklist — 25 required functions

| # | Required function | What is provided |
|---:|---|---|
| 01 | First-run company/Admin setup | Blank-database setup page; company, Admin, office start/end, grace period; audit event. `ADMIN_EMAIL`/`ADMIN_PASSWORD` bootstrap is also supported. |
| 02 | Login, logout, change password, role menus/dashboards | JWT access token + server-side session; bcrypt password hashes; forced temporary-password change; Admin, HR and Employee menus. |
| 03 | Company settings | Office hours, grace, half-day threshold, weekends, time zone, geofence coordinates/radius and late-penalty flag. HR can view; only Admin can change. |
| 04 | Departments, designations, leave types/quotas, holidays | Admin-managed lists in Organization setup; CSV validation checks departments/designations. |
| 05 | Create/deactivate/reset logins | Admin creates HR login, deactivates/reactivates accounts, or resets any user's password. Sessions are revoked on disable/reset. |
| 06 | Employee registration creates login and edits | HR registers a person and receives the generated temporary password once. Employee self-edit is limited to phone/address. |
| 07 | Directory/search/filters/paging/Employee 360 | Search by identity/job fields; department/status filters and paging; profile, recent attendance, leave, payroll snapshot and account state for authorized roles. |
| 08 | CSV import dry-run/report and export | HR can preview required fields, format, duplicate code/email, department, designation, date and salary errors before commit; CSV export is available to HR. |
| 09 | Web check-in/out | Server timestamps; one attendance row per employee/day; late rules; checkout duration and half-day threshold. |
| 10 | Attendance calendar and daily board | Month calendar and Admin/HR daily board calculate recorded status, approved leave, weekends/holidays and missing past attendance. |
| 11 | Attendance correction request/approval | Employee supplies date, status, times and reason; HR approves/rejects; approved corrections update/create the attendance row. |
| 12 | Leave apply/cancel/balance/history | Own leave requests; configured leave types and quota balance; cancellation; workday calculations skip configured weekends/holidays. |
| 13 | Leave approval/rejection/comment | HR-only decision; comment and in-app notification; request and decision are audited. |
| 14 | Salary structure | HR manages basic salary, HRA rate and medical rate; Admin can view salary. Employee endpoints omit salary fields. |
| 15 | Monthly payroll draft | HR creates one draft per `YYYY-MM` from salary, join/exit dates, attendance, approved unpaid leave and the configured late penalty. |
| 16 | Finalize/lock payroll | Admin-only finalize; finalized run cannot be finalized again/changed through the API. |
| 17 | Payslips/PDF download | PDF is generated from the saved run snapshot; employees can download only their own finalized payslip. |
| 18 | Dashboards/KPIs/trends/filters | Server-computed headcount, attendance rate, late %, absenteeism, leave utilization, payroll, average salary, attrition, trends, frequent late arrivals and absence flags. |
| 19 | AI chat with real-data tools | Backend tools for headcount, attendance, late-comers, leave summary/balance, payroll summary and employee search. Tool data is scoped to the authenticated role. |
| 20 | AI dashboard summary | Admin/HR sends the current dashboard KPI values; response is based only on those values. |
| 21 | Smart Leave | Plain-language request is converted to an editable draft; the user must review and submit. AI never saves the leave itself. |
| 22 | Policy Q&A | Policy fallback is available without an AI key; hosted LLM enables more flexible language and Roman Urdu. |
| 23 | Announcements | Admin/HR posting; company-wide notifications; employees read announcements. |
| 24 | In-app notifications | Per-user list, read-one/read-all, triggered for leave decisions, correction updates, announcements and finalized payslips. |
| 25 | Audit log | Admin-only read view; key create/update/delete/approval/finalize/login and password events include actor/action and before/after snapshots where applicable. |

## Business rules from the brief

- Default: 09:00 office start, 15-minute grace period, half day below 5 hours, Saturday/Sunday weekend, Asia/Karachi time zone. Admin can change settings.
- Default quotas: Annual 14, Sick 8, Casual 10; Unpaid is unlimited. Only configured working days count; date overlaps and insufficient paid balance are rejected.
- Gross salary = basic + HRA (default 40% of basic) + medical allowance (default 10%). Deductions include absence, unpaid leave, half days and—when enabled—0.5 day for every three late arrivals.
- Tax uses the challenge brief’s **illustrative** annualized bands. It is not tax advice and should be replaced with an approved payroll/tax ruleset before real-world use.
- Data scope is enforced in the backend. Employee endpoints return only their own data; employee salary is omitted. Admin-only operations remain server-guarded even if a button is manually exposed.

## AI setup (optional hosted LLM)

In `backend/.env` set the provider key **on the server only**, for example:

```dotenv
AI_BASE_URL=https://api.openai.com/v1
AI_API_KEY=your_provider_key
AI_MODEL=your_tool-calling-model-name
```

The exact model name depends on the provider account and must support chat completions with tool calling. Keep the key out of `frontend/`. Requests have a 15-second provider timeout, per-user hourly rate limit and entries in `ai_logs`. When the key is absent or a provider call fails, the app uses its explicit policy/data fallback. That fallback is not a substitute for a fully capable hosted LLM; configure a suitable model for the full natural-language AI behavior in the brief.

## Optional camera + location attendance (bonus)

- Employee chooses **Camera check-in** and the browser requests camera and location permission.
- MediaPipe face detection checks exactly one face in the current camera frame. The server independently validates GPS accuracy (≤100 m), configured office coordinates/radius and attendance rules using Haversine distance.
- The raw camera image is not uploaded or stored. If the model/WASM cannot be downloaded, the app blocks camera-mode check-in and standard web check-in remains available.
- Camera and geolocation require localhost or a secure HTTPS origin and browser permission. This is face **detection**, not identity matching/liveness verification. The challenge’s extra face-descriptor matching/blink check is not implemented.

## Checks and troubleshooting

- `npm run build` builds the frontend for deployment.
- `GET http://localhost:5000/api/health` reports whether the backend process and database connection are up.
- If the app says it cannot reach the backend, confirm MongoDB is running, `backend/.env` exists and `npm run dev` was launched from the project root.
- If `npm install` fails in PowerShell with “running scripts is disabled”, use the VS Code terminal dropdown → Command Prompt (CMD).
- AI, camera-model download, browser geolocation and PDF generation need the configured dependencies and permissions noted above.

## Security and production note

This is a hackathon/learning project, not a certified production HR/payroll system. Before deploying with real personal or salary data, use HTTPS, strong environment secrets, TLS MongoDB, database backups, stronger audit retention controls, API hardening/rate limiting, secure hosting, reviewed payroll/tax rules and privacy/legal review. The sample JWT secret must be replaced. No real AI key is included.
