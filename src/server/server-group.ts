import { Logger } from "../logging.js";
import { SessionInfo } from "../messages.js";
import { EventEmitter } from "../util/event-emitter.js";
import { generateUniqueId } from "../util/unique-id.js";
import { ServerClient } from "./server-client.js";
import { ServerSession } from "./server-session.js";

interface ServerGroupEvents {
  "client-added": ServerClient;
  "client-removed": ServerClient;
  "session-start": ServerSession;
  "session-end": ServerSession;
}

export class ServerGroup extends EventEmitter<ServerGroupEvents> {
  public clients: Map<string, ServerClient> = new Map();
  public activeSession: ServerSession | null = null;
  public groupId = generateUniqueId("group");

  constructor(private readonly logger: Logger) {
    super();
  }

  public get size(): number {
    return this.clients.size;
  }

  public addClient(client: ServerClient) {
    this.clients.set(client.clientId, client);
    this.logger.log(`Client ${client.clientId} added to group ${this.groupId}`);
    this.fire("client-added", client);
  }

  public removeClient(clientId: string) {
    const client = this.clients.get(clientId);
    this.clients.delete(clientId);
    this.fire("client-removed", client);
  }

  startSession(
    codec: string = "pcm",
    sampleRate: number = 44100,
    channels: number = 2,
    bitDepth: number = 16,
  ): ServerSession {
    if (this.activeSession) {
      throw new Error("Session already active");
    }

    const sessionInfo: SessionInfo = {
      session_id: generateUniqueId("session"),
      // Current timestamp in microseconds
      now: Math.round((performance.timeOrigin + performance.now()) * 1000),
      codec,
      sample_rate: sampleRate,
      channels,
      bit_depth: bitDepth,
      codec_header: null,
    };

    this.activeSession = new ServerSession(this, sessionInfo, this.logger);
    this.activeSession.on("session-end", (session) => {
      this.activeSession = null;
      this.logger.log(`Session ${sessionInfo.session_id} ended`);
      this.fire("session-end", session);
    });
    this.logger.log(
      `Session ${sessionInfo.session_id} started for group with ${this.size} clients`,
    );
    this.fire("session-start", this.activeSession);
    return this.activeSession;
  }
}
