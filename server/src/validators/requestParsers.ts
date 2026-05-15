import type express from "express";

import {
  isReconciliationExceptionStatus,
  isReconciliationExceptionReviewStatus,
  isReconciliationExceptionType,
  isSourceType,
  scheduledReconciliationCadences,
  type NewDealershipStore,
  type NewScheduledReconciliationJob,
  type ReconciliationExceptionReviewUpdate,
  type ReconciliationRunDetailFilters,
  type ScheduledReconciliationJobUpdate,
  type SourceType,
} from "../domain/types.js";

export function parseLoginRequest(
  value: unknown,
): { email: string; password: string } | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const body = value as { email?: unknown; password?: unknown };
  if (typeof body.email !== "string" || typeof body.password !== "string") {
    return null;
  }
  const email = body.email.trim().toLowerCase();
  if (!email || !body.password) {
    return null;
  }
  return { email, password: body.password };
}

export function parseSourceFileId(value: unknown): number | null {
  return parsePositiveInteger(value);
}

export function parsePositiveInteger(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }
  if (typeof value === "string" && /^\d+$/.test(value)) {
    return Number(value);
  }
  return null;
}

export function parseOptionalPositiveInteger(
  value: unknown,
): number | undefined | false {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  const parsed = parsePositiveInteger(value);
  return parsed ?? false;
}

export function parseStoreCreateRequest(value: unknown): NewDealershipStore | false {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const body = value as { name?: unknown; dealer_group_id?: unknown };
  if (typeof body.name !== "string" || !body.name.trim()) {
    return false;
  }
  const dealerGroupId = parseOptionalPositiveInteger(body.dealer_group_id);
  if (dealerGroupId === false) {
    return false;
  }
  return {
    name: body.name.trim(),
    ...(dealerGroupId ? { dealer_group_id: dealerGroupId } : {}),
  };
}

export function parseScheduledReconciliationJobRequest(
  value: unknown,
): NewScheduledReconciliationJob | false {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const body = value as {
    dealership_store_id?: unknown;
    cadence?: unknown;
    expected_source_types?: unknown;
    enabled?: unknown;
    auto_run_on_pair?: unknown;
    next_run_at?: unknown;
  };
  const storeId = parseOptionalPositiveInteger(body.dealership_store_id);
  if (storeId === false || !isScheduledCadence(body.cadence)) {
    return false;
  }
  const sourceTypes = parseSourceTypeArray(body.expected_source_types);
  if (sourceTypes === false || sourceTypes.length === 0) {
    return false;
  }
  if (body.enabled !== undefined && typeof body.enabled !== "boolean") {
    return false;
  }
  if (body.auto_run_on_pair !== undefined && typeof body.auto_run_on_pair !== "boolean") {
    return false;
  }
  if (body.next_run_at !== undefined && body.next_run_at !== null && typeof body.next_run_at !== "string") {
    return false;
  }
  return {
    ...(storeId ? { dealership_store_id: storeId } : {}),
    cadence: body.cadence,
    expected_source_types: sourceTypes,
    ...(typeof body.enabled === "boolean" ? { enabled: body.enabled } : {}),
    ...(typeof body.auto_run_on_pair === "boolean"
      ? { auto_run_on_pair: body.auto_run_on_pair }
      : {}),
    ...(typeof body.next_run_at === "string" || body.next_run_at === null
      ? { next_run_at: body.next_run_at }
      : {}),
  };
}

export function parseScheduledReconciliationJobUpdate(
  value: unknown,
): ScheduledReconciliationJobUpdate | false {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const body = value as {
    cadence?: unknown;
    expected_source_types?: unknown;
    enabled?: unknown;
    auto_run_on_pair?: unknown;
    last_run_at?: unknown;
    next_run_at?: unknown;
  };
  const update: ScheduledReconciliationJobUpdate = {};
  if (body.cadence !== undefined) {
    if (!isScheduledCadence(body.cadence)) {
      return false;
    }
    update.cadence = body.cadence;
  }
  if (body.expected_source_types !== undefined) {
    const sourceTypes = parseSourceTypeArray(body.expected_source_types);
    if (sourceTypes === false) {
      return false;
    }
    update.expected_source_types = sourceTypes;
  }
  if (body.enabled !== undefined) {
    if (typeof body.enabled !== "boolean") {
      return false;
    }
    update.enabled = body.enabled;
  }
  if (body.auto_run_on_pair !== undefined) {
    if (typeof body.auto_run_on_pair !== "boolean") {
      return false;
    }
    update.auto_run_on_pair = body.auto_run_on_pair;
  }
  if (body.last_run_at !== undefined) {
    if (body.last_run_at !== null && typeof body.last_run_at !== "string") {
      return false;
    }
    update.last_run_at = body.last_run_at;
  }
  if (body.next_run_at !== undefined) {
    if (body.next_run_at !== null && typeof body.next_run_at !== "string") {
      return false;
    }
    update.next_run_at = body.next_run_at;
  }
  return Object.keys(update).length > 0 ? update : false;
}

export function isScheduledCadence(
  value: unknown,
): value is NewScheduledReconciliationJob["cadence"] {
  return (
    typeof value === "string" &&
    scheduledReconciliationCadences.includes(value as NewScheduledReconciliationJob["cadence"])
  );
}

