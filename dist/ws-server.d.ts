/**
 * ws-server.ts — WebSocket transport for executor communication.
 *
 * Registration: client sends register → server sends get_game_metadata → client replies
 * with metadata → server matches OS PID from window titles → promotes to full registration.
 * Reconnect: same OS PID + new workerId → old worker cleaned up.
 */
export {};
