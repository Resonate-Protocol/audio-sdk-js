import { SourceInfo, ClientMessages } from "../messages.js";
import { Logger } from "../logging.js";
import { WebSocketServer } from "ws";
import { SourceClient } from "./source-client.js";
import { SourceSession } from "./source-session.js";
import { Source } from "./source.js";
import { generateUniqueId } from "../util/unique-id.js";

export class SourceServer {
  private server: WebSocketServer | null = null;
  private source: Source;

  constructor(
    name: string,
    public port: number,
    private logger: Logger = console,
  ) {
    this.source = new Source(
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
      this.source.handleConnection(ws, request),
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

  // Start an audio session - delegates to Source
  startSession(
    codec: string = "pcm",
    sampleRate: number = 44100,
    channels: number = 2,
    bitDepth: number = 16,
  ): SourceSession {
    if (!this.server) {
      throw new Error("WebSocket server not started");
    }

    return this.source.startSession(codec, sampleRate, channels, bitDepth);
  }

  // Stop the WebSocket server
  stop() {
    const session = this.source.getSession();
    if (session) {
      session.end();
    }

    if (this.server) {
      this.server.close(() => {
        this.logger.log("WebSocket server closed");
      });
      this.server = null;
    }
  }
}
