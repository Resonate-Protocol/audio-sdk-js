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

export interface PlayerTimeInfo {
  player_transmitted: number;
}

export interface ServerTimeInfo {
  player_transmitted: number;
  server_received: number;
  server_transmitted: number;
}

export interface PlayerTimeMessage {
  type: "player/time";
  payload: PlayerTimeInfo;
}

export interface ServerInfo {
  server_id: string;
  name: string;
}

export interface ServerHelloMessage {
  type: "server/hello";
  payload: ServerInfo;
}

export interface ServerTimeMessage {
  type: "server/time";
  payload: ServerTimeInfo;
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

export interface GroupJoinMessage {
  type: "group/join";
  payload: {
    groupId: string;
  };
}

export interface GroupUnjoinMessage {
  type: "group/unjoin";
}

export interface GroupGetListMessage {
  type: "group/get-list";
}

export interface GroupListMessage {
  type: "group/list";
  payload: {
    groups: Array<{
      groupId: string;
      state: "idle" | "playing" | "paused";
    }>;
  };
}

export type ClientMessages =
  | PlayerHelloMessage
  | StreamCommandMessage
  | PlayerStateMessage
  | PlayerTimeMessage
  | GroupJoinMessage
  | GroupUnjoinMessage
  | GroupGetListMessage;

export type ServerMessages =
  | SessionStartMessage
  | SessionEndMessage
  | ServerHelloMessage
  | MetadataUpdateMessage
  | ServerTimeMessage
  | GroupListMessage;

export enum BinaryMessageType {
  PlayAudioChunk = 1,
  MediaArt = 2,
}
