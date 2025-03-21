interface SessionInfo {
  codec: string;
  sampleRate: number;
  channels: number;
  bitDepth: number;
  now: number; // in ms
}

interface Logger {
  log: (message: string, ...data: any) => void;
  error: (message: string, ...data: any) => void;
}

// Binary codec identifier mapping (byte value to string representation)
export const CODEC_MAP: Record<number, string> = {
  1: "pcm",
  2: "mp3",
  3: "aac",
};

interface PlayerHelloMessage {
  type: "player/hello";
  payload: {
    playerId: string;
    name: string;
    supportedCodecs: string[];
    channels: number[];
    sampleRates: number[];
    bitDepth: number[];
    role: string;
    supportedStreams: string[];
    mediaFormats: string[];
  };
}

interface SourceInfo {
  sourceId: string;
  name: string;
}

interface SourceHelloMessage {
  type: "source/hello";
  payload: SourceInfo;
}

interface SessionStartMessage {
  type: "session/start";
  payload: SessionInfo;
}

interface SessionEndMessage {
  type: "session/end";
}

type TextMessage =
  | PlayerHelloMessage
  | SourceHelloMessage
  | SessionStartMessage
  | SessionEndMessage;

enum BinaryMessageType {
  PlayAudioChunk = 1,
}

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
  handleTextMessage(message: TextMessage) {
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
        this.logger.log("Unhandled message type:", message.type);
    }
  }

  // Handle binary messages – here we assume binary messages are audio chunks.
  handleBinaryMessage(data: ArrayBuffer) {
    // Convert the ArrayBuffer to a Uint8Array for byte-level processing.
    const bytes = new Uint8Array(data);
    // Byte 0: message type – assume 1 indicates an audio chunk.
    const messageType = bytes[0];

    switch (messageType) {
      case BinaryMessageType.PlayAudioChunk:
        this.handleAudioChunk(data);
        break;
      default:
        console.warn("Unknown binary message type:", messageType);
    }
  }

  // Handle an audio chunk binary message.
  handleAudioChunk(data: ArrayBuffer) {
    // Convert the ArrayBuffer to a Uint8Array for byte-level processing.
    const bytes = new Uint8Array(data);

    // Byte 1: codec from the binary message header.
    const codecByteValue = bytes[1];
    const codecString = CODEC_MAP[codecByteValue];

    if (!codecString) {
      console.warn(`Unknown codec identifier: ${codecByteValue}`);
      return;
    }

    // Verify that the current session codec matches the binary message codec.
    if (this.sessionInfo && this.sessionInfo.codec !== codecString) {
      console.warn(
        `Codec mismatch: session codec is ${this.sessionInfo.codec} but received binary codec ${codecString}`,
      );
      return;
    }

    // Bytes 2-5: timestamp (big-endian unsigned integer)
    const startTimeAtServer = new DataView(data).getUint32(2, false);
    // Bytes 6-9: duration in milliseconds (big-endian unsigned integer)
    const chunkDurationMs = new DataView(data).getUint32(6, false);
    // The remainder of the data is the raw audio payload.
    const audioData = data.slice(10);

    this.logger.log(
      `Received audio chunk: codec=${codecString}, timestamp=${startTimeAtServer}, duration=${chunkDurationMs}ms`,
    );

    // Check if AudioContext is available
    if (!this.audioContext) {
      console.warn("Cannot play audio: AudioContext not initialized");
      return;
    }
    if (!this.sessionInfo) {
      console.warn("Cannot play audio: session information not available");
      return;
    }

    // Use session parameters from the session info
    const { sampleRate, channels, bitDepth } = this.sessionInfo;
    const bytesPerSample = 2;

    // Calculate the total number of samples per channel.
    const totalSamples = data.byteLength / (bytesPerSample * channels);

    // Create an AudioBuffer to hold the PCM data.
    const audioBuffer = this.audioContext.createBuffer(
      channels,
      totalSamples,
      sampleRate,
    );
    const dataView = new DataView(data);

    // Decode the interleaved 16-bit PCM data for each channel.
    for (let channel = 0; channel < channels; channel++) {
      const channelData = audioBuffer.getChannelData(channel);
      for (let i = 0; i < totalSamples; i++) {
        // Calculate the byte offset for this sample.
        const offset = (i * channels + channel) * bytesPerSample;
        const sample = dataView.getInt16(offset, true); // little-endian
        // Convert the 16-bit PCM value to a float in the range [-1, 1]
        channelData[i] = sample / 32768;
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
      console.warn(
        `Audio chunk arrived ${(-scheduleDelay).toFixed(3)}s too late`,
      );
      source.start();
    } else {
      // Schedule the audio to play at the right time
      this.logger.log(
        `Scheduling audio to play in ${scheduleDelay.toFixed(
          3,
        )}s at ${startTimeInAudioContext.toFixed(3)}s`,
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