export function parseSourceTypeArray(value: unknown): SourceType[] | false {
  if (!Array.isArray(value)) {
    return false;
  }
  const sourceTypes: SourceType[] = [];
  for (const item of value) {
    if (!isSourceType(item)) {
      return false;
    }
    sourceTypes.push(item);
  }
  return [...new Set(sourceTypes)];
}

export function parseSourceTypeQuery(value: unknown) {
  if (value === undefined) {
    return undefined;
  }
  if (isSourceType(value)) {
    return value;
  }
  return false;
}

export function parseReconciliationRunDetailFilters(
  query: express.Request["query"],
): ReconciliationRunDetailFilters | false {
  const exceptionSourceType = parseSourceTypeQuery(query.source_type);
  if (exceptionSourceType === false) {
    return false;
  }

  const exceptionType = parseExceptionTypeQuery(query.exception_type);
  if (exceptionType === false) {
    return false;
  }

  const search = parseSearchQuery(query.search);
  if (search === false) {
    return false;
  }

  const exceptionStatus = parseExceptionStatusQuery(query.status);
  if (exceptionStatus === false) {
    return false;
  }
  const exceptionReviewStatus = parseExceptionReviewStatusQuery(query.review_status);
  if (exceptionReviewStatus === false) {
    return false;
  }
  const assignedTo = parseSearchQuery(query.assigned_to);
  if (assignedTo === false) {
    return false;
  }

  return {
    ...(exceptionSourceType ? { exceptionSourceType } : {}),
    ...(exceptionType ? { exceptionType } : {}),
    ...(exceptionStatus ? { exceptionStatus } : {}),
    ...(exceptionReviewStatus ? { exceptionReviewStatus } : {}),
    ...(assignedTo ? { assignedTo } : {}),
    ...(search ? { search } : {}),
  };
}

export function parseExceptionTypeQuery(value: unknown) {
  if (value === undefined) {
    return undefined;
  }
  if (isReconciliationExceptionType(value)) {
    return value;
  }
  return false;
}

export function parseSearchQuery(value: unknown): string | undefined | false {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    return false;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function parseExceptionStatusQuery(value: unknown) {
  if (value === undefined) {
    return undefined;
  }
  if (isReconciliationExceptionStatus(value)) {
    return value;
  }
  return false;
}

export function parseExceptionReviewStatusQuery(value: unknown) {
  if (value === undefined) {
    return undefined;
  }
  if (isReconciliationExceptionReviewStatus(value)) {
    return value;
  }
  return false;
}

export function parseExceptionReviewUpdate(
  value: unknown,
): ReconciliationExceptionReviewUpdate | false {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const body = value as {
    status?: unknown;
    note?: unknown;
    review_status?: unknown;
    assigned_to?: unknown;
    review_notes?: unknown;
    reviewed_by?: unknown;
  };
  const hasStatus = Object.hasOwn(body, "status");
  const hasNote = Object.hasOwn(body, "note");
  const hasReviewStatus = Object.hasOwn(body, "review_status");
  const hasAssignedTo = Object.hasOwn(body, "assigned_to");
  const hasReviewNotes = Object.hasOwn(body, "review_notes");
  const hasReviewedBy = Object.hasOwn(body, "reviewed_by");
  if (!hasStatus && !hasNote && !hasReviewStatus && !hasAssignedTo && !hasReviewNotes && !hasReviewedBy) {
    return false;
  }
  if (hasStatus && !isReconciliationExceptionStatus(body.status)) {
    return false;
  }
  if (hasNote && typeof body.note !== "string") {
    return false;
  }
  if (hasReviewStatus && !isReconciliationExceptionReviewStatus(body.review_status)) {
    return false;
  }
  if (hasAssignedTo && body.assigned_to !== null && typeof body.assigned_to !== "string") {
    return false;
  }
  if (hasReviewNotes && typeof body.review_notes !== "string") {
    return false;
  }
  if (hasReviewedBy && body.reviewed_by !== null && typeof body.reviewed_by !== "string") {
    return false;
  }
  return {
    ...(hasStatus && isReconciliationExceptionStatus(body.status) ? { status: body.status } : {}),
    ...(hasNote && typeof body.note === "string" ? { note: body.note.trim() } : {}),
    ...(hasReviewStatus && isReconciliationExceptionReviewStatus(body.review_status)
      ? { review_status: body.review_status }
      : {}),
    ...(hasAssignedTo
      ? { assigned_to: typeof body.assigned_to === "string" ? body.assigned_to.trim() || null : null }
      : {}),
    ...(hasReviewNotes && typeof body.review_notes === "string"
      ? { review_notes: body.review_notes.trim() }
      : {}),
    ...(hasReviewedBy
      ? { reviewed_by: typeof body.reviewed_by === "string" ? body.reviewed_by.trim() || null : null }
      : {}),
  };
}

export function parseMonthEndReportQuery(
  query: express.Request["query"],
): { startDate: string; endDate: string; format: "json" | "csv" } | false {
  if (!isIsoDate(query.start_date) || !isIsoDate(query.end_date)) {
    return false;
  }
  if (query.start_date > query.end_date) {
    return false;
  }
  const format = query.format ?? "json";
  if (format !== "json" && format !== "csv") {
    return false;
  }
  return {
    startDate: query.start_date,
    endDate: query.end_date,
    format,
  };
}

export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}
