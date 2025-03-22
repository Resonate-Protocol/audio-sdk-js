import {
  SourceInfo,
  SessionInfo,
  BinaryMessageType,
  SessionEndMessage,
  ServerMessages,
  ClientMessages,
} from "../messages.js";
import { Logger } from "../logging.js";
import { WebSocketServer, WebSocket, Data } from "ws";
import { IncomingMessage } from "http";
import { SourceClient } from "./source-client.js";

export class Source {
  private server: WebSocketServer | null = null;
  private clients: Map<string, SourceClient> = new Map();
  private sessionInfo: SessionInfo | null = null;
  private sourceInfo: SourceInfo;

  constructor(public port: number, private logger: Logger = console) {
    // Initialize source info with default values
    this.sourceInfo = {
      sourceId: this.generateUniqueId(),
      name: "AudioSource",
    };
  }

  private generateUniqueId(): string {
    return `source_${Math.random().toString(36).substring(2, 9)}`;
  }

  // Start the WebSocket server
  start() {
    try {
      this.server = new WebSocketServer({ port: this.port });
      this.logger.log(`WebSocket server started on port ${this.port}`);

      this.server.on("connection", this.handleConnection.bind(this));
      this.server.on("error", (error) => {
        this.logger.error("WebSocket server error:", error);
      });

      return true;
    } catch (err) {
      this.logger.error("Failed to start WebSocket server:", err);
      return false;
    }
  }

  // Handle new client connections
  private handleConnection(ws: WebSocket, request: IncomingMessage) {
    const clientId = this.generateUniqueId();
    const playerClient = new SourceClient(clientId, ws, this, this.logger);
    this.clients.set(clientId, playerClient);
    this.logger.log(`Client connected: ${clientId}`);
  }

  // Register a player after it sends a hello message
  registerPlayer(playerClient: SourceClient) {
    const playerId = playerClient.getPlayerId();
    if (playerId) {
      this.logger.log(`Registered player: ${playerId}`);
    }
  }

  // Remove a player when they disconnect
  removePlayer(clientId: string) {
    this.clients.delete(clientId);
    this.logger.log(`Removed client: ${clientId}`);
  }

  // Get source info for PlayerClient
  getSourceInfo(): SourceInfo {
    return this.sourceInfo;
  }

  // Handle messages that PlayerClient doesn't handle
  handleUnknownPlayerMessage(clientId: string, message: ClientMessages) {
    this.logger.log(`Handling unknown message from ${clientId}:`, message);
    // Handle special messages if needed
  }

  // Broadcast a message to all connected clients
  private broadcastMessage(message: ServerMessages) {
    this.logger.log("Broadcasting:", message);
    for (const client of this.clients.values()) {
      client.send(message);
    }
  }

  // Start an audio session
  startSession(
    codec: string = "pcm",
    sampleRate: number = 44100,
    channels: number = 2,
    bitDepth: number = 16,
  ) {
    if (!this.server) {
      this.logger.error("WebSocket server not started");
      return false;
    }

    if (this.sessionInfo) {
      this.logger.error("Session already active");
      return false;
    }

    // Create session info
    this.sessionInfo = {
      session_id: this.generateUniqueId(),
      now: Date.now(), // Current timestamp in milliseconds
      codec,
      sample_rate: sampleRate,
      channels,
      bit_depth: bitDepth,
      codec_header: null,
    };

    // Send session start message to all players
    const sessionStartMessage = {
      type: "session/start" as const,
      payload: this.sessionInfo,
    };

    this.broadcastMessage(sessionStartMessage);
  }

  // End the audio session
  endSession() {
    if (!this.server) {
      this.logger.error("WebSocket server not started");
      return;
    }

    if (!this.sessionInfo) {
      this.logger.error("No session active");
    }

    // Send session end message
    const sessionEndMessage: SessionEndMessage = {
      type: "session/end",
      payload: {
        sessionId: this.sessionInfo!.session_id,
      },
    };

    this.broadcastMessage(sessionEndMessage);

    this.sessionInfo = null;
  }

  // Send audio data to all players
  sendAudio(audioData: Float32Array[], timestamp: number) {
    if (!this.server) {
      this.logger.error("WebSocket server not started");
      return;
    }

    if (!this.sessionInfo) {
      this.logger.error("No active session");
      return;
    }

    const {
      channels,
      sample_rate: sampleRate,
      bit_depth: bitDepth,
      codec,
    } = this.sessionInfo;

    // Validate input
    if (audioData.length !== channels) {
      this.logger.error(
        `Channel mismatch: expected ${channels}, got ${audioData.length}`,
      );
      return;
    }

    // Get sample count from first channel's length
    const sampleCount = audioData[0].length;

    // Calculate header size and total message size
    const headerSize = 13;
    const bytesPerSample = bitDepth / 8;
    const dataSize = sampleCount * channels * bytesPerSample;
    const totalSize = headerSize + dataSize;

    // Create the binary message buffer
    const buffer = new ArrayBuffer(totalSize);
    const dataView = new DataView(buffer);

    // Write header
    dataView.setUint8(0, BinaryMessageType.PlayAudioChunk); // Message type
    dataView.setBigUint64(1, BigInt(timestamp), false);
    dataView.setUint32(9, sampleCount, false); // Sample count (big-endian)

    // Write audio data
    for (let i = 0; i < sampleCount; i++) {
      for (let channel = 0; channel < channels; channel++) {
        // Convert float [-1,1] to int16 [-32768,32767]
        const sample = Math.max(-1, Math.min(1, audioData[channel][i]));
        const sampleInt = Math.round(sample * 32767);

        // Write the sample to the buffer (little-endian)
        const offset = headerSize + (i * channels + channel) * bytesPerSample;
        dataView.setInt16(offset, sampleInt, true);
      }
    }

    // Broadcast the binary message to all clients
    for (const client of this.clients.values()) {
      client.sendBinary(buffer);
    }
    this.logger.log(
      `Broadcasted audio chunk: ${sampleCount} samples at timestamp ${timestamp}ms to ${this.clients.size} clients`,
    );
  }

  // Create and send a PCM audio chunk from raw samples
  sendPCMAudioChunk(
    pcmData: Int16Array | Float32Array,
    timestamp: number = Date.now(),
  ) {
    if (!this.sessionInfo) {
      this.logger.error("No active session");
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

    this.sendAudio(floatData, timestamp);
  }

  // Stop the WebSocket server
  stop() {
    if (this.sessionInfo) {
      this.endSession();
    }

    if (this.server) {
      this.server.close(() => {
        this.logger.log("WebSocket server closed");
      });
      this.server = null;
    }

    this.clients.clear();
  }
}
