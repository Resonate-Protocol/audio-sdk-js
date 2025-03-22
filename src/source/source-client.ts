import { WebSocket } from "ws";
import { PlayerInfo, ServerMessages, ClientMessages } from "../messages.js";
import { Logger } from "../logging.js";
import { Source } from "./source.js";

export class SourceClient {
  public playerInfo: PlayerInfo | null = null;

  constructor(
    public readonly clientId: string,
    public readonly socket: WebSocket,
    private readonly source: Source,
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
        this.logger.error(`Error parsing message from ${this.clientId}:`, err);
      }
    }
  }

  private processMessage(message: ClientMessages) {
    switch (message.type) {
      case "player/hello":
        this.handlePlayerHello(message.payload as PlayerInfo);
        break;
      // Add other message types as needed
      default:
        this.logger.log(
          `Unhandled message type from ${this.clientId}:`,
          message.type,
        );
        // Forward to source for handling
        this.source.handleUnknownPlayerMessage(this.clientId, message);
    }
  }

  private handlePlayerHello(playerInfo: PlayerInfo) {
    this.playerInfo = playerInfo;
    this.logger.log("Player connected:", playerInfo);

    // Register with source
    this.source.registerPlayer(this);

    // Send source hello back to the player
    this.sendSourceHello();
  }

  sendSourceHello() {
    const sourceHelloMessage = {
      type: "source/hello",
      payload: this.source.getSourceInfo(),
    };

    this.send(sourceHelloMessage);
  }

  send(message: ServerMessages | any) {
    if (this.socket.readyState === WebSocket.OPEN) {
      const messageString =
        typeof message === "string" ? message : JSON.stringify(message);
      this.socket.send(messageString);
      this.logger.log(`Sent to ${this.clientId}:`, message);
    }
  }

  sendBinary(data: ArrayBuffer) {
    if (this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(data);
    }
  }

  private handleClose() {
    this.logger.log(`Player ${this.clientId} disconnected`);
    this.source.removePlayer(this.clientId);
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
