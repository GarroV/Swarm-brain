// Read-only Decimus routes share the authenticated workspace dispatcher.
import { handleInspectionRoutes } from "./inspections.ts";
import { handlePerformanceRoutes } from "./performance.ts";
import { handleQualityRoutes } from "./quality.ts";

export async function handleAnalyticsRoutes(
  req: Request,
  routePath: string,
  isDemo: boolean,
  origin: string,
): Promise<Response | null> {
  return await handlePerformanceRoutes(req, routePath, isDemo, origin) ??
    await handleQualityRoutes(req, routePath, isDemo, origin) ??
    await handleInspectionRoutes(req, routePath, isDemo, origin);
}
