// Domain types — shapes follow the phase-1…phase-6 briefs (Spring camelCase DTOs).
// Where a brief doesn't pin a response shape (dashboard, reports), the type here
// is the contract the mock implements and the adapter point for the real backend.

export type Role = "EMPLOYEE" | "DEPARTMENT_HEAD" | "ASSET_MANAGER" | "ADMIN";

export const ROLE_LABEL: Record<Role, string> = {
  EMPLOYEE: "Employee",
  DEPARTMENT_HEAD: "Department head",
  ASSET_MANAGER: "Asset manager",
  ADMIN: "Admin",
};

export interface SessionUser {
  id: number;
  email: string;
  role: Role;
  name?: string;
  employeeId?: number;
  departmentId?: number | null;
}

export interface TokenPair {
  access: string;
  refresh: string;
}

// Spring Data Page<T>
export interface Page<T> {
  content: T[];
  totalElements: number;
  totalPages: number;
  number: number; // 0-based page index
  size: number;
}

export interface Department {
  id: number;
  name: string;
  parentDepartmentId: number | null;
  headEmployeeId: number | null;
  status: "ACTIVE" | "INACTIVE";
  createdAt?: string;
}

export type CustomFieldType = "string" | "number" | "date" | "boolean";

export interface Category {
  id: number;
  name: string;
  customFields: Record<string, CustomFieldType>;
  isActive: boolean;
  createdAt?: string;
}

export type EmployeeStatus = "ACTIVE" | "INACTIVE";

export interface Employee {
  id: number;
  userId: number;
  name: string;
  email: string;
  departmentId: number | null;
  status: EmployeeStatus;
  role: Role; // joined from users
}

export type AssetStatus =
  | "AVAILABLE"
  | "ALLOCATED"
  | "RESERVED"
  | "UNDER_MAINTENANCE"
  | "LOST"
  | "RETIRED"
  | "DISPOSED";

export type AssetCondition = "NEW" | "GOOD" | "FAIR" | "POOR" | "DAMAGED";

export interface HolderRef {
  type: "EMPLOYEE" | "DEPARTMENT";
  id: number;
  name: string;
  since?: string;
}

