# RBT Hub

Employee portal for RBT Automate — equipment checkout, bookings, damage reports, time-off requests, and more.

**Live:** Deployed on Vercel (auto-deploys on push to `main`)
**Repo:** [github.com/RBT-Tools/rbt-tool-tracker](https://github.com/RBT-Tools/rbt-tool-tracker)

---

## Tech Stack

| Layer        | Technology                         |
|--------------|------------------------------------|
| Frontend     | React 18 + TypeScript + Vite       |
| Backend/DB   | Firebase Firestore                 |
| Auth         | Firebase Authentication            |
| File Storage | Firebase Storage (tool photos)     |
| Email Alerts | EmailJS                            |
| QR Codes     | qrcode.react                       |
| Spreadsheets | SheetJS (xlsx) for exports         |
| Hosting      | Vercel                             |
| CI/CD        | GitHub Actions                     |

---

## Project Structure

```
rbt-tool-tracker/
├── dashboard/                  # Web dashboard (this is the main app)
│   ├── src/
│   │   ├── components/         # Reusable UI components
│   │   │   ├── Nav.tsx         # Top navigation bar
│   │   │   └── StatusBadge.tsx # Colored status pills (In Shop, Checked Out, etc.)
│   │   ├── hooks/              # Custom React hooks
│   │   │   ├── useIsAdmin.ts   # Returns true if user is admin or owner
│   │   │   ├── useRole.ts      # Returns user role + permission helpers
│   │   │   ├── useCategories.ts    # Fetches equipment categories from Firestore
│   │   │   ├── useRepairContacts.ts # Fetches repair vendor list
│   │   │   └── useRentalRates.ts   # Fetches rental rate settings
│   │   ├── utils/
│   │   │   └── categoryColors.ts   # Color-coded badge styles per category
│   │   ├── pages/              # All page components (see Pages section below)
│   │   ├── App.tsx             # Route definitions
│   │   └── firebase.ts         # Firebase init (auth, db, storage)
│   ├── api/
│   │   └── delete-user.ts      # Vercel serverless function to delete users
│   ├── vercel.json             # SPA rewrite rules
│   └── package.json
├── constants/
│   └── emailjs.ts              # EmailJS service ID, template IDs, keys, admin email
├── .github/workflows/
│   ├── deploy-dashboard.yml        # Auto-deploy to Vercel on push
│   ├── daily-overdue-check.yml     # Mon-Fri 7:30 AM: email overdue tool alerts
│   ├── annual-inspection-check.yml # Weekly Monday: check Aerial Lift inspections
│   └── weekly-damage-report.yml    # Weekly Monday: email damage summary
├── check-overdue.mjs          # Script for daily overdue check workflow
├── annual-inspection-check.mjs # Script for inspection workflow
├── weekly-damage-report.mjs   # Script for damage report workflow
└── README.md                  # You are here
```

---

## Pages & Routes

| Route | Page | Access | Description |
|-------|------|--------|-------------|
| `/login` | Login.tsx | Public | Email/password login with password reset |
| `/` | DashboardPage.tsx | All users | Stats cards + collapsible tables (damaged, overdue, checked out, bookings, in-shop) |
| `/tools` | ToolsPage.tsx | All users | Equipment list with search, status filter, category filter, photo thumbnails |
| `/tools/new` | AddToolPage.tsx | Admin | Add new equipment (auto-generates TL-XXXX IDs) |
| `/tools/:toolId` | ToolDetailPage.tsx | All users | View/edit tool, check out, return, mark damaged, repair status, bookings, history, maintenance, photos |
| `/tools/:toolId/print` | PrintLabelPage.tsx | Public | QR code label for printing |
| `/bookings` | BookingsPage.tsx | All users | All upcoming bookings; users cancel own, admins cancel any |
| `/categories` | CategoriesPage.tsx | Admin | Add/delete equipment categories |
| `/repair-contacts` | RepairContactsPage.tsx | Admin | Manage repair vendor contact list |
| `/users` | UsersPage.tsx | Admin | Create users, assign roles, delete users, danger zone (clear history) |
| `/time-off` | TimeOffPage.tsx | All users | Submit vacation requests, view own request history |
| `/time-off/approvals` | TimeOffApprovalsPage.tsx | Manager+ | Approve/deny pending time-off requests |

---

## Role System

Roles are stored in the Firestore `users` collection under the `role` field.

| Role | Equipment Ops | Cancel Bookings | Manage Users | Manage Categories | Approve Time Off |
|------|:---:|:---:|:---:|:---:|:---:|
| **Owner** | Full | Any | Yes (all actions) | Yes | Yes |
| **Admin** | Full | Any | Yes (except delete owner) | Yes | Yes |
| **Manager** | Standard | Own only | No | No | Yes |
| **User** | Standard | Own only | No | No | No |

- **Owner** = bootstrap account (first user / explicitly promoted). Cannot be deleted.
- **Admin** = day-to-day ops access. Promoted by owner.
- **Manager** = standard user + can approve/deny time-off. Promoted by owner.
- **User** = default role for new accounts.

**Hooks:**
- `useIsAdmin()` returns `true` for owner or admin
- `useRole()` returns the role string (`"owner"`, `"admin"`, `"manager"`, `"user"`)
- `canApproveTimeOff(role)` returns `true` for owner, admin, or manager

---

## Firestore Database Schema

### `tools/{toolId}` - Equipment

| Field | Type | Description |
|-------|------|-------------|
| `toolId` | string | Human-readable ID (e.g. "TL-0001") |
| `name` | string | Equipment name |
| `status` | string | `IN_SHOP`, `CHECKED_OUT`, or `DAMAGED` |
| `category` | string | Category name |
| `model` | string | Model number |
| `serialNumber` | string | Serial number |
| `notes` | string | General notes |
| `photoURL` | string | Firebase Storage URL for tool photo |
| `checkedOutToEmployeeName` | string | Who has it |
| `checkedOutToJobName` | string | Which job |
| `checkedOutToCustomer` | string | Customer name |
| `checkedOutAt` | timestamp | When checked out |
| `dueBackAt` | timestamp | When due back |
| `damagedNote` | string | Damage description |
| `damagedReportedBy` | string | Who reported damage |
| `damagedReportedAt` | timestamp | When damage reported |
| `repairStatus` | string | `WAITING`, `OUT_FOR_REPAIR`, or `NOT_REPAIRABLE` |
| `lastInspectionDate` | string | Annual inspection date (Aerial Lifts) |
| `dayRate`, `weekRate`, `monthRate` | number | Rental rates |

### `tools/{toolId}/bookings/{bookingId}` - Equipment Reservations

| Field | Type | Description |
|-------|------|-------------|
| `employeeName` | string | Who booked it |
| `jobName` | string | For which job |
| `startDate` | timestamp | Booking start |
| `endDate` | timestamp | Booking end |
| `status` | string | `UPCOMING` or `CANCELLED` |
| `createdByUid` | string | UID of creator |
| `createdAt` | timestamp | When created |

### `tools/{toolId}/history/{entryId}` - Equipment Audit Log

| Field | Type | Description |
|-------|------|-------------|
| `action` | string | `CHECKED_OUT`, `RETURNED`, `DAMAGED`, `REPAIRED`, or `BOOKED` |
| `employeeName` | string | Employee involved |
| `jobName` | string | Job name |
| `customer` | string | Customer |
| `note` | string | Additional notes |
| `daysOnJob` | number | Days on job (returns) |
| `recordedAt` | timestamp | When it happened |

### `tools/{toolId}/maintenance/{entryId}` - Maintenance Log

| Field | Type | Description |
|-------|------|-------------|
| `date` | string | Date performed (YYYY-MM-DD) |
| `description` | string | What was done |
| `performedBy` | string | Who did the work |

### `users/{docId}` - User Accounts

| Field | Type | Description |
|-------|------|-------------|
| `uid` | string | Firebase Auth UID |
| `email` | string | User email |
| `displayName` | string | Full name |
| `role` | string | `owner`, `admin`, `manager`, or `user` |
| `createdAt` | timestamp | When created |

### `categories/{docId}` - Equipment Categories

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Category name (e.g. "Aerial Lifts") |
| `createdAt` | timestamp | When created |
| `createdByUid` | string | Who created it |

### `repairContacts/{docId}` - Repair Vendors

| Field | Type | Description |
|-------|------|-------------|
| `header` | string | Display header |
| `company` | string | Company name |
| `contact` | string | Contact person |
| `phone` | string | Phone number |
| `address` | string | Address |
| `categories` | string[] | Equipment categories they service |
| `order` | number | Display sort order |

### `timeOffRequests/{docId}` - Time Off Requests

| Field | Type | Description |
|-------|------|-------------|
| `uid` | string | Requester's UID |
| `employeeName` | string | Requester name |
| `employeeEmail` | string | Requester email |
| `startDate` | string | Start date (YYYY-MM-DD) |
| `endDate` | string | End date (YYYY-MM-DD) |
| `reason` | string | Optional reason |
| `status` | string | `PENDING`, `APPROVED`, or `DENIED` |
| `createdAt` | timestamp | When submitted |

### `settings/rentalRates` (single document)

| Field | Type | Description |
|-------|------|-------------|
| `dayRate` | number | Daily rental rate |
| `weekRate` | number | Weekly rental rate |
| `monthRate` | number | Monthly rental rate |

---

## Email Notifications (EmailJS)

Config lives in `constants/emailjs.ts`. Same EmailJS account/service across all notifications.

| Notification | Trigger | Schedule |
|---|---|---|
| Overdue tool alerts | GitHub Action | Mon-Fri 7:30 AM EST |
| Annual inspection due | GitHub Action | Weekly Monday 7:30 AM EST |
| Weekly damage report | GitHub Action | Weekly Monday 7:30 AM EST |
| Time-off request submitted | User submits form | Real-time |

Admin email: `braeden_sibbick@rogers.com`

---

## GitHub Actions

| Workflow | Trigger | What it does |
|---|---|---|
| `deploy-dashboard.yml` | Push to `main` (dashboard/ changes) | Builds & deploys to Vercel |
| `daily-overdue-check.yml` | Mon-Fri 7:30 AM EST | Emails admin about overdue tools |
| `annual-inspection-check.yml` | Monday 7:30 AM EST | Checks Aerial Lift inspection dates |
| `weekly-damage-report.yml` | Monday 7:30 AM EST | Emails damaged equipment summary |

**Required GitHub Secrets:**
- `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`, `VERCEL_TOKEN`
- `FIREBASE_SERVICE_ACCOUNT` (JSON)
- `EMAILJS_SERVICE_ID`, `EMAILJS_TEMPLATE_ID`, `EMAILJS_PUBLIC_KEY`, `EMAILJS_PRIVATE_KEY`
- `ADMIN_EMAIL`

---

## Serverless API

**`POST /api/delete-user`** (Vercel function)

Deletes a user from Firebase Authentication. Called from the Users admin page.

- Body: `{ uid: string, idToken: string }`
- Validates caller is admin via Firebase ID token
- Requires `FIREBASE_SERVICE_ACCOUNT` env var in Vercel

---

## Local Development

```bash
cd dashboard
npm install
npm run dev          # http://localhost:5173
npm run build        # verify before pushing
```

**Deploy:** Push to `main`. GitHub Actions auto-builds and deploys to Vercel.

```bash
git add <specific-files>    # never use git add -A (could catch secrets)
git commit -m "description"
git push
```

---

## Tool Status Flow

```
IN_SHOP ──(check out)──> CHECKED_OUT ──(return)──> IN_SHOP
   |                          |
   |                          |──(past due)──> OVERDUE (display only)
   |                          |
   └──(mark damaged)──> DAMAGED ──(repair complete)──> IN_SHOP
                           |
                           └── repairStatus: WAITING > OUT_FOR_REPAIR > done
                                                     > NOT_REPAIRABLE
```

---

## Category Colors

Categories display as colored badge pills. Defined in `dashboard/src/utils/categoryColors.ts`.

| Category | Color | Category | Color |
|---|---|---|---|
| Aerial Lifts | Blue | Safety | Red |
| Drills | Orange | Tuggers | Teal |
| Ladders | Green | Hand Tools | Amber |
| Job Boxes | Purple | Power Tools | Indigo |

New categories added by users automatically receive a color from a fallback palette.

---

## Key Architecture Decisions

1. **Inline styles** - All styling uses React `CSSProperties` objects, no CSS framework
2. **No state management library** - Each page uses `useState`/`useEffect` + direct Firestore queries
3. **Dynamic categories** - Stored in Firestore, not hardcoded
4. **Subcollection pattern** - Bookings, history, and maintenance live under each tool document
5. **Client-side auth** - Role checks via hooks; only `/api/delete-user` has server-side auth
6. **QR codes** - Each tool can generate a printable QR label linking to its detail page
