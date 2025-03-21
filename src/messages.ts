export interface SessionInfo {
  codec: string;
  sampleRate: number;
  channels: number;
  bitDepth: number;
  now: number; // in ms
}

// Binary codec identifier mapping (byte value to string representation)
export const CODEC_MAP: Record<number, string> = {
  1: "pcm",
  2: "mp3",
  3: "aac",
};

export interface PlayerHelloMessage {
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

export interface SourceInfo {
  sourceId: string;
  name: string;
}

export interface SourceHelloMessage {
  type: "source/hello";
  payload: SourceInfo;
}

export interface SessionStartMessage {
  type: "session/start";
  payload: SessionInfo;
}

export interface SessionEndMessage {
  type: "session/end";
}

export type TextMessage =
  | PlayerHelloMessage
  | SourceHelloMessage
  | SessionStartMessage
  | SessionEndMessage;

export enum BinaryMessageType {
  PlayAudioChunk = 1,
}
