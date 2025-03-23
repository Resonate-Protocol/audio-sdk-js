import { WebSocket } from "ws";
import type {
  PlayerInfo,
  ServerMessages,
  ClientMessages,
} from "../messages.js";
import type { Logger } from "../logging.js";
import type { Source } from "./source.js";
import { generateUniqueId } from "../util/unique-id.js";

export class SourceClient {
  public clientId: string;
  public playerInfo: PlayerInfo | null = null;
  private source?: Source;

  constructor(
    public readonly socket: WebSocket,
    private readonly logger: Logger,
  ) {
    this.clientId = generateUniqueId("client");
    this.socket.on("message", this.handleMessage.bind(this));
    this.socket.on("close", this.handleClose.bind(this));
    this.socket.on("error", this.handleError.bind(this));
  }

  public attachSource(source: Source) {
    this.source = source;
    this.sendSourceHello();
  }

  private handleMessage(message: any, isBinary: boolean) {
    if (isBinary) {
      this.logger.error(
        `Client ${this.clientId} received unexpected binary message`,
      );
      return;
    }
    try {
      const parsedMessage = JSON.parse(message.toString()) as ClientMessages;
      this.logger.log(`Received message from ${this.clientId}:`, parsedMessage);
      this.processMessage(parsedMessage);
    } catch (err) {
      this.logger.error(`Error handling message from ${this.clientId}:`, err);
      this.socket.close(1, "error handling message");
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
    this.logger.log("Player info received:", playerInfo);
  }

  sendSourceHello() {
    if (!this.source) {
      throw new Error("Source not attached");
    }

    const sourceHelloMessage = {
      type: "source/hello" as const,
      payload: this.source.getSourceInfo(),
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
    if (this.source) {
      this.source.removeClient(this.clientId);
      this.source = undefined;
    }
  }

  private handleError(error: Error) {
    this.logger.error(`Player ${this.clientId} error:`, error);
  }

  getPlayerId(): string | null {
    return this.playerInfo?.player_id || null;
  }

  isReady(): boolean {
    return (
      this.socket.readyState === WebSocket.OPEN && this.playerInfo !== null
    );
  }
}
