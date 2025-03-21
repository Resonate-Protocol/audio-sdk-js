import {
  SourceInfo,
  SessionInfo,
  PlayerInfo,
  BinaryMessageType,
  CODEC_MAP,
} from "./messages";
import { Logger } from "./logging";

export class Source {
  private ws: WebSocket | null = null;
  private players: Map<string, PlayerInfo> = new Map();
  private sessionActive: boolean = false;
  private sessionInfo: SessionInfo | null = null;
  private sourceInfo: SourceInfo;

  constructor(public url: string, private logger: Logger = console) {
    // Initialize source info with default values
    this.sourceInfo = {
      sourceId: this.generateUniqueId(),
      name: "AudioSource",
    };
  }

  private generateUniqueId(): string {
    return `source_${Math.random().toString(36).substring(2, 9)}`;
  }

  // Connect to the WebSocket server
  connect() {
    this.ws = new WebSocket(this.url);
    this.ws.binaryType = "arraybuffer";

    this.ws.onopen = () => {
      this.logger.log("WebSocket connected");
    };

    this.ws.onmessage = (event) => {
      if (typeof event.data === "string") {
        try {
          const message = JSON.parse(event.data);
          this.handleMessage(message);
        } catch (err) {
          this.logger.error("Error parsing message", err);
        }
      }
    };

    this.ws.onerror = (error) => {
      this.logger.error("WebSocket error:", error);
    };

    this.ws.onclose = () => {
      this.logger.log("WebSocket connection closed");
      this.sessionActive = false;
      this.sessionInfo = null;
    };
  }

  // Handle incoming messages from players
  handleMessage(message: any) {
    this.logger.log("Received message:", message);

    switch (message.type) {
      case "player/hello":
        this.handlePlayerHello(message.payload);
        break;
      default:
        this.logger.log("Unhandled message type:", message.type);
    }
  }

  // Handle player hello message
  handlePlayerHello(playerInfo: PlayerInfo) {
    this.logger.log("Player connected:", playerInfo);

    // Store player information
    this.players.set(playerInfo.playerId, playerInfo);

    // Send source hello
    this.sendSourceHello(playerInfo.playerId);
  }

  // Send source hello message to player
  sendSourceHello(playerId: string) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.logger.error("WebSocket not connected");
      return;
    }

    const sourceHelloMessage = {
      type: "source/hello",
      payload: this.sourceInfo,
    };

    this.ws.send(JSON.stringify(sourceHelloMessage));
    this.logger.log("Sent source/hello:", sourceHelloMessage);
  }

  // Start an audio session
  startSession(
    codec: string = "pcm",
    sampleRate: number = 44100,
    channels: number = 2,
    bitDepth: number = 16,
  ) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.logger.error("WebSocket not connected");
      return false;
    }

    if (this.sessionActive) {
      this.logger.error("Session already active");
      return false;
    }

    // Create session info
    this.sessionInfo = {
      sessionId: this.generateUniqueId(),
      now: Date.now(), // Current timestamp in milliseconds
      codec,
      sampleRate,
      channels,
      bitDepth,
    };

    // Send session start message
    const sessionStartMessage = {
      type: "session/start",
      payload: this.sessionInfo,
    };

    this.ws.send(JSON.stringify(sessionStartMessage));
    this.logger.log("Sent session/start:", sessionStartMessage);

    this.sessionActive = true;
    return true;
  }

  // End the audio session
  endSession() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.logger.error("WebSocket not connected");
      return;
    }

    if (!this.sessionActive) {
      this.logger.error("No active session");
      return;
    }

    // Send session end message
    const sessionEndMessage = {
      type: "session/end",
      payload: {
        sessionId: this.sessionInfo?.sessionId,
      },
    };

    this.ws.send(JSON.stringify(sessionEndMessage));
    this.logger.log("Sent session/end:", sessionEndMessage);

    this.sessionActive = false;
    this.sessionInfo = null;
  }

  // Send audio data to player
  sendAudio(audioData: Float32Array[], timestamp: number) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.logger.error("WebSocket not connected");
      return;
    }

    if (!this.sessionActive || !this.sessionInfo) {
      this.logger.error("No active session");
      return;
    }

    const { channels, sampleRate, bitDepth, codec } = this.sessionInfo;

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
      this.logger.error(`Unknown codec: ${codec}`);
      return;
    }

    // Get sample count from first channel's length
    const sampleCount = audioData[0].length;

    // Calculate header size and total message size
    const headerSize = 10;
    const bytesPerSample = bitDepth / 8;
    const dataSize = sampleCount * channels * bytesPerSample;
    const totalSize = headerSize + dataSize;

    // Create the binary message buffer
    const buffer = new ArrayBuffer(totalSize);
    const dataView = new DataView(buffer);

    // Write header
    dataView.setUint8(0, BinaryMessageType.PlayAudioChunk); // Message type
    dataView.setUint8(1, codecByteValue); // Codec
    dataView.setUint32(2, timestamp, false); // Timestamp (big-endian)
    dataView.setUint32(6, sampleCount, false); // Sample count (big-endian)

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

    // Send the binary message
    this.ws.send(buffer);
    this.logger.log(
      `Sent audio chunk: ${sampleCount} samples at timestamp ${timestamp}ms`,
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

  // Disconnect from the WebSocket server
  disconnect() {
    if (this.sessionActive) {
      this.endSession();
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.players.clear();
  }
}
