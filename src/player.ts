export class Player {
  constructor(url) {
    this.url = url;
    this.ws = null;
    // Create an AudioContext instance to play audio
    this.audioContext = new (window.AudioContext ||
      window.webkitAudioContext)();
    // Stores session parameters such as codec, sampleRate, channels, etc.
    this.sessionInfo = null;
  }

  // Establish a WebSocket connection
  connect() {
    this.ws = new WebSocket(this.url);
    // Expect binary data as ArrayBuffer
    this.ws.binaryType = "arraybuffer";

    this.ws.onopen = () => {
      console.log("WebSocket connected");
      this.sendHello();
    };

    this.ws.onmessage = (event) => {
      // Check if the message is text (JSON) or binary (ArrayBuffer)
      if (typeof event.data === "string") {
        try {
          const message = JSON.parse(event.data);
          this.handleTextMessage(message);
        } catch (err) {
          console.error("Error parsing message", err);
        }
      } else {
        this.handleBinaryMessage(event.data);
      }
    };

    this.ws.onerror = (error) => {
      console.error("WebSocket error:", error);
    };

    this.ws.onclose = () => {
      console.log("WebSocket connection closed");
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
    this.ws.send(JSON.stringify(helloMsg));
  }

  // Handle text (JSON) messages from the server.
  handleTextMessage(message) {
    console.log("Received text message:", message);
    switch (message.type) {
      case "source/hello":
        // Process source hello message if needed.
        break;
      case "session/start":
        console.log("Session started", message.payload);
        // Store session information from the server,
        // including the chosen codec and any other parameters.
        this.sessionInfo = {
          codec: message.payload.codec,
          sampleRate: message.payload.sampleRate || 44100,
          channels: message.payload.channels || 2,
          bitDepth: message.payload.bitDepth || 16,
        };
        break;
      case "session/end":
        console.log("Session ended");
        // Clear session information when session ends.
        this.sessionInfo = null;
        break;
      // Add additional case handlers as required.
      default:
        console.log("Unhandled message type:", message.type);
    }
  }

  // Handle binary messages – here we assume binary messages are audio chunks.
  handleBinaryMessage(data) {
    // Convert the ArrayBuffer to a Uint8Array for byte-level processing.
    const bytes = new Uint8Array(data);
    // Byte 0: message type – assume 1 indicates an audio chunk.
    const messageType = bytes[0];
    if (messageType !== 1) {
      console.warn("Unknown binary message type:", messageType);
      return;
    }

    // Byte 1: codec from the binary message header.
    const codecFromBinary = bytes[1];
    // Verify that the current session codec matches the binary message codec.
    if (this.sessionInfo && this.sessionInfo.codec !== codecFromBinary) {
      console.warn(
        `Codec mismatch: session codec is ${this.sessionInfo.codec} but received binary codec ${codecFromBinary}`,
      );
      return;
    }

    // Bytes 2-5: timestamp (big-endian unsigned integer)
    const timestamp = new DataView(data).getUint32(2, false);
    // Bytes 6-9: duration in milliseconds (big-endian unsigned integer)
    const duration = new DataView(data).getUint32(6, false);
    // The remainder of the data is the raw audio payload.
    const audioData = data.slice(10);

    console.log(
      `Received audio chunk: codec=${codecFromBinary}, timestamp=${timestamp}, duration=${duration}ms`,
    );

    this.playAudioChunk(audioData);
  }

  // Decode and play the audio chunk.
  playAudioChunk(arrayBuffer) {
    // Use session parameters if available; otherwise, use defaults.
    const sampleRate =
      (this.sessionInfo && this.sessionInfo.sampleRate) || 44100;
    const channels = (this.sessionInfo && this.sessionInfo.channels) || 2;
    const bitDepth = (this.sessionInfo && this.sessionInfo.bitDepth) || 16;
    const bytesPerSample = bitDepth === 16 ? 2 : 2; // adjust if using a different bit depth

    // Calculate the total number of samples per channel.
    const totalSamples = arrayBuffer.byteLength / (bytesPerSample * channels);

    // Create an AudioBuffer to hold the PCM data.
    const audioBuffer = this.audioContext.createBuffer(
      channels,
      totalSamples,
      sampleRate,
    );
    const dataView = new DataView(arrayBuffer);

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
    source.start();
  }

  // Close the WebSocket connection and clean up resources.
  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    if (this.audioContext && this.audioContext.state !== "closed") {
      this.audioContext.close();
    }
  }
}
