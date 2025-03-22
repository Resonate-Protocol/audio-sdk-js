import {
  SourceInfo,
  SessionInfo,
  ServerMessages,
  ClientMessages,
} from "../messages.js";
import { Logger } from "../logging.js";
import { WebSocketServer, WebSocket } from "ws";
import { IncomingMessage } from "http";
import { SourceClient } from "./source-client.js";
import { SourceSession } from "./source-session.js";

export class Source {
  private server: WebSocketServer | null = null;
  private clients: Map<string, SourceClient> = new Map();
  private session: SourceSession | null = null;
  private sourceInfo: SourceInfo;

  constructor(public port: number, private logger: Logger = console) {
    // Initialize source info with default values
    this.sourceInfo = {
      sourceId: this.generateUniqueId(),
      name: "AudioSource",
    };
  }

  private generateUniqueId(): string {
    return `source_${Math.random().toString(36).substring(2, 9)}`;
  }

  // Start the WebSocket server
  start() {
    try {
      this.server = new WebSocketServer({ port: this.port });
      this.logger.log(`WebSocket server started on port ${this.port}`);

      this.server.on("connection", this.handleConnection.bind(this));
      this.server.on("error", (error) => {
        this.logger.error("WebSocket server error:", error);
      });

      return true;
    } catch (err) {
      this.logger.error("Failed to start WebSocket server:", err);
      return false;
    }
  }

  // Handle new client connections
  private handleConnection(ws: WebSocket, request: IncomingMessage) {
    const clientId = this.generateUniqueId();
    const playerClient = new SourceClient(clientId, ws, this, this.logger);
    this.clients.set(clientId, playerClient);
    this.logger.log(`Client connected: ${clientId}`);
  }

  // Register a player after it sends a hello message
  registerPlayer(playerClient: SourceClient) {
    const playerId = playerClient.getPlayerId();
    if (playerId) {
      this.logger.log(`Registered player: ${playerId}`);
    }
  }

  // Remove a player when they disconnect
  removePlayer(clientId: string) {
    this.clients.delete(clientId);
    this.logger.log(`Removed client: ${clientId}`);
  }

  getSourceInfo(): SourceInfo {
    return this.sourceInfo;
  }

  // Handle messages that PlayerClient doesn't handle
  handleUnknownPlayerMessage(clientId: string, message: ClientMessages) {
    this.logger.log(`Handling unknown message from ${clientId}:`, message);
    // Handle special messages if needed
  }

  // Start an audio session
  startSession(
    codec: string = "pcm",
    sampleRate: number = 44100,
    channels: number = 2,
    bitDepth: number = 16,
  ): SourceSession {
    if (!this.server) {
      throw new Error("WebSocket server not started");
    }

    if (this.session) {
      throw new Error("Session already active");
    }

    // Create session info
    const sessionInfo: SessionInfo = {
      session_id: this.generateUniqueId(),
      now: Date.now(), // Current timestamp in milliseconds
      codec,
      sample_rate: sampleRate,
      channels,
      bit_depth: bitDepth,
      codec_header: null,
    };

    // Create new session
    this.session = new SourceSession(
      sessionInfo,
      this.clients,
      this.logger,
      () => {
        // This callback is called when the session ends itself
        this.session = null;
      },
    );

    return this.session;
  }

  // Stop the WebSocket server
  stop() {
    if (this.session) {
      this.session.end();
    }

    if (this.server) {
      this.server.close(() => {
        this.logger.log("WebSocket server closed");
      });
      this.server = null;
    }

    this.clients.clear();
  }
}
