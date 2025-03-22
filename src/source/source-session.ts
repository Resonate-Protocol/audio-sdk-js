import {
  SessionInfo,
  BinaryMessageType,
  SessionEndMessage,
} from "../messages.js";
import type { Logger } from "../logging.js";
import { SourceClient } from "./source-client.js";

export class SourceSession {
  sessionActive: Set<string> = new Set();

  constructor(
    private readonly sessionInfo: SessionInfo,
    private readonly clients: Map<string, SourceClient>,
    private readonly logger: Logger,
    private readonly onSessionEnd: () => void,
  ) {}

  end() {
    // Send session end message
    const sessionEndMessage: SessionEndMessage = {
      type: "session/end",
      payload: {
        sessionId: this.sessionInfo.session_id,
      },
    };

    for (const clientId of this.sessionActive) {
      this.clients.get(clientId)?.send(sessionEndMessage);
    }
    this.sessionActive.clear();
    this.onSessionEnd();
  }

  // Send audio data to all players
  createAudioPacket(audioData: Float32Array[], timestamp: number): ArrayBuffer {
    const {
      channels,
      sample_rate: sampleRate,
      bit_depth: bitDepth,
      codec,
    } = this.sessionInfo;

    // Validate input
    if (audioData.length !== channels) {
      throw new Error(
        `Channel mismatch: expected ${channels}, got ${audioData.length}`,
      );
    }

    // Get sample count from first channel's length
    const sampleCount = audioData[0].length;

    // Calculate header size and total message size
    const headerSize = 13;
    const bytesPerSample = bitDepth / 8;
    const dataSize = sampleCount * channels * bytesPerSample;
    const totalSize = headerSize + dataSize;

    // Create the binary message buffer
    const buffer = new ArrayBuffer(totalSize);
    const dataView = new DataView(buffer);

    // Write header
    dataView.setUint8(0, BinaryMessageType.PlayAudioChunk); // Message type
    dataView.setBigUint64(1, BigInt(timestamp), false);
    dataView.setUint32(9, sampleCount, false); // Sample count (big-endian)

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

    return buffer;
  }

  // Broadcast a binary message to all clients
  sendBinary(buffer: ArrayBuffer) {
    for (const client of this.clients.values()) {
      if (!client.isReady) {
        this.logger.log(`Client ${client.clientId} not ready, skipping`);
        if (this.sessionActive.has(client.clientId)) {
          this.sessionActive.delete(client.clientId);
        }
        continue;
      }
      if (!this.sessionActive.has(client.clientId)) {
        client.send({
          type: "session/start" as const,
          payload: this.sessionInfo,
        });
        this.sessionActive.add(client.clientId);
      }
      client.sendBinary(buffer);
    }
  }

  // Create and send a PCM audio chunk from raw samples
  sendPCMAudioChunk(
    pcmData: Int16Array | Float32Array,
    timestamp: number = Date.now(),
  ) {
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

    this.sendBinary(this.createAudioPacket(floatData, timestamp));
    this.logger.log(
      `Broadcasted audio chunk: ${floatData[0].length} samples at timestamp ${timestamp}ms to ${this.clients.size} clients`,
    );
  }

  getInfo(): SessionInfo {
    return this.sessionInfo;
  }
}
