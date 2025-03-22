import { WebSocket } from "ws";
import { SourceClient } from "./source-client.js";
import { generateUniqueId } from "../util/unique-id.js";
import { SourceSession } from "./source-session.js";
import type { IncomingMessage } from "http";
import type { Logger } from "../logging.js";
import type { SourceInfo, SessionInfo } from "../messages.js";

export class Source {
  private clients: Map<string, SourceClient> = new Map();
  private session: SourceSession | null = null;

  constructor(private sourceInfo: SourceInfo, private logger: Logger) {}

  // Handle new client connections
  handleConnection(ws: WebSocket, request: IncomingMessage) {
    const clientId = generateUniqueId("client");
    const playerClient = new SourceClient(clientId, ws, this, this.logger);
    this.clients.set(clientId, playerClient);
    this.logger.log(`Client connected: ${clientId}`);
  }

  // Remove a player when they disconnect
  removePlayer(clientId: string) {
    this.clients.delete(clientId);
    this.logger.log(`Removed client: ${clientId}`);
  }

  // Get a copy of the current clients map
  getClients(): Map<string, SourceClient> {
    return new Map(this.clients);
  }

  // Get number of connected clients
  count(): number {
    return this.clients.size;
  }

  getSourceInfo(): SourceInfo {
    return this.sourceInfo;
  }

  // Start an audio session
  startSession(
    codec: string = "pcm",
    sampleRate: number = 44100,
    channels: number = 2,
    bitDepth: number = 16,
  ): SourceSession {
    if (this.session) {
      throw new Error("Session already active");
    }

    // Create session info
    const sessionInfo: SessionInfo = {
      session_id: generateUniqueId("session"),
      now: Date.now(), // Current timestamp in milliseconds
      codec,
      sample_rate: sampleRate,
      channels,
      bit_depth: bitDepth,
      codec_header: null,
    };

    // Create new session with current clients
    this.session = new SourceSession(
      sessionInfo,
      this.getClients(),
      this.logger,
      () => {
        // This callback is called when the session ends itself
        this.session = null;
      },
    );

    return this.session;
  }

  // Get current session if exists
  getSession(): SourceSession | null {
    return this.session;
  }
}
