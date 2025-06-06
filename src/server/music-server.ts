import { ServerClient } from "./server-client.js";
import { generateUniqueId } from "../util/unique-id.js";
import { ServerSession } from "./server-session.js";
import type { Logger } from "../logging.js";
import type { ServerInfo, SessionInfo } from "../messages.js";
import { EventEmitter } from "../util/event-emitter.js";

interface ServerEvents {
  "client-added": ServerClient;
  "client-removed": { clientId: string };
  "session-started": ServerSession;
  "session-ended": { sessionId: string };
}

export class MusicServer extends EventEmitter<ServerEvents> {
  private clients: Map<string, ServerClient> = new Map();
  private session: ServerSession | null = null;

  constructor(private serverInfo: ServerInfo, private logger: Logger) {
    super();
  }

  addClient(client: ServerClient) {
    client.send({
      type: "source/hello" as const,
      payload: this.getServerInfo(),
    });
    this.clients.set(client.clientId, client);

    client.on("close", () => {
      this.removeClient(client.clientId);
    });
    client.on("player-state", (state) => {
      console.log(`Unhandled player state from ${client.clientId}:`, state);
    });
    client.on("stream-command", (command) => {
      console.log(`Unhandled stream command from ${client.clientId}:`, command);
    });

    this.logger.log(`Client added: ${client.clientId}`);
    this.fire("client-added", client);
  }

  // Remove a player when they disconnect
  removeClient(clientId: string) {
    this.clients.delete(clientId);
    this.logger.log(`Removed client: ${clientId}`);
    this.fire("client-removed", { clientId });
  }

  // Get a copy of the current clients map
  getClients(): Map<string, ServerClient> {
    return new Map(this.clients);
  }

  // Get number of connected clients
  count(): number {
    return this.clients.size;
  }

  getServerInfo(): ServerInfo {
    return this.serverInfo;
  }

  // Start an audio session
  startSession(
    codec: string = "pcm",
    sampleRate: number = 44100,
    channels: number = 2,
    bitDepth: number = 16,
  ): ServerSession {
    if (this.session) {
      throw new Error("Session already active");
    }

    // Create session info
    const sessionInfo: SessionInfo = {
      session_id: generateUniqueId("session"),
      // Current timestamp in microseconds
      now: Math.round((performance.timeOrigin + performance.now()) * 1000),
      codec,
      sample_rate: sampleRate,
      channels,
      bit_depth: bitDepth,
      codec_header: null,
    };

    // Create new session with current clients
    this.session = new ServerSession(
      sessionInfo,
      this.getClients(),
      this.logger,
      () => {
        // This callback is called when the session ends itself
        this.session = null;
        this.logger.log(`Session ${sessionInfo.session_id} ended`);
        this.fire("session-ended", { sessionId: sessionInfo.session_id });
      },
    );
    this.fire("session-started", this.session);
    return this.session;
  }

  // Get current session if exists
  getSession(): ServerSession | null {
    return this.session;
  }

  handleStreamCommand(clientId: string, command: string) {
    throw new Error("Method not implemented.");
  }
}