export interface Asset {
  id: number;
  assetTag: string;
  name: string;
  categoryId: number;
  categoryName?: string;
  serialNumber: string | null;
  acquisitionDate: string | null;
  acquisitionCost: number | null;
  condition: AssetCondition;
  location: string | null;
  isBookable: boolean;
  status: AssetStatus;
  customValues: Record<string, string | number | boolean>;
  photoUrl: string | null;
  currentHolder?: HolderRef | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface AssetHistoryEvent {
  id: number;
  assetId: number;
  eventType: string; // REGISTERED, ALLOCATED, RETURNED, TRANSFERRED, MAINT_*, AUDIT_*, STATUS_CHANGE
  detail: string | null;
  actorId: number | null;
  actorName?: string | null;
  occurredAt: string;
}

export type AllocationStatus = "ACTIVE" | "RETURNED";

export interface AssetRef {
  id: number;
  assetTag: string;
  name: string;
}

export interface Allocation {
  id: number;
  assetId: number;
  asset?: AssetRef;
  holderEmployeeId: number | null;
  holderDepartmentId: number | null;
  holderName?: string;
  allocatedBy: number;
  allocatedByName?: string;
  allocatedAt: string;
  expectedReturnAt: string | null;
  returnedAt: string | null;
  returnCondition: AssetCondition | null;
  returnNotes: string | null;
  status: AllocationStatus;
}

/** Body of the 409 returned when allocating an already-held asset. */
export interface AllocationConflictBody {
  message: string;
  currentHolder: string;
  canRequestTransfer: boolean;
  heldSince?: string;
  assetTag?: string;
}

export type TransferStatus = "REQUESTED" | "APPROVED" | "REJECTED";

export interface TransferRequest {
  id: number;
  assetId: number;
  asset?: AssetRef;
  fromAllocationId: number | null;
  fromHolderName?: string;
  requestedBy: number;
  requestedByName?: string;
  toEmployeeId: number | null;
  toDepartmentId: number | null;
  toName?: string;
  reason: string | null;
  status: TransferStatus;
  decidedBy: number | null;
  decidedByName?: string;
  createdAt: string;
  decidedAt: string | null;
  departmentId?: number | null; // scope for DEPT_HEAD approval
}

export type BookingStatus = "UPCOMING" | "ONGOING" | "COMPLETED" | "CANCELLED";

export interface Booking {
  id: number;
  resourceId: number;
  resource?: AssetRef;
  bookedBy: number;
  bookedByName?: string;
  onBehalfOfDepartmentId: number | null;
  start: string; // inclusive
  end: string; // exclusive — [start, end)
  status: BookingStatus;
  createdAt?: string;
}

/** Body of the 409 returned on a booking overlap. */
export interface BookingConflictBody {
  message: string;
  conflict?: { start: string; end: string };
}

export type MaintPriority = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type MaintStatus =
  | "PENDING"
  | "APPROVED"
  | "REJECTED"
  | "TECHNICIAN_ASSIGNED"
  | "IN_PROGRESS"
  | "RESOLVED";

export interface MaintenanceRequest {
  id: number;
  assetId: number;
  asset?: AssetRef;
  raisedBy: number;
  raisedByName?: string;
  issue: string;
  priority: MaintPriority;
  photoUrl: string | null;
  status: MaintStatus;
  approvedBy: number | null;
  approvedByName?: string;
  technicianId: number | null;
  technicianName?: string;
  resolutionNotes: string | null;
  createdAt: string;
  approvedAt: string | null;
  resolvedAt: string | null;
}

export type AuditResult = "VERIFIED" | "MISSING" | "DAMAGED";
export type CycleStatus = "OPEN" | "CLOSED";

export interface AuditCycle {
  id: number;
  name: string;
  scopeDepartmentId: number | null;
  scopeDepartmentName?: string;
  scopeLocation: string | null;
  startDate: string;
  endDate: string;
  status: CycleStatus;
  createdBy: number;
  createdByName?: string;
  createdAt: string;
  closedAt: string | null;
  auditorIds?: number[];
  auditorNames?: string[];
  progress?: { checked: number; total: number };
}

export interface AuditItem {
  id: number;
  cycleId: number;
  assetId: number;
  asset?: AssetRef & { location?: string | null; status?: AssetStatus };
  result: AuditResult | null;
  auditorId: number | null;
  auditorName?: string;
  notes: string | null;
  checkedAt: string | null;
}

export interface NotificationItem {
  id: number;
  recipientId: number;
  type: string; // ASSET_ASSIGNED, MAINT_APPROVED, BOOKING_CONFIRMED, OVERDUE_RETURN, ...
  message: string;
  refType: "asset" | "booking" | "maintenance" | "transfer" | "audit" | null;
  refId: number | null;
  isRead: boolean;
  createdAt: string;
}

export interface ActivityEntry {
  id: number;
  actorId: number | null;
  actorName?: string;
  action: string; // ROLE_CHANGE, ALLOCATE, TRANSFER_APPROVE, ...
  entityType: string | null;
  entityId: number | null;
  detail: string | null;
  createdAt: string;
}

// ---- Dashboard (shape owned by this contract; adapt here if backend differs) ----

export interface DashboardKpis {
  assetsAvailable: number;
  assetsAllocated: number;
  maintenanceToday: number;
  activeBookings: number;
  pendingTransfers: number;
  upcomingReturns: number;
  overdueReturns: number;
}

export interface AttentionItem {
  id: string;
  kind: "OVERDUE" | "TRANSFER_PENDING" | "MAINT_PENDING" | "BOOKING_SOON" | "AUDIT_OPEN";
  message: string;
  detail?: string;
  href: string;
  at: string | null;
}

export interface DashboardData {
  scope: "ORG" | "DEPARTMENT" | "SELF";
  kpis: DashboardKpis;
  needsAttention: AttentionItem[];
}

// ---- Reports ----

export interface UtilizationPoint {
  weekStart: string;
  utilizationPct: number; // 0..100 of allocatable assets that were allocated
}

export interface AssetUsage {
  assetId: number;
  assetTag: string;
  name: string;
  allocations: number;
  daysHeld: number;
}

export interface UtilizationReport {
  trend: UtilizationPoint[];
  mostUsed: AssetUsage[];
  idle: AssetUsage[];
}

export interface MaintenanceFrequencyRow {
  key: string; // category or asset label
  count: number;
  openCount: number;
}

export interface AllocationSummaryRow {
  departmentId: number;
  departmentName: string;
  activeAllocations: number;
  overdue: number;
  assetsHeld: number;
}

export interface BookingHeatmap {
  // hours[h][d] = bookings count for hour h (0-23), weekday d (0=Mon..6=Sun)
  hours: number[][];
  hourRange: [number, number]; // display window, e.g. [7, 20]
  max: number;
}
