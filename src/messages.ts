export interface SessionInfo {
  session_id: string;
  codec: string;
  sample_rate: number;
  channels: number;
  bit_depth: number;
  now: number; // in ms
  codec_header: string | null;
}

export interface PlayerInfo {
  player_id: string;
  name: string;
  role: string;
  buffer_capacity: number;
  support_codecs: string[];
  support_channels: number[];
  support_sample_rates: number[];
  support_bit_depth: number[];
  support_streams: string[];
  support_picture_formats: string[];
  media_display_size: string | null;
}

export interface PlayerHelloMessage {
  type: "player/hello";
  payload: PlayerInfo;
}

export interface SourceInfo {
  source_id: string;
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
  payload: {
    sessionId: string;
  };
}

export type ClientMessages = PlayerHelloMessage;

export type ServerMessages =
  | SessionStartMessage
  | SessionEndMessage
  | SourceHelloMessage;

export enum BinaryMessageType {
  PlayAudioChunk = 1,
}
