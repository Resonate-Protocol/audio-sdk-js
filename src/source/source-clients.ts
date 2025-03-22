import { WebSocket } from "ws";
import { IncomingMessage } from "http";
import { Logger } from "../logging.js";
import { ClientMessages, SourceInfo } from "../messages.js";
import { SourceClient } from "./source-client.js";
import { Source } from "./source.js";

export class SourceClients {
  private clients: Map<string, SourceClient> = new Map();

  constructor(private source: Source, private logger: Logger) {}

  // Generate a unique ID for clients
  private generateUniqueId(): string {
    return `client_${Math.random().toString(36).substring(2, 9)}`;
  }

  // Handle new client connections
  handleConnection(ws: WebSocket, request: IncomingMessage) {
    const clientId = this.generateUniqueId();
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

  // Get source info from Source
  getSourceInfo(): SourceInfo {
    return this.source.getSourceInfo();
  }

  // Handle unknown messages by forwarding to Source
  handleUnknownPlayerMessage(clientId: string, message: ClientMessages) {
    this.source.handleUnknownPlayerMessage(clientId, message);
  }
}
