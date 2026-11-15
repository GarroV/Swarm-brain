import { mcpApiFetch as request } from "./api";
import { createManualMeetingMergeApi } from "./manualMeetingMergeRequest";

// Reuse the existing request export, including session, maintenance errors and invalidation.
export const manualMeetingMergeApi = createManualMeetingMergeApi(request);
