const messages = {
  title: "ChatGPT",
  about: [
    "Connect Swarm to ChatGPT and work with your team's knowledge, meetings and tasks in a conversation.",
    "ChatGPT uses your Swarm permissions. Other people's private records stay private.",
  ],
  introduction:
    "Choose where you use ChatGPT. You will need the server address below and your Swarm sign-in.",
  desktopTitle: "ChatGPT desktop app",
  desktopSteps: [
    "In the ChatGPT app, open Settings → MCP servers → Add server. Name it SwarmBrain, choose Streamable HTTP and paste the copied server address.",
    "Save the server and select Restart in its MCP settings. If Authenticate is shown, select it. The Swarm sign-in and consent screen may open in your browser; this does not require creating a separate web plugin.",
    "Sign in to Swarm and allow the connection. Return to the ChatGPT app, check the connection with /mcp and ask: “Show who I am in SwarmBrain”.",
  ],
  webTitle: "ChatGPT in a browser",
  steps: [
    "Open ChatGPT on the web. Open Plugins and choose Add custom MCP server. If your workspace shows Apps or Connectors instead, open its custom MCP server settings.",
    "Name it SwarmBrain, paste the copied server address and choose OAuth authentication. Create and install the connection.",
    "Sign in to Swarm. Check the application and workspace on the consent screen, then choose Allow access.",
    "Select SwarmBrain in a conversation and ask: “Show who I am in SwarmBrain”.",
  ],
  workspaceNote:
    "If adding a custom MCP server is unavailable, ask your ChatGPT workspace administrator to enable it or publish the connection for the team.",
  serverAddress: "MCP server address",
  copyAddress: "Copy address",
  copied: "Copied",
  copyFailed: "Copy failed. Select the address and copy it manually.",
  openChatGpt: "Open ChatGPT in a browser",
  connectedApps: "OAuth connections",
  statusNote:
    "The tile indicator shows the ChatGPT web connection. The list below shows applications authorised by signing in to Swarm. Local connections using a personal token are not listed here; check those in the client's MCP settings.",
  none: "No OAuth connections yet.",
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
