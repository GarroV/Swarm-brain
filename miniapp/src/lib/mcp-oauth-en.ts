const messages = {
  title: "ChatGPT",
  about: [
    "Connect Swarm to ChatGPT and work with your team's knowledge, meetings and tasks in a conversation.",
    "ChatGPT uses your Swarm permissions. Other people's private records stay private.",
  ],
  chatNoteTitle: "Regular chats (Chat) and ChatGPT in a browser",
  chatNote:
    "In a corporate ChatGPT workspace, only the workspace admin can connect Swarm to regular chats: they add an MCP server with the address below and OAuth sign-in. After that, each employee signs in to Swarm once with their own account and sees only their own data.",
  serverAddress: "MCP server address",
  copyAddress: "Copy address",
  copied: "Copied",
  copyFailed: "Copy failed. Select the address and copy it manually.",
  connectedApps: "OAuth connections",
  statusNote:
    "The tile indicator includes the desktop bridge and ChatGPT web connections. Desktop access is managed above. The list below shows OAuth applications authorised by signing in to Swarm.",
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
  desktopBridge: {
    ariaLabel: "ChatGPT desktop bridge",
    heading: "Connect through Terminal · macOS",
    intro:
      "The command installs the bridge and connects SwarmBrain to the ChatGPT desktop app on Mac. Swarm is available in the Work tab — the Chat | Work switch at the top of a new chat. It is not visible in Chat mode.",
    wait: "Please wait…",
    replaceCommand: "Replace installation command",
    getCommand: "Get installation command",
    pasteHint:
      "Open Terminal, paste the entire command and press Enter. It contains your personal credential; do not share it.",
    copied: "Copied",
    copyCommand: "Copy command",
    afterInstall:
      "After installation, quit and reopen ChatGPT. Start a new chat, switch to Work and ask: “Show who I am in SwarmBrain”.",
    lastRequest: (date: string) => `Last request: ${date}`,
    awaitingFirstRequest:
      "Credential issued; awaiting the first request from ChatGPT.",
    validity: "Access lasts 30 days. Claude uses a separate credential.",
    disconnectButton: "Disconnect ChatGPT bridge",
    actionFailed: "The action failed. Refresh the page and try again.",
    replaceTitle: "Replace the ChatGPT credential?",
    replaceConfirm: "Replace",
    cancel: "Cancel",
    replaceDescription:
      "The previous ChatGPT credential will stop working. Claude and bumblebee stay connected.",
    disconnectTitle: "Disconnect the ChatGPT bridge?",
    disconnectConfirm: "Disconnect",
    disconnectDescription:
      "The local bridge will lose Swarm access. Claude and web connections stay active.",
  },
};
export default messages;
