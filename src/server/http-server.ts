import { WebSocketServer, WebSocket } from "ws";
import type { Logger } from "../logging.js";
import { Server } from "./server.js";
import { ServerClient } from "./server-client.js";

export class HTTPServer {
  private websocketServer: WebSocketServer | null = null;

  constructor(
    private server: Server,
    public port: number,
    private logger: Logger = console,
  ) {}

  // Start the WebSocket server
  start() {
    this.websocketServer = new WebSocketServer({ port: this.port });
    this.logger.log(`WebSocket server started on port ${this.port}`);

    this.websocketServer.on("connection", this.handleConnection.bind(this));
    this.websocketServer.on("error", (error) => {
      this.logger.error("WebSocket server error:", error);
    });
  }

  handleConnection(ws: WebSocket, request: any) {
    const playerClient = new ServerClient(ws, this.logger);
    this.server.addClient(playerClient);
  }

  // Stop the WebSocket server
  stop() {
    const session = this.server.getSession();
    if (session) {
      session.end();
    }

    if (this.websocketServer) {
      this.websocketServer.close(() => {
        this.logger.log("WebSocket server closed");
      });
      this.websocketServer = null;
    }
  }
}
