/**
 * Shared type definitions used across dashboard pages.
 *
 * Firestore timestamp fields are typed as `any` because they arrive as
 * Firestore Timestamp objects (with `.toDate()`) but the codebase does not
 * import the Timestamp type everywhere.
 */

/** Equipment / tool document from the `tools` collection. */
export type Tool = {
  id: string;
  name?: string;
  toolId?: string;
  status?: string;
  category?: string;
  checkedOutToEmployeeName?: string;
  checkedOutToJobName?: string;
  checkedOutToCustomer?: string;
  checkedOutAt?: any;
  dueBackAt?: any;
  damagedNote?: string;
  damagedPhotoUrl?: string;
  damagedReportedAt?: any;
  damagedReportedBy?: string;
  repairStatus?: string;
  dayRate?: number;
  weekRate?: number;
  monthRate?: number;
  lastInspectionDate?: string;
  model?: string;
  serialNumber?: string;
  notes?: string;
  photoURL?: string;
};

/** Vehicle document from the `vehicles` collection. */
export type Vehicle = {
  id: string;
  name?: string;
  vehicleId?: string;
  status?: string;
  checkedOutToEmployeeName?: string;
  checkedOutToJobName?: string;
  checkedOutToCustomer?: string;
  checkedOutAt?: any;
  dueBackAt?: any;
  damagedNote?: string;
  damagedPhotoUrl?: string;
  damagedReportedAt?: any;
  damagedReportedBy?: string;
  repairStatus?: string;
  dayRate?: number;
  weekRate?: number;
  monthRate?: number;
  lastInspectionDate?: string;
  model?: string;
  serialNumber?: string;
  notes?: string;
  photoURL?: string;
};

/** Booking sub-document from `tools/{toolId}/bookings` or `vehicles/{vehicleId}/bookings`. */
export type Booking = {
  id: string;
  toolId: string;
  toolName: string;
  source?: "tool" | "vehicle";
  employeeName: string;
  jobName: string;
  startDate: any;
  endDate: any;
  createdAt?: any;
  createdByUid?: string;
  status: "UPCOMING" | "CANCELLED";
};

/** History sub-document from `tools/{toolId}/history`. */
export type HistoryEntry = {
  id: string;
  action: "CHECKED_OUT" | "RETURNED" | "DAMAGED" | "REPAIRED" | "BOOKED";
  employeeName?: string;
  jobName?: string;
  customer?: string;
  note?: string;
  reportedBy?: string;
  daysOnJob?: number;
  excludedWeekends?: boolean;
  recordedAt?: any;
};

/** Maintenance sub-document from `tools/{toolId}/maintenance`. */
export type MaintenanceEntry = {
  id: string;
  date: string;           // YYYY-MM-DD
  description: string;
  performedBy: string;
  cost?: number;
  createdAt?: any;
  createdByUid?: string;
};

/** Time-off request document from the `timeOffRequests` collection. */
export type TimeOffRequest = {
  id: string;
  employeeName: string;
  employeeEmail: string;
  uid: string;
  startDate: string;
  endDate: string;
  reason: string;
  status: "PENDING" | "APPROVED" | "DENIED";
  createdAt: any;
};

/** On-call assignment document from the `onCallAssignments` collection. */
export type OnCallAssignment = {
  id: string;
  date: string;              // "YYYY-MM-DD"
  uid: string;
  employeeName: string;
  assignedByUid: string;
  createdAt: any;
};

/** On-call swap request document from the `onCallSwapRequests` collection. */
export type OnCallSwapRequest = {
  id: string;
  date: string;
  assignmentId: string;
  requesterUid: string;
  requesterName: string;
  targetUid: string;
  targetName: string;
  targetDate: string;
  targetAssignmentId: string;
  reason: string;
  status: "PENDING" | "ACCEPTED" | "DECLINED";
  createdAt: any;
  resolvedAt: any;
};
