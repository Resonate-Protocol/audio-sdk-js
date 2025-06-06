import { HTTPServer } from "./dist/server/http-server.js";
import { MusicServer } from "./dist/server/music-server.js";
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
const ART_FILE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "927-square.png",
);
const REPLAY_INTERVAL = 10000; // Replay WAV file every 5 seconds

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
    const artData = fs.readFileSync(ART_FILE);

    // Create and start the Source server
    const musicServer = new MusicServer(
      {
        source_id: generateUniqueId("server"),
        name: "SDKSample",
      },
      logger,
    );
    const httpServer = new HTTPServer(musicServer, PORT, logger);
    try {
      httpServer.start();
    } catch (error) {
      logger.error("Failed to start server", error);
      process.exit(1);
    }

    let session;

    // If we're playing a test sound and a client connects,
    // add them to the session.
    musicServer.on("client-added", (client) => {
      if (session) {
        session.addClient(client);
      }
    });

    // Start audio session and stream periodically
    const playAudio = async () => {
      logger.log("");
      logger.log("Sending WAV audio data to connected clients");
      session = musicServer.startSession(
        "pcm",
        wavData.sampleRate,
        wavData.channels,
        wavData.bitDepth,
      );
      session.sendMetadata({
        title: "Sample Audio",
        artist: "Someone on the internet",
        album: null,
        year: null,
        track: null,
        group_members: [],
        support_commands: ["play", "pause"],
        repeat: "off",
        shuffle: false,
      });
      session.sendMediaArt("image/png", artData);
      let start = performance.timeOrigin + performance.now() + 500;
      const timeSlice = 50; // ms
      const bytesPerSlice =
        (timeSlice / 1000) * wavData.sampleRate * wavData.channels;

      for (let i = 0; i < wavData.audioData.length; i += bytesPerSlice) {
        // Mimick metadata update
        if (i % (bytesPerSlice * 10) === 0) {
          session.sendMetadata({
            title: `Sample Audio ${i}`,
            artist: "Someone on the internet",
            album: null,
            year: null,
            track: null,
            group_members: [],
            support_commands: ["play", "pause"],
            repeat: "off",
            shuffle: false,
          });
        }

        const chunk = wavData.audioData.slice(i, i + bytesPerSlice);
        session.sendPCMAudioChunk(
          chunk,
          // We send microsecond timestamp as integer
          Math.round(start * 1000),
        );
        // Usually equal to timeSlice, but shorter for last chunk
        start += (chunk.length / bytesPerSlice) * timeSlice;

        // Send the audio if it should start playing within 1000 ms
        const sleepDuration =
          start - performance.timeOrigin - performance.now() - 1000;
        if (sleepDuration > 0) {
          await sleep(sleepDuration);
        }
      }
      // end session after audio is done playing.
      await sleep(
        start -
          Date.now() +
          // some extra time to make sure all clients have received the audio
          100,
      );
      session.end();
      session = null;

      await sleep(REPLAY_INTERVAL);
      playAudio();
    };

    // Then play periodically so new clients will eventually hear the audio
    setTimeout(playAudio, REPLAY_INTERVAL);

    // Handle process termination
    process.on("SIGINT", () => {
      logger.log("Shutting down server...");
      httpServer.stop();
      process.exit(0);
    });
  } catch (error) {
    logger.error("Server error:", error);
    process.exit(1);
  }
}

// Run the main function
main();
