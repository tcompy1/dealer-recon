type LogLevel = "info" | "warn" | "error";

type LogFields = Record<string, unknown>;

export function logInfo(message: string, fields: LogFields = {}): void {
  writeLog("info", message, fields);
}

export function logWarn(message: string, fields: LogFields = {}): void {
  writeLog("warn", message, fields);
}

export function logError(message: string, fields: LogFields = {}): void {
  writeLog("error", message, fields);
}

export function serializeError(error: unknown): LogFields {
  if (error instanceof Error) {
    return {
      error_name: error.name,
      error_message: error.message,
      stack: error.stack,
    };
  }
  return { error_message: String(error) };
}

function writeLog(level: LogLevel, message: string, fields: LogFields): void {
  const entry = {
    level,
    message,
    timestamp: new Date().toISOString(),
    ...fields,
  };
  const line = JSON.stringify(entry);
  if (level === "error") {
    console.error(line);
    return;
  }
  console.log(line);
}
