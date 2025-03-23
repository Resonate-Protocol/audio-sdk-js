import { SourceServer } from "./dist/source/source-server.js";
import { Source } from "./dist/source/source.js";
import { generateUniqueId } from "./dist/util/unique-id.js";
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

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Main function to start the server and handle audio streaming
 */
async function main() {
  try {
    logger.log(`Reading WAV file: ${WAV_FILE}`);
    const wavData = parseWavFile(WAV_FILE);

    // Create and start the Source server
    const source = new Source(
      {
        source_id: generateUniqueId("source"),
        name: "SDKSample",
      },
      logger,
    );
    const server = new SourceServer(source, PORT, logger);
    try {
      server.start();
    } catch (error) {
      logger.error("Failed to start source server", error);
      process.exit(1);
    }

    // Start audio session and stream periodically
    const playAudio = async () => {
      logger.log("");
      logger.log("Sending WAV audio data to connected clients");
      const session = source.startSession(
        "pcm",
        wavData.sampleRate,
        wavData.channels,
        wavData.bitDepth,
      );
      let start = Date.now() + 500;
      const timeSlice = 250; // ms
      const bytesPerSlice =
        (timeSlice / 1000) * wavData.sampleRate * wavData.channels;

      for (let i = 0; i < wavData.audioData.length; i += bytesPerSlice) {
        session.sendPCMAudioChunk(
          wavData.audioData.slice(i, i + bytesPerSlice),
          start,
        );
        start += timeSlice;
        await sleep(timeSlice);
      }
      // end session after audio is done playing.
      await sleep(start - Date.now());
      session.end();

      await sleep(REPLAY_INTERVAL);
      playAudio();
    };

    // Then play periodically so new clients will eventually hear the audio
    setTimeout(playAudio, REPLAY_INTERVAL);

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
