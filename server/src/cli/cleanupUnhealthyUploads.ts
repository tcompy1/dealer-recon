import { loadConfig } from "../config.js";
import { createPool } from "../repositories/postgresTransactionRepository.js";
import { isSourceType, type SourceType } from "../domain/types.js";

type Args = {
  dealershipId: number;
  storeId: number;
  sourceType: SourceType;
  month: string;
  delete: boolean;
};

type CandidateRow = {
  id: number;
  dealership_store_id: number;
  source_type: SourceType;
  original_filename: string;
  row_count: number;
  validation_error_count: number;
  transaction_count: string;
  created_at: Date;
};

async function main() {
  const config = loadConfig();
  const args = parseArgs(process.argv.slice(2), config.defaultDealershipId);
  const [startDate, endDate] = monthBounds(args.month);
  const pool = createPool(config.databaseUrl);

  try {
    const candidates = await pool.query<CandidateRow>(
      `SELECT sf.id,
              sf.dealership_store_id,
              sf.source_type,
              sf.original_filename,
              sf.row_count,
              sf.validation_error_count,
              COUNT(t.id)::text AS transaction_count,
              sf.created_at
       FROM source_files sf
       LEFT JOIN transactions t
         ON t.source_file_id = sf.id
        AND t.dealership_id = sf.dealership_id
       WHERE sf.dealership_id = $1
         AND sf.dealership_store_id = $2
         AND sf.source_type = $3
         AND sf.created_at >= $4
         AND sf.created_at < $5
       GROUP BY sf.id
       HAVING COUNT(t.id) = 0
          OR sf.row_count <= 0
          OR (
            sf.validation_error_count > 0
            AND sf.validation_error_count >= (sf.row_count + sf.validation_error_count)
          )
       ORDER BY sf.created_at, sf.id`,
      [args.dealershipId, args.storeId, args.sourceType, startDate, endDate],
    );

    const rows = candidates.rows.map((row) => ({
      source_file_id: row.id,
      store_id: row.dealership_store_id,
      source_type: row.source_type,
      filename: row.original_filename,
      row_count: row.row_count,
      validation_error_count: row.validation_error_count,
      transaction_count: Number(row.transaction_count),
      created_at: row.created_at.toISOString(),
    }));

    console.log(JSON.stringify({ mode: args.delete ? "delete" : "dry_run", candidates: rows }, null, 2));

    if (!args.delete || rows.length === 0) {
      return;
    }

    const ids = rows.map((row) => row.source_file_id);
    const deleted = await pool.query<{ id: number }>(
      `DELETE FROM source_files
       WHERE dealership_id = $1
         AND id = ANY($2::integer[])
       RETURNING id`,
      [args.dealershipId, ids],
    );
    console.log(JSON.stringify({ deleted_source_file_ids: deleted.rows.map((row) => row.id) }, null, 2));
  } finally {
    await pool.end();
  }
}

function parseArgs(rawArgs: string[], defaultDealershipId: number): Args {
  const values = new Map<string, string | true>();
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (!arg.startsWith("--")) {
      throw new Error(`Unexpected argument: ${arg}`);
    }
    const key = arg.slice(2);
    if (key === "delete") {
      values.set(key, true);
      continue;
    }
    const value = rawArgs[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for --${key}`);
    }
    values.set(key, value);
    index += 1;
  }

  const storeId = parsePositiveInteger(values.get("store-id"), "--store-id");
  const sourceType = values.get("source-type");
  const month = values.get("month");
  const dealershipIdValue = values.get("dealership-id");
  const dealershipId =
    dealershipIdValue === undefined
      ? defaultDealershipId
      : parsePositiveInteger(dealershipIdValue, "--dealership-id");

  if (typeof sourceType !== "string" || !isSourceType(sourceType)) {
    throw new Error("--source-type must be one of bank, boa, dealertrack, dms, gl, oem");
  }
  if (typeof month !== "string" || !/^\d{4}-\d{2}$/.test(month)) {
    throw new Error("--month must use YYYY-MM format");
  }

  return {
    dealershipId,
    storeId,
    sourceType,
    month,
    delete: values.get("delete") === true,
  };
}

function parsePositiveInteger(value: string | true | undefined, name: string): number {
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    throw new Error(`${name} must be a positive integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function monthBounds(month: string): [Date, Date] {
  const [yearPart, monthPart] = month.split("-");
  const year = Number(yearPart);
  const monthIndex = Number(monthPart) - 1;
  const start = new Date(Date.UTC(year, monthIndex, 1));
  const end = new Date(Date.UTC(year, monthIndex + 1, 1));
  return [start, end];
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
