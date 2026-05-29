-- Enable RLS on tables that were publicly accessible via Data API.
-- SERVICE_ROLE_KEY bypasses RLS, so app code is unaffected.
-- anon/authenticated roles are denied by default (no policies added).

ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;
