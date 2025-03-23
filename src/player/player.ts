import {
  SourceInfo,
  SessionInfo,
  ServerMessages,
  BinaryMessageType,
  PlayerHelloMessage,
} from "../messages.js";
import type { Logger } from "../logging.js";
import { EventEmitter } from "../util/event-emitter.js";

type Events = {
  open: void;
  close: { expected: boolean };
  "source-update": SourceInfo | null;
  "session-update": SessionInfo | null;
};

export interface PlayerOptions {
  playerId: string;
  url: string;
  logger?: Logger;
}

export class Player extends EventEmitter<Events> {
  private options: PlayerOptions;
  private logger: Logger = console;
  private ws: WebSocket | null = null;
  private sourceInfo: SourceInfo | null = null;
  private sessionInfo: SessionInfo | null = null;
  private audioContext: AudioContext | null = null;
  private serverTimeDiff: number = 0; // Time difference between server and client
  private expectClose = true;

  constructor(options: PlayerOptions) {
    super();
    this.options = options;
    if (options.logger) {
      this.logger = options.logger;
    }
  }

  // Establish a WebSocket connection
  connect(isReconnect: boolean = false) {
    this.expectClose = !isReconnect;
    this.ws = new WebSocket(this.options.url);
    // Expect binary data as ArrayBuffer
    this.ws.binaryType = "arraybuffer";

    this.ws.onopen = () => {
      this.logger.log("WebSocket connected");
      this.expectClose = false;
      this.sendHello();
      this.fire("open");
    };

    this.ws.onmessage = (event) => {
      // Check if the message is text (JSON) or binary (ArrayBuffer)
      if (typeof event.data === "string") {
        try {
          const message = JSON.parse(event.data);
          this.handleTextMessage(message);
        } catch (err) {
          this.logger.error("Error parsing message", err);
        }
      } else {
        this.handleBinaryMessage(event.data);
      }
    };

    this.ws.onerror = (error) => {
      this.logger.error("WebSocket error:", error);
    };

    this.ws.onclose = () => {
      this.logger.log("WebSocket connection closed");
      this.fire("close", {
        expected: this.expectClose,
      });
    };
  }

  // Send a hello message to the server with player details.
  sendHello() {
    const helloMsg: PlayerHelloMessage = {
      type: "player/hello",
      payload: {
        player_id: this.options.playerId,
        name: "PlayerClient",
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

  // Handle text (JSON) messages from the server.
  handleTextMessage(message: ServerMessages) {
    this.logger.log("Received text message:", message);
    switch (message.type) {
      case "source/hello":
        this.sourceInfo = message.payload;
        this.logger.log("Source connected:", this.sourceInfo);
        this.fire("source-update", this.sourceInfo);

        break;
      case "session/start":
        this.logger.log("Session started", message.payload);
        this.sessionInfo = message.payload;
        this.fire("session-update", this.sessionInfo);

        // Use standard AudioContext or fallback to webkitAudioContext
        const AudioContextClass =
          window.AudioContext || window.webkitAudioContext;
        this.audioContext = new AudioContextClass();

        // Convert server time to seconds for consistent unit with audioContext.currentTime
        this.serverTimeDiff =
          this.sessionInfo.now / 1000 - this.audioContext.currentTime;
        this.logger.log(`Server time difference: ${this.serverTimeDiff}s`);
        break;

      case "session/end":
        this.logger.log("Session ended");
        this.fire("session-update", null);
        // Clean up AudioContext when the session ends
        if (this.audioContext && this.audioContext.state !== "closed") {
          this.audioContext.close();
          this.audioContext = null;
        }
        // Clear session information when session ends.
        this.sessionInfo = null;
        break;

      default:
        // @ts-expect-error
        this.logger.log("Unhandled message type:", message.type);
    }
  }

  // Handle binary messages – here we assume binary messages are audio chunks.
  handleBinaryMessage(data: ArrayBuffer) {
    // Create a DataView for accessing binary data
    const dataView = new DataView(data);

    // Byte 0: message type
    const messageType = dataView.getUint8(0);

    this.logger.log("Received binary message", messageType);

    switch (messageType) {
      case BinaryMessageType.PlayAudioChunk:
        this.handleAudioChunk(data);
        break;
      default:
        this.logger.error("Unknown binary message type:", messageType);
    }
  }

  // Handle an audio chunk binary message.
  handleAudioChunk(data: ArrayBuffer) {
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

    // Bytes 2-5: timestamp (big-endian unsigned integer)
    const startTimeAtServer = Number(dataView.getBigUint64(1, false));

    // Bytes 6-9: sample count (big-endian unsigned integer) - replaces duration in ms
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

    // Create a buffer source node, connect it, and start playback.
    const source = this.audioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(this.audioContext.destination);

    // Convert server timestamp (milliseconds) to AudioContext time (seconds)
    const startTimeInAudioContext =
      startTimeAtServer / 1000 - this.serverTimeDiff;

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

  // Close the WebSocket connection and clean up resources.
  disconnect() {
    if (!this.ws) {
      return;
    }
    this.expectClose = true;
    this.ws.close();
    this.ws = null;
    this.sourceInfo = null;
    this.sessionInfo = null;

    if (this.audioContext && this.audioContext.state !== "closed") {
      this.audioContext.close();
    }

    this.audioContext = null;
  }
}
