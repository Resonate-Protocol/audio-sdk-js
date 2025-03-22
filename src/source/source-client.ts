import { WebSocket } from "ws";
import type {
  PlayerInfo,
  ServerMessages,
  ClientMessages,
} from "../messages.js";
import type { Logger } from "../logging.js";
import type { Source } from "./source.js";

export class SourceClient {
  public playerInfo: PlayerInfo | null = null;

  constructor(
    public readonly clientId: string,
    public readonly socket: WebSocket,
    private readonly sourceClients: Source,
    private readonly logger: Logger,
  ) {
    this.socket.on("message", this.handleMessage.bind(this));
    this.socket.on("close", this.handleClose.bind(this));
    this.socket.on("error", this.handleError.bind(this));
  }

  private handleMessage(message: any) {
    if (typeof message === "string") {
      try {
        const parsedMessage = JSON.parse(message) as ClientMessages;
        this.logger.log(
          `Received message from ${this.clientId}:`,
          parsedMessage,
        );
        this.processMessage(parsedMessage);
      } catch (err) {
        this.logger.error(`Error handling message from ${this.clientId}:`, err);
        this.socket.close(1, "error handling message");
      }
    }
  }

  private processMessage(message: ClientMessages) {
    switch (message.type) {
      case "player/hello":
        this.handlePlayerHello(message.payload);
        break;

      default:
        this.logger.log(
          `Unhandled message type from ${this.clientId}:`,
          message.type,
        );
    }
  }

  private handlePlayerHello(playerInfo: PlayerInfo) {
    this.playerInfo = playerInfo;
    this.logger.log("Player connected:", playerInfo);
    this.sendSourceHello();
  }

  sendSourceHello() {
    const sourceHelloMessage = {
      type: "source/hello" as const,
      payload: this.sourceClients.getSourceInfo(),
    };

    this.send(sourceHelloMessage);
  }

  send(message: ServerMessages) {
    if (this.socket.readyState !== WebSocket.OPEN) {
      throw new Error("Client not connected");
    }
    this.socket.send(JSON.stringify(message));
    this.logger.log(`Sent to ${this.clientId}:`, message);
  }

  sendBinary(data: ArrayBuffer) {
    if (this.socket.readyState !== WebSocket.OPEN) {
      throw new Error("Client not connected");
    }
    this.socket.send(data);
  }

  private handleClose() {
    this.logger.log(`Player ${this.clientId} disconnected`);
    this.sourceClients.removePlayer(this.clientId);
  }

  private handleError(error: Error) {
    this.logger.error(`Player ${this.clientId} error:`, error);
  }

  getPlayerId(): string | null {
    return this.playerInfo?.player_id || null;
  }

  isReady(): boolean {
    return (
      this.playerInfo !== null && this.socket.readyState === WebSocket.OPEN
    );
  }
}
