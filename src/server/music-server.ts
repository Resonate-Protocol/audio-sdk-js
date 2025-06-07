import { ServerClient } from "./server-client.js";
import { generateUniqueId } from "../util/unique-id.js";
import { ServerSession } from "./server-session.js";
import type { Logger } from "../logging.js";
import type { ServerInfo, SessionInfo } from "../messages.js";
import { EventEmitter } from "../util/event-emitter.js";
import { ServerGroup } from "./server-group.js";

interface MusicServerEvents {
  "client-added": ServerClient;
  "client-removed": ServerClient;
}

export class MusicServer extends EventEmitter<MusicServerEvents> {
  private clients: Map<string, ServerClient> = new Map();
  private groups: Array<ServerGroup> = [];

  constructor(private serverInfo: ServerInfo, private logger: Logger) {
    super();
  }

  addClient(client: ServerClient) {
    client.send({
      type: "source/hello" as const,
      payload: this.serverInfo,
    });
    // TODO only do next steps if client gives proper response.
    this.clients.set(client.clientId, client);

    client.on("close", () => {
      this.clients.delete(client.clientId);
      for (const group of this.groups) {
        if (group.clients.has(client.clientId)) {
          group.removeClient(client.clientId);
        }
      }
      this.fire("client-removed", client);
    });

    // TODO listen to group-join, group-leave commands

    this.fire("client-added", client);
  }

  public createGroup(): ServerGroup {
    const group = new ServerGroup(this.logger);
    this.groups.push(group);
    return group;
  }

  public stop() {
    for (const group of this.groups) {
      if (group.activeSession) {
        group.activeSession.end();
      }
    }
  }
}
