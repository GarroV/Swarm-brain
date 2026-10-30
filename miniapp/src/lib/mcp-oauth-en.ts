const messages = {
  title: "ChatGPT",
  about: [
    "Connect Swarm to ChatGPT and work with your team's knowledge, meetings and tasks in a conversation.",
    "ChatGPT uses your Swarm permissions. Other people's private records stay private.",
  ],
  introduction:
    "Connect in ChatGPT on the web. You only need the server address and to sign in to Swarm.",
  steps: [
    "Open ChatGPT on the web. Open Plugins and choose Add custom MCP server. If your workspace shows Apps or Connectors instead, open its custom MCP server settings.",
    "Name it SwarmBrain, paste the server address below and choose OAuth authentication. Create and install the connection.",
    "Sign in to Swarm. Check the application and workspace on the consent screen, then choose Allow access.",
    "Select SwarmBrain in a conversation and ask: “Show who I am in SwarmBrain”.",
  ],
  workspaceNote:
    "If adding a custom MCP server is unavailable, ask your ChatGPT workspace administrator to enable it or publish the connection for the team.",
  serverAddress: "MCP server address",
  copyAddress: "Copy address",
  copied: "Copied",
  copyFailed: "Copy failed. Select the address and copy it manually.",
  openChatGpt: "Open ChatGPT",
  connectedApps: "Connected MCP applications",
  none: "No applications connected yet.",
  loading: "Loading…",
  loadFailed: "Could not load connections. Try again.",
  retry: "Try again",
  refresh: "Refresh status",
  lastSeen: "Last request",
  awaiting: "Awaiting first request",
  connected: "Connected",
  expired: "Access expired. Reconnect the application.",
  disconnect: "Disconnect",
  disconnecting: "Disconnecting…",
  disconnectTitle: "Disconnect this application?",
  disconnectDescription:
    "Its access to your Swarm data will stop. You can connect it again in the application.",
  cancel: "Cancel",
  disconnectFailed: "Could not disconnect the application. Try again.",
  demoNotice: "Connections cannot be created in the demo.",
  consentTitle: "Allow access to SwarmBrain?",
  consentIntro: "This application is asking to use SwarmBrain on your behalf.",
  application: "Application",
  returnTo: "Return address",
  workspace: "Workspace",
  account: "Signed in as",
  permissions:
    "The application can read and update the knowledge, tasks and meetings available to you in this workspace. Your Swarm permissions and deletion confirmations still apply.",
  unverified:
    "The application name is provided by the application itself. Check the return address and only allow a connection you started.",
  allow: "Allow access",
  deny: "Deny",
  submitting: "Returning to application…",
  consentFailed:
    "This request is unavailable or has expired. Start the connection again in the application.",
  consentSubmitFailed: "Could not complete the request. Try again.",
  invalidRedirect:
    "The return address could not be opened. Start the connection again in the application.",
  back: "Back to Swarm",
};
export default messages;
