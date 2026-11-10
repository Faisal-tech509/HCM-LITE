# HCM Lite role-permission summary

| Function | Admin | HR | Employee |
|---|---|---|---|
| First-run setup | Manage | — | — |
| Login/logout/change own password | Own | Own | Own |
| Company attendance rules/geofence | Manage | View | — |
| Departments/designations/leave types/holidays | Manage | View | — |
| Create/deactivate/reset login | Manage | — | — |
| Employee create/edit | View | Manage | Own phone/address |
| Directory and Employee 360 | All | All | Own |
| CSV import/export | — | Manage | — |
| Web check-in/out | — | Own (if linked to employee) | Own |
| Attendance calendar/board | All | All | Own |
| Attendance correction | View | Approve/reject | Request |
| Leave apply/cancel/balance | — | Own (if linked) | Own |
| Leave approval/comment | View | Approve/reject | — |
| Salary structure | View | Manage | — |
| Create/review payroll draft | View | Manage | — |
| Finalize/lock payroll | Manage | — | — |
| Payslip PDF | All | All | Own |
| Dashboard/analytics | Company | HR data | Personal data |
| AI chat | Company scope | HR scope | Own scope |
| AI dashboard summary | Yes | Yes | — |
| Smart leave | — | Own (if linked) | Own |
| Policy Q&A | Yes | Yes | Yes |
| Announcements | Post | Post | Read |
| Notifications | Own | Own | Own |
| Audit log | View | — | — |
| Delete employee or attendance record (application addition) | **Admin only** | — | — |

Server-side guards enforce these permissions; hiding a control in the frontend is not the security boundary.
