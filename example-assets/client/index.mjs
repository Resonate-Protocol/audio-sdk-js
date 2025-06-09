import { Client } from "../../dist/client/client.js";

// Get references to the existing HTML elements
const playerIdInput = document.getElementById("player-id-input");
const urlInput = document.getElementById("url-input");
const connectButton = document.getElementById("connect-button");
const stopButton = document.getElementById("stop-btn");
const availableGroups = document.getElementById("available-groups");
const joinGroupButton = document.getElementById("join-group-btn");
const leaveGroupButton = document.getElementById("leave-group-btn");
const statusDisplay = document.getElementById("status-display");
const connectionStatus = document.getElementById("connection-status");
const clearLogsBtn = document.getElementById("clear-logs-btn");
const metadata = document.getElementById("metadata");
const artworkImage = document.getElementById("artwork-image");

playerIdInput.value = `player-${Math.floor(Math.random() * 1000)}`;
urlInput.value = `ws://${window.location.hostname}:3001`;

// Create a custom logger that outputs to both console and status-display div
class DisplayLogger {
  constructor(displayElement) {
    this.displayElement = displayElement;
  }

  formatTime() {
    const now = new Date();
    return `${now.getHours().toString().padStart(2, "0")}:${now
      .getMinutes()
      .toString()
      .padStart(2, "0")}:${now.getSeconds().toString().padStart(2, "0")}.${now
      .getMilliseconds()
      .toString()
      .padStart(3, "0")}`;
  }

  appendToDisplay(message, isError = false) {
    const logEntry = document.createElement("div");
    logEntry.className = `log-entry ${isError ? "log-error" : "log-info"}`;

    const timeSpan = document.createElement("span");
    timeSpan.className = "log-time";
    timeSpan.textContent = this.formatTime();

    logEntry.appendChild(timeSpan);
    logEntry.appendChild(document.createTextNode(message));

    this.displayElement.appendChild(logEntry);
    this.displayElement.scrollTop = this.displayElement.scrollHeight;
  }

  log(message, ...data) {
    console.log(message, ...data);
    let displayMessage = message;
    if (data.length) {
      try {
        displayMessage +=
          " " +
          data
            .map((item) =>
              typeof item === "object" ? JSON.stringify(item) : String(item),
            )
            .join(" ");
      } catch (e) {
        displayMessage += " [Complex object]";
      }
    }
    this.appendToDisplay(displayMessage);
  }

  error(message, ...data) {
    console.error(message, ...data);
    let displayMessage = message;
    if (data.length) {
      try {
        displayMessage +=
          " " +
          data
            .map((item) =>
              typeof item === "object" ? JSON.stringify(item) : String(item),
            )
            .join(" ");
      } catch (e) {
        displayMessage += " [Complex object]";
      }
    }
    this.appendToDisplay(displayMessage, true);
  }
}

// Create logger instance
const logger = new DisplayLogger(statusDisplay);

// Clear logs button handler
clearLogsBtn.addEventListener("click", () => {
  statusDisplay.innerHTML = "";
  logger.log("Logs cleared");
});

// Player instance reference
let client = null;
let reconnectTimeout = null;

// Handle connect/disconnect button click
connectButton.addEventListener("click", async () => {
  if (client) {
    // Disconnect if already connected
    client.disconnect();
    client = null;
    connectButton.textContent = "Connect";
    connectionStatus.textContent = "Disconnected";
    if (reconnectTimeout) {
      clearTimeout(reconnectTimeout);
      reconnectTimeout = null;
    } else {
      logger.log("Disconnected from server");
    }
    return;
  }

  // Get the URL from the input
  const url = urlInput.value.trim();

  if (!url) {
    connectionStatus.textContent = "Error: Please enter a WebSocket URL";
    logger.error("No WebSocket URL provided");
    return;
  }

  try {
    // Create and connect the player with our custom logger
    client = new Client({
      playerId: playerIdInput.value,
      url,
      logger,
    });
    client.on("metadata-update", (data) => {
      metadata.innerHTML = data
        ? `<strong>Metadata:</strong><br><pre>${JSON.stringify(
            data,
            undefined,
            2,
          )}</pre>`
        : "";
      logger.log("Received metadata:", data);
    });
    let previousArtworkUrl = null;
    client.on("art-update", (data) => {
      if (previousArtworkUrl) {
        URL.revokeObjectURL(previousArtworkUrl);
      }

      if (data) {
        artworkImage.src = previousArtworkUrl = URL.createObjectURL(data.data);
        artworkImage.style.display = "block";
      } else {
        previousArtworkUrl = null;
        artworkImage.src = "";
        artworkImage.style.display = "none";
      }
    });
    client.on("close", (ev) => {
      if (!ev.expected) {
        logger.error("Connection closed unexpectedly");
        reconnectTimeout = setTimeout(() => client.connect(true), 5000);
        connectionStatus.textContent = "Reconnecting...";
        return;
      }
      client = null;
      connectButton.textContent = "Connect";
      connectionStatus.textContent = "Disconnected";
      metadata.innerHTML = "";
      artworkImage.src = "";
      artworkImage.style.display = "none";
      logger.log("Disconnected from server");
    });

    // Update UI
    connectButton.textContent = "Disconnect";
    connectionStatus.textContent = `Connected to ${url}`;
    logger.log(`Attempting connection to ${url}`);
    if (!(await client.connect())) {
      connectionStatus.textContent = "Error: Connection failed";
      logger.error("Connection failed");
      return;
    }
  } catch (error) {
    connectionStatus.textContent = `Error: ${error}`;
    logger.error("Connection error:", error);
    return;
  }

  const groups = await client.getServerGroups();

  joinGroupButton.addEventListener("click", async () => {
    client.joinGroup(groups[0].groupId);
    logger.log(`Joined group: ${groups[0].groupId}`);
  });
  leaveGroupButton.addEventListener("click", async () => {
    client.unjoinGroup();
    logger.log("Left group");
  });

  availableGroups.innerHTML = `<strong>Available Server Groups:</strong>${groups
    .map((group) => `<code>${group.groupId}</code>`)
    .join(", ")}`;
});
stopButton.addEventListener("click", () => {
  if (!client) {
    logger.error("No client connected to stop playback");
    return;
  }
  if (!client.sessionInfo) {
    logger.error("No active session to stop");
    return;
  }
  client.sendStreamCommand("stop");
});
