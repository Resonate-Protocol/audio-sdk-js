# Client JS

Client to connect to join a Resonate server.

## Methods

### `constructor(options)`

Instantiate a new Resonate client. The following options can be passed in:

- `playerId`, required, a unique identifier for the player.
- `url`, required, the URL of the Resonate server to connect to.
- `logger`, optional, a logger instance to use for logging messages. If not provided, the console will be used for logging.

### `connect(isReconnect: bool)`

Connect to the Resonate server.

- `isReconnect` is a boolean indicating whether this is a reconnection attempt. Trackin this allows the player to populate the `expected` field on the `close` event.

### `disconnect()`

Disconnect from the Resonate server.

## Events

type Events = {
  open: void;
  close: { expected: boolean };
  "server-update": ServerInfo | null;
  "session-update": SessionInfo | null;
  "metadata-update": Metadata | null;
};

### `open`

Fired when the connection has been established with the Resonate server.

### `close`

Fired when the connection to the Resonate server has been closed.

Event data contains an `expected` boolean indicating whether the disconnection was expected (`disconnect()` called) or unexpected (e.g., due to a network issue).

### `server-update`

Fired when the server information has been updated. Event data is the server info.

### `session-update`

Fired when the session information has been updated. Event data is the session info or `null` if no session.

### `metadata-update`

Fired when the metadata has been updated. Event data is the metadata or `null` if no metadata.
