import { ValidationError } from "../errors/HttpError.js";

/**
 * Validation result type
 */
export type ValidationResult<T> =
  | { success: true; data: T }
  | { success: false; errors: Record<string, string> };

/**
 * Throws a ValidationError if the result is not successful
 */
export function assertValid<T>(result: ValidationResult<T>): asserts result is { success: true; data: T } {
  if (!result.success) {
    throw ValidationError.fromFields(result.errors);
  }
}

/**
 * Validates and returns data, throwing ValidationError on failure
 */
export function validateOrThrow<T>(result: ValidationResult<T>): T {
  assertValid(result);
  return result.data;
}

/**
 * Creates a validation error result
 */
export function validationError<T>(errors: Record<string, string>): ValidationResult<T> {
  return { success: false, errors };
}

/**
 * Creates a successful validation result
 */
export function validationSuccess<T>(data: T): ValidationResult<T> {
  return { success: true, data };
}

/**
 * Validates a required string field
 */
export function validateRequiredString(
  value: unknown,
  fieldName: string,
): { value: string } | { error: string } {
  if (typeof value !== "string") {
    return { error: `${fieldName} must be a string.` };
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return { error: `${fieldName} is required.` };
  }
  return { value: trimmed };
}

/**
 * Validates an optional string field
 */
export function validateOptionalString(
  value: unknown,
  fieldName: string,
): { value: string | null } | { error: string } {
  if (value === undefined || value === null || value === "") {
    return { value: null };
  }
  if (typeof value !== "string") {
    return { error: `${fieldName} must be a string.` };
  }
  const trimmed = value.trim();
  return { value: trimmed.length > 0 ? trimmed : null };
}

/**
 * Validates a required positive integer
 */
export function validateRequiredPositiveInteger(
  value: unknown,
  fieldName: string,
): { value: number } | { error: string } {
  if (typeof value === "number") {
    if (!Number.isInteger(value) || value <= 0) {
      return { error: `${fieldName} must be a positive integer.` };
    }
    return { value };
  }
  if (typeof value === "string" && /^\d+$/.test(value)) {
    const parsed = Number(value);
    if (parsed > 0) {
      return { value: parsed };
    }
  }
  return { error: `${fieldName} must be a positive integer.` };
}

/**
 * Validates an optional positive integer
 */
export function validateOptionalPositiveInteger(
  value: unknown,
  fieldName: string,
): { value: number | null } | { error: string } {
  if (value === undefined || value === null || value === "") {
    return { value: null };
  }
  const result = validateRequiredPositiveInteger(value, fieldName);
  if ("error" in result) {
    return result;
  }
  return { value: result.value };
}

/**
 * Validates a required boolean field
 */
export function validateRequiredBoolean(
  value: unknown,
  fieldName: string,
): { value: boolean } | { error: string } {
  if (typeof value !== "boolean") {
    return { error: `${fieldName} must be a boolean.` };
  }
  return { value };
}

/**
 * Validates an optional boolean field
 */
export function validateOptionalBoolean(
  value: unknown,
  fieldName: string,
): { value: boolean | null } | { error: string } {
  if (value === undefined || value === null) {
    return { value: null };
  }
  if (typeof value !== "boolean") {
    return { error: `${fieldName} must be a boolean.` };
  }
  return { value };
}

/**
 * Validates an enum value
 */
export function validateEnum<T extends string>(
  value: unknown,
  fieldName: string,
  allowedValues: readonly T[],
): { value: T } | { error: string } {
  if (typeof value !== "string") {
    return { error: `${fieldName} must be a string.` };
  }
  if (!allowedValues.includes(value as T)) {
    return {
      error: `${fieldName} must be one of: ${allowedValues.join(", ")}.`,
    };
  }
  return { value: value as T };
}

/**
 * Validates an optional enum value
 */
export function validateOptionalEnum<T extends string>(
  value: unknown,
  fieldName: string,
  allowedValues: readonly T[],
): { value: T | null } | { error: string } {
  if (value === undefined || value === null || value === "") {
    return { value: null };
  }
  const result = validateEnum(value, fieldName, allowedValues);
  if ("error" in result) {
    return result;
  }
  return { value: result.value };
}

/**
 * Validates an ISO date string (YYYY-MM-DD)
 */
export function validateIsoDate(
  value: unknown,
  fieldName: string,
): { value: string } | { error: string } {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return { error: `${fieldName} must be a valid ISO date (YYYY-MM-DD).` };
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) {
    return { error: `${fieldName} must be a valid ISO date (YYYY-MM-DD).` };
  }
  return { value };
}

/**
 * Validates an array of values
 */
export function validateArray<T>(
  value: unknown,
  fieldName: string,
  itemValidator: (item: unknown, index: number) => { value: T } | { error: string },
): { value: T[] } | { error: string } {
  if (!Array.isArray(value)) {
    return { error: `${fieldName} must be an array.` };
  }
  const result: T[] = [];
  for (let i = 0; i < value.length; i++) {
    const itemResult = itemValidator(value[i], i);
    if ("error" in itemResult) {
      return { error: `${fieldName}[${i}]: ${itemResult.error}` };
    }
    result.push(itemResult.value);
  }
  return { value: result };
}
