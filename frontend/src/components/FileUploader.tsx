import { type ChangeEvent, type FormEvent, useState } from "react";

import { uploadTransactions } from "../api/uploads";
import type { SourceType, UploadResponse } from "../types/sourceFile";

const SOURCE_TYPES: Array<{ label: string; value: SourceType }> = [
  { label: "Bank", value: "bank" },
  { label: "BOA", value: "boa" },
  { label: "Dealertrack", value: "dealertrack" },
  { label: "DMS", value: "dms" },
  { label: "GL", value: "gl" },
  { label: "OEM", value: "oem" },
];

const VALIDATION_ERROR_PREVIEW_LIMIT = 10;

export function FileUploader() {
  const [sourceType, setSourceType] = useState<SourceType>("bank");
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<UploadResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setResult(null);

    if (!file) {
      setError("Choose a CSV file before uploading.");
      return;
    }

    setIsUploading(true);
    try {
      setResult(await uploadTransactions({ sourceType, file }));
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Upload failed.");
    } finally {
      setIsUploading(false);
    }
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    setFile(event.target.files?.[0] ?? null);
    setResult(null);
    setError(null);
  }

  return (
    <section className="w-full max-w-3xl rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <div className="mb-6">
        <h2 className="text-xl font-semibold tracking-normal text-slate-950">Upload CSV</h2>
        <p className="mt-1 text-sm text-slate-600">
          Bank, BOA, Dealertrack, DMS, GL, and OEM transaction exports.
        </p>
      </div>

      <form className="grid gap-5" onSubmit={handleSubmit}>
        <label className="grid gap-2">
          <span className="text-sm font-medium text-slate-700">Source type</span>
          <select
            className="h-11 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 shadow-sm outline-none transition focus:border-cyan-600 focus:ring-2 focus:ring-cyan-100"
            value={sourceType}
            onChange={(event) => setSourceType(event.target.value as SourceType)}
          >
            {SOURCE_TYPES.map((source) => (
              <option key={source.value} value={source.value}>
                {source.label}
              </option>
            ))}
          </select>
        </label>

        <label className="grid gap-2">
          <span className="text-sm font-medium text-slate-700">CSV file</span>
          <input
            accept=".csv,text/csv"
            className="block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 file:mr-4 file:rounded-md file:border-0 file:bg-slate-900 file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-cyan-100"
            type="file"
            onChange={handleFileChange}
          />
        </label>

        <div>
          <button
            className="inline-flex h-11 items-center justify-center rounded-md bg-cyan-700 px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-cyan-800 disabled:cursor-not-allowed disabled:bg-slate-300"
            disabled={isUploading}
            type="submit"
          >
            {isUploading ? "Uploading..." : "Upload"}
          </button>
        </div>
      </form>

      {result ? (
        <div className="mt-6 rounded-md border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-950">
          {result.reused_existing_file ? (
            <p className="font-medium">
              Reused existing upload {result.filename} with {result.transaction_count} transaction
              {result.transaction_count === 1 ? "" : "s"}.
            </p>
          ) : (
            <p className="font-medium">
              Parsed {result.transaction_count} transaction
              {result.transaction_count === 1 ? "" : "s"} from {result.filename}.
            </p>
          )}

          {result.warnings && result.warnings.length > 0 ? (
            <ul className="mt-3 list-disc space-y-1 rounded-md border border-amber-200 bg-amber-50 px-6 py-3 text-amber-950">
              {result.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          ) : null}

          {result.validation_errors.length > 0 ? (
            <ValidationErrors errors={result.validation_errors} />
          ) : null}
        </div>
      ) : null}

      {error ? (
        <div className="mt-6 rounded-md border border-red-200 bg-red-50 p-4 text-sm font-medium text-red-950">
          {error}
        </div>
      ) : null}
    </section>
  );
}

function ValidationErrors({ errors }: { errors: UploadResponse["validation_errors"] }) {
  const visibleErrors = errors.slice(0, VALIDATION_ERROR_PREVIEW_LIMIT);
  const hiddenCount = Math.max(errors.length - visibleErrors.length, 0);

  return (
    <details className="mt-3 rounded-md border border-amber-200 bg-amber-50 text-amber-950">
      <summary className="cursor-pointer px-3 py-2 font-medium">
        {errors.length} validation error{errors.length === 1 ? "" : "s"} found. Showing first{" "}
        {visibleErrors.length} when expanded.
      </summary>
      <div className="max-h-64 overflow-auto border-t border-amber-200 bg-white">
        <ul className="list-disc space-y-1 px-6 py-3">
          {visibleErrors.map((validationError, index) => (
            <li key={`${validationError.row ?? "file"}-${validationError.field ?? "file"}-${index}`}>
              {validationError.row ? `Row ${validationError.row}: ` : ""}
              {validationError.message}
            </li>
          ))}
        </ul>
      </div>
      {hiddenCount > 0 ? (
        <p className="border-t border-amber-200 px-3 py-2 text-xs">
          {hiddenCount} additional validation error{hiddenCount === 1 ? "" : "s"} hidden.
        </p>
      ) : null}
    </details>
  );
}
