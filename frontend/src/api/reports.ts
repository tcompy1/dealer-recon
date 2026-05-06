import { API_BASE_URL, apiGet } from "./client";
import type { MonthEndReport } from "../types/report";

export type MonthEndReportInput = {
  startDate: string;
  endDate: string;
};

export async function getMonthEndReport({
  startDate,
  endDate,
}: MonthEndReportInput): Promise<MonthEndReport> {
  return apiGet<MonthEndReport>(
    `/reports/month-end?${toMonthEndReportQuery({ startDate, endDate, format: "json" })}`,
  );
}

export function getMonthEndReportCsvUrl({ startDate, endDate }: MonthEndReportInput): string {
  return `${API_BASE_URL}/reports/month-end?${toMonthEndReportQuery({
    startDate,
    endDate,
    format: "csv",
  })}`;
}

function toMonthEndReportQuery({
  startDate,
  endDate,
  format,
}: MonthEndReportInput & { format: "json" | "csv" }): string {
  const params = new URLSearchParams({
    start_date: startDate,
    end_date: endDate,
    format,
  });
  return params.toString();
}
