import { WebSocket } from "ws";
import type {
  PlayerInfo,
  PlayerTimeInfo,
  ServerMessages,
  ClientMessages,
  PlayerState,
  StreamCommandMessage,
} from "../messages.js";
import type { Logger } from "../logging.js";
import { generateUniqueId } from "../util/unique-id.js";
import { EventEmitter } from "../util/event-emitter.js";

interface ServerClientEvents {
  close: void;
  "player-state": PlayerState | null;
  "stream-command": StreamCommandMessage["payload"];
}

export class ServerClient extends EventEmitter<ServerClientEvents> {
  public clientId: string;
  public playerInfo: PlayerInfo | null = null;
  public playerState: PlayerState | null = null;

  constructor(
    public readonly socket: WebSocket,
    private readonly logger: Logger,
  ) {
    super();
    this.clientId = generateUniqueId("client");
    this.logger.log(`Client ${this.clientId} connected`);
    this.socket.on("message", this.handleMessage.bind(this));
    this.socket.on("close", this.handleClose.bind(this));
    this.socket.on("error", this.handleError.bind(this));
  }

  private handleMessage(message: any, isBinary: boolean) {
    if (isBinary) {
      this.logger.error(
        `Client ${this.clientId} received unexpected binary message`,
      );
      return;
    }
    try {
      this.processMessage(JSON.parse(message.toString()));
    } catch (err) {
      this.logger.error(`Error handling message from ${this.clientId}:`, err);
      this.socket.close(1, "error handling message");
    }
  }

  private processMessage(message: ClientMessages) {
    if (message.type === "player/hello") {
      this.handlePlayerHello(message.payload);
      return;
    }

    if (!this.playerInfo) {
      this.logger.error(
        `Client ${this.clientId} sent message before player hello`,
      );
      return;
    }

    switch (message.type) {
      case "stream/command":
        this.fire("stream-command", message.payload);
        break;

      case "player/state":
        this.playerState = message.payload;
        this.fire("player-state", message.payload);
        break;
      case "player/time":
        this.handlePlayerTime(message.payload);
        break;
      default:
        this.logger.log(
          `Unhandled message type from ${this.clientId}:`,
          // @ts-expect-error
          message.type,
        );
    }
  }

  private handlePlayerHello(playerInfo: PlayerInfo) {
    this.playerInfo = playerInfo;
    this.logger.log("Player info received:", playerInfo);
  }

  private handlePlayerTime(playerTimeInfo: PlayerTimeInfo) {
    const timeResponseMessage = {
      type: "source/time" as const,
      payload: {
        player_transmitted: playerTimeInfo.player_transmitted,
        source_received: Math.round(
          (performance.timeOrigin + performance.now()) * 1000,
        ),
        source_transmitted: Math.round(
          (performance.timeOrigin + performance.now()) * 1000,
        ),
      },
    };
    this.send(timeResponseMessage);
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
    this.logger.log(`Client ${this.clientId} disconnected`);
    this.fire("close");
  }

  private handleError(error: Error) {
    this.logger.error(`Client ${this.clientId} error:`, error);
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
