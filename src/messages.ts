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

export type MediaCommand = "play" | "pause" | "stop" | "seek" | "volume";

export interface Metadata {
  title: string | null;
  artist: string | null;
  album: string | null;
  year: number | null;
  track: number | null;
  group_members: string[];
  support_commands: MediaCommand[];
  repeat: "off" | "one" | "all";
  shuffle: boolean;
}

export interface MetadataUpdateMessage {
  type: "metadata/update";
  payload: Partial<Metadata>;
}

export interface PlayerHelloMessage {
  type: "player/hello";
  payload: PlayerInfo;
}

export interface StreamCommandMessage {
  type: "stream/command";
  payload: {
    command: MediaCommand;
  };
}

export interface PlayerState {
  state: "playing" | "paused" | "idle";
  volume: number;
  muted: boolean;
}

export interface PlayerStateMessage {
  type: "player/state";
  payload: PlayerState;
}

export type ClientMessages =
  | PlayerHelloMessage
  | StreamCommandMessage
  | PlayerStateMessage;

export type ServerMessages =
  | SessionStartMessage
  | SessionEndMessage
  | SourceHelloMessage
  | MetadataUpdateMessage;

export enum BinaryMessageType {
  PlayAudioChunk = 1,
}
