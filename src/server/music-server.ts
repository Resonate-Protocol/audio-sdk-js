import { ServerClient } from "./server-client.js";
import type { Logger } from "../logging.js";
import type { ServerInfo } from "../messages.js";
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

  async addClient(client: ServerClient) {
    try {
      await client.accept(this.serverInfo);
    } catch (error) {
      this.logger.error(`Error adding client ${client.clientId}:`, error);
      client.socket.close(1008, "Invalid client");
      return;
    }
    this.logger.log(`Client ${client.clientId} accepted`);

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

    client.on("group-command", (command) => {
      if (command.command === "unjoin") {
        for (const group of this.groups) {
          if (group.clients.has(client.clientId)) {
            group.removeClient(client.clientId);
            this.logger.log(
              `Client ${client.clientId} unjoined group ${group.groupId}`,
            );
            break;
          }
        }
      } else if (command.command === "join") {
        const group = this.groups.find((g) => g.groupId === command.groupId);
        if (group) {
          group.addClient(client);
          this.logger.log(
            `Client ${client.clientId} joined group ${group.groupId}`,
          );
        } else {
          this.logger.error(
            `Client ${client.clientId} tried to join non-existent group ${command.groupId}`,
          );
        }
      } else if (command.command === "list") {
        client.send({
          type: "group/list",
          payload: {
            groups: this.groups.map((g) => ({
              groupId: g.groupId,
              state: g.activeSession ? "playing" : "idle",
            })),
          },
        });
      }
    });

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
