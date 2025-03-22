import { SourceServer } from "./dist/source/source-server.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// Configuration
const PORT = 3001;
const WAV_FILE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "sample.wav",
);
const REPLAY_INTERVAL = 10000; // Replay WAV file every 5 seconds

// Create a simple logger that mirrors the Logger interface from source.ts
const logger = {
  log: (...args) =>
    args[0] ? console.log(new Date().toISOString(), ...args) : console.log(""),
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
    const server = new SourceServer("SDKSample", PORT, logger);
    try {
      server.start();
    } catch (error) {
      logger.error("Failed to start source server", error);
      process.exit(1);
    }

    // Start audio session and stream periodically
    setTimeout(() => {
      const playAudio = () => {
        logger.log("");
        logger.log("Sending WAV audio data to connected clients");
        const session = server.startSession(
          "pcm",
          wavData.sampleRate,
          wavData.channels,
          wavData.bitDepth,
        );
        let start = Date.now() + 500;

        for (let i = 0; i < wavData.audioData.length; i += 22050) {
          session.sendPCMAudioChunk(
            wavData.audioData.slice(i, i + 22050),
            start,
          );
          start += 250;
        }
        // end session after audio is done playing.
        setTimeout(() => session.end(), start - Date.now());
      };

      // Play immediately once
      playAudio();

      // Then play periodically so new clients will eventually hear the audio
      setInterval(playAudio, REPLAY_INTERVAL);
    }, 10000); // Short delay to ensure server is fully started

    // Handle process termination
    process.on("SIGINT", () => {
      logger.log("Shutting down server...");
      server.stop();
      process.exit(0);
    });
  } catch (error) {
    logger.error("Server error:", error);
    process.exit(1);
  }
}

// Run the main function
main();
