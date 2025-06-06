import {
  SessionInfo,
  BinaryMessageType,
  SessionEndMessage,
  Metadata,
  ServerMessages,
} from "../messages.js";
import type { Logger } from "../logging.js";
import { ServerClient } from "./server-client.js";

const HEADER_SIZE = 13;

export class ServerSession {
  sessionActive: Set<string> = new Set();

  private _lastReportedMetadata: Metadata | null = null;
  private _lastReportedArt: Buffer<ArrayBuffer> | null = null;

  constructor(
    private readonly sessionInfo: SessionInfo,
    private readonly clients: Map<string, ServerClient>,
    private readonly logger: Logger,
    private readonly onSessionEnd: () => void,
  ) {}

  // TODO we should extract a ServerGroup class that handles group member actions
  // like join, unjoin etc.
  public addClient(client: ServerClient) {
    this.clients.set(client.clientId, client);
    // TODO update metadata on all clients with group members
    this.logger.log(
      `Client ${client.clientId} added to session ${this.sessionInfo.session_id}`,
    );
  }

  public sendMetadata(metadata: Metadata) {
    // we are going to send the whole metadata object if we didn't share one yet
    // otherwise only include the keys that are different from the last reported metadata
    let payload: Partial<Metadata>;

    if (!this._lastReportedMetadata) {
      payload = metadata;
    } else {
      payload = {};
      // Find updated fields
      for (const key in metadata) {
        // TODO this does not work for values that are lists: group_members, support_commands
        // @ts-ignore
        if (this._lastReportedMetadata[key] !== metadata[key]) {
          // @ts-ignore
          payload[key] = metadata[key];
        }
      }
      if (Object.keys(payload).length === 0) {
        return;
      }
    }
    this.sendMessage({
      type: "metadata/update",
      payload,
    });
    this._lastReportedMetadata = this._lastReportedMetadata
      ? {
          ...this._lastReportedMetadata,
          ...payload,
        }
      : metadata;
  }

  public end() {
    const sessionEndMessage: SessionEndMessage = {
      type: "session/end",
      payload: {
        sessionId: this.sessionInfo.session_id,
      },
    };
    // Send session end message to all active clients
    // Avoid sendMessage as it can activate clients
    for (const clientId of this.sessionActive) {
      const client = this.clients.get(clientId);
      if (client && client.isReady()) {
        client.send(sessionEndMessage);
      }
    }
    this.sessionActive.clear();
    this._lastReportedMetadata = null;
    this._lastReportedArt = null;
    this.onSessionEnd();
  }

  public writeAudioPacketHeader(
    data: DataView,
    timestamp: number,
    sampleCount: number,
  ) {
    data.setUint8(0, BinaryMessageType.PlayAudioChunk); // Message type
    data.setBigInt64(1, BigInt(timestamp), false);
    data.setUint32(9, sampleCount, false); // Sample count (big-endian)
  }

  private *_readyClients() {
    for (const client of this.clients.values()) {
      if (!client.isReady()) {
        this.logger.log(`Client ${client.clientId} not ready, skipping`);
        if (this.sessionActive.has(client.clientId)) {
          this.sessionActive.delete(client.clientId);
        }
        continue;
      }
      if (!this.sessionActive.has(client.clientId)) {
        client.send({
          type: "session/start" as const,
          payload: this.sessionInfo,
        });
        if (this._lastReportedMetadata) {
          client.send({
            type: "metadata/update" as const,
            payload: this._lastReportedMetadata,
          });
        }
        if (this._lastReportedArt) {
          client.sendBinary(this._lastReportedArt);
        }
        this.sessionActive.add(client.clientId);
      }
      yield client;
    }
  }

  public sendMessage(message: ServerMessages) {
    for (const client of this._readyClients()) {
      client.send(message);
    }
  }

  sendBinary(buffer: ArrayBuffer) {
    for (const client of this._readyClients()) {
      client.sendBinary(buffer);
    }
  }

  // Create and send a PCM audio chunk from raw samples
  sendPCMAudioChunk(
    pcmData: Int16Array | Float32Array,
    timestamp: number = Date.now(),
  ) {
    if (!this.clients.size) {
      this.logger.log("No active clients, skipping audio chunk");
      return;
    }

    // Convert to Float32Array format if it's Int16Array
    let floatData: Float32Array[];

    if (pcmData instanceof Int16Array) {
      // Convert interleaved Int16Array to multichannel Float32Arrays
      const { channels } = this.sessionInfo;
      const samplesPerChannel = Math.floor(pcmData.length / channels);

      floatData = Array(channels)
        .fill(null)
        .map(() => new Float32Array(samplesPerChannel));

      for (let i = 0; i < samplesPerChannel; i++) {
        for (let ch = 0; ch < channels; ch++) {
          floatData[ch][i] = pcmData[i * channels + ch] / 32768;
        }
      }
    } else {
      // Assume mono if Float32Array is provided directly
      floatData = [pcmData];
    }

    const { channels, bit_depth: bitDepth } = this.sessionInfo;

    // Validate input
    if (floatData.length !== channels) {
      throw new Error(
        `Channel mismatch: expected ${channels}, got ${floatData.length}`,
      );
    }

    // Get sample count from first channel's length
    const sampleCount = floatData[0].length;

    // Calculate header size and total message size
    const bytesPerSample = bitDepth / 8;
    const dataSize = sampleCount * channels * bytesPerSample;
    const totalSize = HEADER_SIZE + dataSize;

    // Create the binary message buffer
    const buffer = new ArrayBuffer(totalSize);
    const dataView = new DataView(buffer);

    this.writeAudioPacketHeader(dataView, timestamp, sampleCount);

    // Write audio data
    for (let i = 0; i < sampleCount; i++) {
      for (let channel = 0; channel < channels; channel++) {
        // Convert float [-1,1] to int16 [-32768,32767]
        const sample = Math.max(-1, Math.min(1, floatData[channel][i]));
        const sampleInt = Math.round(sample * 32767);

        // Write the sample to the buffer (little-endian)
        const offset = HEADER_SIZE + (i * channels + channel) * bytesPerSample;
        dataView.setInt16(offset, sampleInt, true);
      }
    }

    this.sendBinary(buffer);
    this.logger.log(
      `Broadcasted audio chunk: ${floatData[0].length} samples at timestamp ${timestamp}ms to ${this.sessionActive.size} clients`,
    );
  }

  public sendMediaArt(format: string, data: Buffer<ArrayBufferLike>) {
    // turn blob format jpeg = 0, png = 1
    const mediaArtType = format.startsWith("image/jpeg")
      ? 0
      : format.startsWith("image/png")
      ? 1
      : -1;

    if (mediaArtType === -1) {
      throw new Error(`Unknown art format ${format}`);
    }

    const header = Buffer.from([BinaryMessageType.MediaArt, mediaArtType]);
    const body = Buffer.from(data);
    const artMessage = Buffer.concat([header, body]);
    this.sendBinary(artMessage);
    this._lastReportedArt = artMessage;
    this.logger.log(
      `Broadcasted media art of type ${mediaArtType} to ${this.sessionActive.size} clients`,
    );
  }

  getInfo(): SessionInfo {
    return this.sessionInfo;
  }
}
