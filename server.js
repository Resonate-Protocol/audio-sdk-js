const { Source } = require("./dist/source"); // Assuming TypeScript is compiled to dist/
const fs = require("fs");
const path = require("path");

// Configuration
const PORT = 8080;
const WAV_FILE = path.join(__dirname, "sample.wav");
const REPLAY_INTERVAL = 5000; // Replay WAV file every 5 seconds

// Create a simple logger that mirrors the Logger interface from source.ts
const logger = {
  log: (...args) => console.log(new Date().toISOString(), ...args),
  error: (...args) =>
    console.error(new Date().toISOString(), "ERROR:", ...args),
};

/**
 * Parse a WAV file and extract audio data and format information
 * This is a simplified parser that works with standard PCM WAV files
 */
function parseWavFile(filePath) {
  // Read file synchronously
  const buffer = fs.readFileSync(filePath);

  // Verify WAV header
  const header = buffer.toString("utf8", 0, 4);
  if (header !== "RIFF") {
    throw new Error("Not a valid WAV file");
  }

  // Basic WAV header parsing
  const sampleRate = buffer.readUInt32LE(24);
  const numChannels = buffer.readUInt16LE(22);
  const bitsPerSample = buffer.readUInt16LE(34);

  logger.log(
    `WAV file info: ${sampleRate}Hz, ${numChannels} channels, ${bitsPerSample} bits`,
  );

  // Find data chunk (simplistic approach - real WAV files might have different chunks)
  let dataOffset = 44; // Default for standard WAV files
  let dataSize = buffer.readUInt32LE(40);

  // Extract audio data as Int16Array (assuming PCM format)
  const audioData = new Int16Array(dataSize / 2);
  for (let i = 0; i < audioData.length; i++) {
    audioData[i] = buffer.readInt16LE(dataOffset + i * 2);
  }

  return {
    sampleRate,
    channels: numChannels,
    bitDepth: bitsPerSample,
    audioData,
  };
}

/**
 * Main function to start the server and handle audio streaming
 */
async function main() {
  try {
    logger.log(`Reading WAV file: ${WAV_FILE}`);
    const wavData = parseWavFile(WAV_FILE);

    // Create and start the Source server
    const source = new Source(PORT, logger);
    if (!source.start()) {
      logger.error("Failed to start source server");
      process.exit(1);
      return;
    }

    logger.log(`WebSocket server started on port ${PORT}`);

    // Start audio session and stream periodically
    setTimeout(() => {
      // Start an audio session with parameters from the WAV file
      if (
        source.startSession(
          "pcm",
          wavData.sampleRate,
          wavData.channels,
          wavData.bitDepth,
        )
      ) {
        logger.log("Audio session started successfully");

        // Function to send audio data
        const playAudio = () => {
          logger.log("Sending WAV audio data to connected clients");
          source.sendPCMAudioChunk(wavData.audioData);
        };

        // Play immediately once
        playAudio();

        // Then play periodically so new clients will eventually hear the audio
        setInterval(playAudio, REPLAY_INTERVAL);
      } else {
        logger.error("Failed to start audio session");
      }
    }, 1000); // Short delay to ensure server is fully started

    // Handle process termination
    process.on("SIGINT", () => {
      logger.log("Shutting down server...");
      source.stop();
      process.exit(0);
    });
  } catch (error) {
    logger.error("Server error:", error);
    process.exit(1);
  }
}

// Run the main function
main();
