import {
  ServerInfo,
  SessionInfo,
  ServerMessages,
  BinaryMessageType,
  PlayerHelloMessage,
  Metadata,
  ServerTimeInfo,
  PlayerTimeMessage,
} from "../messages.js";
import type { Logger } from "../logging.js";
import { EventEmitter } from "../util/event-emitter.js";

type Events = {
  open: void;
  close: { expected: boolean };
  "server-update": ServerInfo | null;
  "session-update": SessionInfo | null;
  "metadata-update": Metadata | null;
  "art-update": { data: Blob } | null;
};

export interface PlayerOptions {
  playerId: string;
  url: string;
  logger?: Logger;
}

// Use standard AudioContext or fallback to webkitAudioContext
const AudioContextClass = window.AudioContext || window.webkitAudioContext;

const MIN_TIME_DIFF_SAMPLES = 20; // Minimum number of samples we want to have

// Maximum number of samples to keep for time diff calculation
const MAX_TIME_DIFF_SAMPLES = 50;

export class Client extends EventEmitter<Events> {
  private options: PlayerOptions;
  private logger: Logger = console;
  private ws: WebSocket | null = null;
  private serverInfo: ServerInfo | null = null;
  private sessionInfo: SessionInfo | null = null;
  private audioContext = new AudioContextClass();
  private metadata: Metadata | null = null;
  private serverTimeDiff: number = 0; // Time difference between server and client
  private serverTimeDiffSamples: number[] = []; // Store last 50 samples for median
  private expectClose = true;

  constructor(options: PlayerOptions) {
    super();
    this.options = options;
    if (options.logger) {
      this.logger = options.logger;
    }
  }

  // Establish a WebSocket connection
  public connect(isReconnect: boolean = false) {
    this.expectClose = !isReconnect;
    this.ws = new WebSocket(this.options.url);

    // Expect binary data as ArrayBuffer
    this.ws.binaryType = "arraybuffer";

    let timeSyncInterval: number | null = null;

    this.ws.onopen = () => {
      this.logger.log("WebSocket connected");
      this.serverTimeDiffSamples = [];
      this.expectClose = false;
      this._sendHello();
      this._sendPlayerTime();
      timeSyncInterval = window.setInterval(() => {
        this._sendPlayerTime();
      }, 1000);
      this.fire("open");
    };

    this.ws.onmessage = (event) => {
      // Check if the message is text (JSON) or binary (ArrayBuffer)
      if (typeof event.data === "string") {
        try {
          const message = JSON.parse(event.data);
          this._handleTextMessage(
            message,
            this.audioContext!.currentTime * 1000000,
          );
        } catch (err) {
          this.logger.error("Error parsing message", err);
        }
      } else {
        this._handleBinaryMessage(event.data);
      }
    };

    this.ws.onerror = (error) => {
      this.logger.error("WebSocket error:", error);
    };

    this.ws.onclose = () => {
      this.logger.log("WebSocket connection closed");
      clearTimeout(timeSyncInterval!);

      this.sessionInfo = null;
      this.metadata = null;
      this.fire("close", {
        expected: this.expectClose,
      });
    };
  }

  // Send a hello message to the server with player details.
  private _sendHello() {
    const helloMsg: PlayerHelloMessage = {
      type: "player/hello",
      payload: {
        player_id: this.options.playerId,
        name: this.options.playerId,
        role: "player",
        support_codecs: ["pcm"],
        support_channels: [2],
        support_sample_rates: [44100],
        support_bit_depth: [16],
        support_streams: ["music"],
        support_picture_formats: ["jpeg", "png"],
        media_display_size: null,
        buffer_capacity: 10000000000,
      },
    };
    this.ws!.send(JSON.stringify(helloMsg));
  }

  private _sendPlayerTime() {
    const timeMsg: PlayerTimeMessage = {
      type: "player/time",
      payload: {
        player_transmitted: this.audioContext!.currentTime * 1000000,
      },
    };
    this.ws!.send(JSON.stringify(timeMsg));
    this.logger.log("Sent player/time:", timeMsg.payload.player_transmitted);
  }

