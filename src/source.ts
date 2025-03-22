import {
  SourceInfo,
  SessionInfo,
  PlayerInfo,
  BinaryMessageType,
  CODEC_MAP,
  SessionEndMessage,
  ServerMessages,
  ClientMessages,
} from "./messages.js";
import { Logger } from "./logging.js";
import { WebSocketServer, WebSocket, Data } from "ws";
import { IncomingMessage } from "http";

interface ExtendedPlayerInfo extends PlayerInfo {
  clientId: string;
}

export class Source {
  private server: WebSocketServer | null = null;
  private clients: Map<string, WebSocket> = new Map();
  private players: Map<string, ExtendedPlayerInfo> = new Map();
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
    this.clients.set(clientId, ws);
    this.logger.log(`Client connected: ${clientId}`);

    ws.on("message", (message) => {
      this.handleClientMessage(clientId, ws, message);
    });

    ws.on("close", () => {
      this.logger.log(`Client disconnected: ${clientId}`);
      this.clients.delete(clientId);

      // Find and remove any associated player
      for (const [playerId, playerInfo] of this.players.entries()) {
        if (playerInfo.clientId === clientId) {
          this.players.delete(playerId);
          break;
        }
      }
    });

    ws.on("error", (error) => {
      this.logger.error(`Client ${clientId} error:`, error);
    });
  }

  // Handle incoming messages from clients
  private handleClientMessage(clientId: string, ws: WebSocket, message: Data) {
    if (typeof message === "string") {
      try {
        const parsedMessage = JSON.parse(message);
        this.logger.log(`Received message from ${clientId}:`, parsedMessage);
        this.handleMessage(clientId, ws, parsedMessage);
      } catch (err) {
        this.logger.error(`Error parsing message from ${clientId}:`, err);
      }
    }
  }

  // Handle parsed messages
  handleMessage(clientId: string, ws: WebSocket, message: ClientMessages) {
    switch (message.type) {
      case "player/hello":
        const playerInfo = message.payload as ExtendedPlayerInfo;
        playerInfo.clientId = clientId; // Associate client ID with player
        this.handlePlayerHello(ws, playerInfo);
        break;
      default:
        this.logger.log("Unhandled message type:", message.type);
    }
  }

  // Handle player hello message
  handlePlayerHello(ws: WebSocket, playerInfo: ExtendedPlayerInfo) {
    this.logger.log("Player connected:", playerInfo);

    // Store player information
    this.players.set(playerInfo.player_id, playerInfo);

    // Send source hello
    this.sendSourceHello(ws, playerInfo.player_id);
  }

  // Send source hello message to player
  sendSourceHello(ws: WebSocket, playerId: string) {
    const sourceHelloMessage = {
      type: "source/hello",
      payload: this.sourceInfo,
    };

    ws.send(JSON.stringify(sourceHelloMessage));
    this.logger.log("Sent source/hello:", sourceHelloMessage);
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

  // Broadcast a message to all connected clients
  private broadcastMessage(message: ServerMessages) {
    this.logger.log("Broadcasted:", message);
    const messageString = JSON.stringify(message);
    for (const ws of this.clients.values()) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(messageString);
      }
    }
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

    // Find codec byte value
    let codecByteValue: number | undefined;
    for (const [key, value] of Object.entries(CODEC_MAP)) {
      if (value === codec) {
        codecByteValue = Number(key);
        break;
      }
    }

    if (codecByteValue === undefined) {
      this.logger.error("Invalid codec:", codec);
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
    for (const ws of this.clients.values()) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(buffer);
      }
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
    this.players.clear();
  }
}
