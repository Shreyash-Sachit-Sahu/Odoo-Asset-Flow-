import { api, downloadFile } from "./client";
import type { AllocationSummaryRow, BookingHeatmap, MaintenanceFrequencyRow, UtilizationReport } from "./types";

export type ExportableReport = "utilization" | "maintenance-frequency" | "allocation-summary" | "booking-heatmap";

export const reports = {
  utilization: () => api.get<UtilizationReport>("/reports/utilization"),
  maintenanceFrequency: () => api.get<MaintenanceFrequencyRow[]>("/reports/maintenance-frequency"),
  allocationSummary: () => api.get<AllocationSummaryRow[]>("/reports/allocation-summary"),
  bookingHeatmap: () => api.get<BookingHeatmap>("/reports/booking-heatmap"),

  export: (report: ExportableReport, fmt: "csv" | "xlsx") =>
    downloadFile(`/reports/export/${report}?fmt=${fmt}`, `${report}.${fmt}`),
};