  // Handle text (JSON) messages from the server.
  private _handleTextMessage(message: ServerMessages, receivedAt: number) {
    this.logger.log("Received text message:", message);
    switch (message.type) {
      case "source/hello":
        this.serverInfo = message.payload;
        this.logger.log("Server connected:", this.serverInfo);
        this.fire("server-update", this.serverInfo);

        break;
      case "session/start":
        this.logger.log("Session started", message.payload);
        this.sessionInfo = message.payload;
        this.fire("session-update", this.sessionInfo);
        break;

      case "session/end":
        this.metadata = null;
        this.sessionInfo = null;
        this.logger.log("Session ended");
        this.fire("metadata-update", null);
        this.fire("art-update", null);
        this.fire("session-update", null);
        break;

      case "metadata/update":
        this.metadata = this.metadata
          ? { ...this.metadata, ...message.payload }
          : (message.payload as Metadata);
        this.fire("metadata-update", this.metadata);
        console.log("METADATA UPDATED", this.metadata);
        break;

      case "source/time":
        // Pass player_received time to the handler
        this._handleServerTime(message.payload, receivedAt);
        break;

      default:
        // @ts-expect-error
        this.logger.log("Unhandled message type:", message.type);
    }
  }

  // Handle binary messages – here we assume binary messages are audio chunks.
  private _handleBinaryMessage(data: ArrayBuffer) {
    // Create a DataView for accessing binary data
    const dataView = new DataView(data);

    // Byte 0: message type
    const messageType = dataView.getUint8(0);

    this.logger.log("Received binary message", messageType);

    switch (messageType) {
      case BinaryMessageType.PlayAudioChunk:
        this._handleAudioChunk(data);
        break;
      case BinaryMessageType.MediaArt:
        this._handleArtUpdate(data);
        break;
      default:
        this.logger.error("Unknown binary message type:", messageType);
    }
  }

  // Handle an audio chunk binary message.
  private _handleAudioChunk(data: ArrayBuffer) {
    // Check if AudioContext is available
    if (!this.audioContext) {
      this.logger.error("Cannot play audio: AudioContext not initialized");
      return;
    }
    if (!this.sessionInfo) {
      this.logger.error("Cannot play audio: session information not available");
      return;
    }

    // Create a DataView for accessing binary data
    const dataView = new DataView(data);

    // Bytes 2-8: timestamp (big-endian unsigned integer)
    const startTimeAtServer = Number(dataView.getBigInt64(1, false));

    // Bytes 9-12: sample count (big-endian unsigned integer) - replaces duration in ms
    const sampleCount = dataView.getUint32(9, false);

    // Header size in bytes
    const headerSize = 13;

    // Use session parameters from the session info
    const {
      codec,
      sample_rate: sampleRate,
      channels,
      bit_depth: bitDepth,
    } = this.sessionInfo;
    const bytesPerSample = 2;

    // Calculate duration in milliseconds from sample count and sample rate
    const durationMs = (sampleCount / sampleRate) * 1000;

    this.logger.log(
      `Received audio chunk: codec=${codec}, timestamp=${startTimeAtServer}, samples=${sampleCount}, duration=${durationMs.toFixed(
        2,
      )}ms`,
    );

    // Calculate the total number of samples per channel - now we directly use the sample count
    const totalSamples = sampleCount;

    // Verify that the number of samples matches the data size
    const expectedDataSize = totalSamples * channels * bytesPerSample;
    const actualDataSize = data.byteLength - headerSize;

    if (expectedDataSize !== actualDataSize) {
      this.logger.error(
        `Data size mismatch: expected ${expectedDataSize} bytes, got ${actualDataSize} bytes`,
      );
      return;
    }

    // Create an AudioBuffer to hold the PCM data
    const audioBuffer = this.audioContext.createBuffer(
      channels,
      totalSamples,
      sampleRate,
    );

    // We must manually process the audio data because:
    // 1. Web Audio API uses 32-bit float samples in range [-1,1]
    // 2. Our input is 16-bit PCM integers in an interleaved format
    // 3. AudioBuffer expects separate Float32Arrays for each channel

    // Create channel arrays for more efficient processing
    const channelArrays = [];
    for (let c = 0; c < channels; c++) {
      channelArrays.push(audioBuffer.getChannelData(c));
    }

    // Process all samples more efficiently
    for (let i = 0; i < totalSamples; i++) {
      // Calculate the base offset for this sample frame
      const baseOffset = headerSize + i * channels * bytesPerSample;

      // Process each channel
      for (let channel = 0; channel < channels; channel++) {
        // Get the sample from the data view
        const sample = dataView.getInt16(
          baseOffset + channel * bytesPerSample,
          true,
        ); // little-endian

        // Convert to float and store in the channel array
        channelArrays[channel][i] = sample / 32768;
      }
    }

    const source = this.audioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(this.audioContext.destination);

    // Convert server timestamp (microseconds) to AudioContext time (seconds)
    const startTimeInAudioContext =
      startTimeAtServer / 1000000 - this.serverTimeDiff;

    // Calculate how much time we have before this chunk should play
    const scheduleDelay =
      startTimeInAudioContext - this.audioContext.currentTime;

    if (scheduleDelay < 0) {
      // We're late, log the issue but still play the audio immediately
      this.logger.error(
        `Audio chunk arrived ${(-scheduleDelay).toFixed(3)}s too late`,
      );
      source.start();
    } else {
      // Schedule the audio to play at the right time
      this.logger.log(
        `Scheduling audio to play in ${scheduleDelay.toFixed(
          3,
        )}s at ${startTimeInAudioContext.toFixed(
          3,
        )}s (${totalSamples} samples)`,
      );
      source.start(startTimeInAudioContext);
    }
  }

