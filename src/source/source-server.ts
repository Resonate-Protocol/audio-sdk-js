import { WebSocketServer, WebSocket } from "ws";
import type { Logger } from "../logging.js";
import type { SourceSession } from "./source-session.js";
import { Source } from "./source.js";
import { SourceClient } from "./source-client.js";

export class SourceServer {
  private server: WebSocketServer | null = null;

  constructor(
    private source: Source,
    public port: number,
    private logger: Logger = console,
  ) {}

  // Start the WebSocket server
  start() {
    this.server = new WebSocketServer({ port: this.port });
    this.logger.log(`WebSocket server started on port ${this.port}`);

    this.server.on("connection", this.handleConnection.bind(this));
    this.server.on("error", (error) => {
      this.logger.error("WebSocket server error:", error);
    });
  }

  handleConnection(ws: WebSocket, request: any) {
    const playerClient = new SourceClient(ws, this.logger);
    this.source.addClient(playerClient);
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
