# Improv Audio Player Example

A simple example of an audio player implementation using WebSockets.

## Getting Started

1. Install dependencies:
   ```bash
   npm install
   ```

2. Start the development server:
   ```bash
   npm run dev
   ```
   This will:
   - Watch for TypeScript changes and recompile automatically
   - Serve the app at http://localhost:3000

3. For production serving only (without TypeScript watching):
   ```bash
   npm start
   ```

## Usage

1. Enter your WebSocket audio server URL in the input field
2. Click "Connect" to establish a connection
3. The status will update to show connection state
4. Click "Disconnect" to terminate the connection

## Development

When running in development mode with `npm run dev`:
- TypeScript files are automatically recompiled when changed
- The web server automatically serves the latest version
- All content is served from http://localhost:3000
