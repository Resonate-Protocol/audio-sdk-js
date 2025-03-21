import {
  SourceInfo,
  SessionInfo,
  ServerMessages,
  BinaryMessageType,
  CODEC_MAP,
} from "./messages";
import { Logger } from "./logging";

export class Player {
  private ws: WebSocket | null = null;
  private sourceInfo: SourceInfo | null = null;
  private sessionInfo: SessionInfo | null = null;
  private audioContext: AudioContext | null = null;
  private serverTimeDiff: number = 0; // Time difference between server and client

  constructor(public url: string, private logger: Logger = console) {}

  // Establish a WebSocket connection
  connect() {
    this.ws = new WebSocket(this.url);
    // Expect binary data as ArrayBuffer
    this.ws.binaryType = "arraybuffer";

    this.ws.onopen = () => {
      this.logger.log("WebSocket connected");
      this.sendHello();
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
    };
  }

  // Send a hello message to the server with player details.
  sendHello() {
    const helloMsg = {
      type: "player/hello",
      payload: {
        playerId: "unique_player_id", // replace with a unique id as needed
        name: "PlayerClient",
        supportedCodecs: ["pcm"],
        channels: [2],
        sampleRates: [44100],
        bitDepth: [16],
        role: "player",
        supportedStreams: ["music"],
        mediaFormats: ["image/jpeg", "image/png"],
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

        break;
      case "session/start":
        this.logger.log("Session started", message.payload);
        this.sessionInfo = message.payload;

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
        // Clean up AudioContext when the session ends
        if (this.audioContext && this.audioContext.state !== "closed") {
          this.audioContext.close();
          this.audioContext = null;
        }
        // Clear session information when session ends.
        this.sessionInfo = null;
        break;
      // Add additional case handlers as required.
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
    // Create a DataView for accessing binary data
    const dataView = new DataView(data);

    // Byte 1: codec from the binary message header
    const codecByteValue = dataView.getUint8(1);
    const codecString = CODEC_MAP[codecByteValue];

    if (!codecString) {
      this.logger.error(`Unknown codec identifier: ${codecByteValue}`);
      return;
    }

    // Verify that the current session codec matches the binary message codec.
    if (this.sessionInfo && this.sessionInfo.codec !== codecString) {
      this.logger.error(
        `Codec mismatch: session codec is ${this.sessionInfo.codec} but received binary codec ${codecString}`,
      );
      return;
    }

    // Bytes 2-5: timestamp (big-endian unsigned integer)
    const startTimeAtServer = dataView.getUint32(2, false);

    // Bytes 6-9: sample count (big-endian unsigned integer) - replaces duration in ms
    const sampleCount = dataView.getUint32(6, false);

    // Header size in bytes
    const headerSize = 10;

    // Check if AudioContext is available
    if (!this.audioContext) {
      this.logger.error("Cannot play audio: AudioContext not initialized");
      return;
    }
    if (!this.sessionInfo) {
      this.logger.error("Cannot play audio: session information not available");
      return;
    }

    // Use session parameters from the session info
    const { sampleRate, channels, bitDepth } = this.sessionInfo;
    const bytesPerSample = 2;

    // Calculate duration in milliseconds from sample count and sample rate
    const durationMs = (sampleCount / sampleRate) * 1000;

    this.logger.log(
      `Received audio chunk: codec=${codecString}, timestamp=${startTimeAtServer}, samples=${sampleCount}, duration=${durationMs.toFixed(
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

    // Add a comment explaining why we need this manual conversion
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