  private _handleArtUpdate(data: ArrayBuffer) {
    // Create a DataView for accessing binary data
    const dataView = new DataView(data);

    // Bytes 2: image format
    const formatByte = dataView.getUint8(1);
    let format: string;
    switch (formatByte) {
      case 0: // JPEG
        format = "jpeg";
        break;
      case 1: // PNG
        format = "png";
        break;
      default:
        this.logger.error("Unknown art format:", formatByte);
        return;
    }

    // Header size in bytes
    const headerSize = 2;

    this.fire("art-update", {
      data: new Blob([data.slice(headerSize)], { type: `image/${format}` }),
    });
  }

  private _handleServerTime(payload: ServerTimeInfo, receivedAt: number) {
    const { player_transmitted, source_received, source_transmitted } = payload;

    // Calculate the raw offset from this message (in seconds)
    const offset =
      (source_received -
        player_transmitted +
        (source_transmitted - receivedAt)) /
      2 /
      1000000;

    // Store the offset sample
    this.serverTimeDiffSamples.push(offset);
    if (this.serverTimeDiffSamples.length > MAX_TIME_DIFF_SAMPLES) {
      this.serverTimeDiffSamples.shift();
    } else if (this.serverTimeDiffSamples.length < MIN_TIME_DIFF_SAMPLES) {
      // let's kick off another sample in 10ms
      setTimeout(() => this._sendPlayerTime(), 10);
    }

    // Calculate the median of the samples for a stable offset
    const sorted = [...this.serverTimeDiffSamples].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    let median: number;
    if (sorted.length % 2 === 0) {
      median = (sorted[mid - 1] + sorted[mid]) / 2;
    } else {
      median = sorted[mid];
    }
    this.serverTimeDiff = median;

    this.logger.log(
      `Server time difference (median of ${sorted.length}): ${this.serverTimeDiff} s`,
    );
  }

  // Close the WebSocket connection and clean up resources.
  public disconnect() {
    if (!this.ws) {
      return;
    }
    this.expectClose = true;
    this.ws.close();
    this.ws = null;

    // Make sure any currently playing audio is stopping
    this.audioContext.close();
    this.audioContext = new AudioContextClass();
    this.serverTimeDiff = 0;
    this.serverTimeDiffSamples = [];

    this.serverInfo = null;
  }
}
