import { SourceInfo, SessionInfo, ClientMessages } from "../messages.js";
import { Logger } from "../logging.js";
import { WebSocketServer } from "ws";
import { SourceClient } from "./source-client.js";
import { SourceSession } from "./source-session.js";
import { Source } from "./source.js";
import { generateUniqueId } from "../util/unique-id.js";

export class SourceServer {
  private server: WebSocketServer | null = null;
  private clients: Source;
  private session: SourceSession | null = null;

  constructor(
    name: string,
    public port: number,
    private logger: Logger = console,
  ) {
    this.clients = new Source(
      {
        source_id: generateUniqueId("source"),
        name,
      },
      logger,
    );
  }

  // Start the WebSocket server
  start() {
    this.server = new WebSocketServer({ port: this.port });
    this.logger.log(`WebSocket server started on port ${this.port}`);

    this.server.on("connection", (ws, request) =>
      this.clients.handleConnection(ws, request),
    );
    this.server.on("error", (error) => {
      this.logger.error("WebSocket server error:", error);
    });
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
      session_id: generateUniqueId("session"),
      now: Date.now(), // Current timestamp in milliseconds
      codec,
      sample_rate: sampleRate,
      channels,
      bit_depth: bitDepth,
      codec_header: null,
    };

    // Create new session with current clients from sourcePlayers
    this.session = new SourceSession(
      sessionInfo,
      this.clients.getClients(),
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
  }
}
