/**
 * @module gateway/gateway
 *
 * Core WebSocket gateway server implementation. This module provides the
 * {@link Gateway} class which manages WebSocket connections, enforces
 * origin-based access control, per-IP rate limiting, per-IP connection caps,
 * CSRF token validation for state-changing messages, and message routing to
 * registered handlers.
 *
 * The gateway emits lifecycle events ("listening", "clientConnected",
 * "clientDisconnected", "clientError") via the Node.js EventEmitter API.
 */

import * as crypto from "crypto";
import { EventEmitter } from "events";
import { IncomingMessage } from "http";
import { WebSocketServer, WebSocket, RawData } from "ws";
import { CsrfProtection } from "./csrf";
import { RateLimiter } from "./rate-limiter";

/**
 * Configuration options for the Gateway WebSocket server.
 */
export interface GatewayConfig {
  /** Hostname the WebSocket server binds to (e.g. "127.0.0.1"). */
  host: string;
  /** TCP port the WebSocket server listens on. */
  port: number;
  /** List of allowed request origins; use ["*"] to allow all (e.g. LAN mode). */
  allowedOrigins: string[];
  /** Secret key (>= 32 chars) used for HMAC-based CSRF token generation. */
  csrfSecret: string;
  /** Rate-limiting configuration: sliding window duration and max requests per window. */
  rateLimit: { windowMs: number; maxRequests: number };
}

/**
 * Represents a connected WebSocket client tracked by the gateway.
 */
export interface GatewayClient {
  /** Unique identifier assigned to this client connection. */
  id: string;
  /** The underlying WebSocket instance. */
  socket: WebSocket;
  /** The Origin header value the client connected with. */
  origin: string;
  /** Epoch timestamp (ms) when the client connected. */
  connectedAt: number;
  /** Unique session identifier assigned at connection time. */
  sessionId: string;
  /** Remote IP address of the client. */
  ip: string;
}

/**
 * Structure of an inbound message sent by a connected client.
 */
export interface GatewayMessage {
  /** The message type used to route to the appropriate handler. */
  type: string;
  /** Unique request identifier for correlating responses/errors. */
  id: string;
  /** Arbitrary payload data accompanying the message. */
  payload: unknown;
  /** Optional CSRF token required for state-changing operations. */
  csrfToken?: string;
}

/**
 * Callback signature for handlers registered via {@link Gateway.onMessage}.
 */
type MessageHandler = (client: GatewayClient, message: GatewayMessage) => void;

export class Gateway extends EventEmitter {
  private static readonly MAX_MESSAGE_BYTES = 1024 * 1024; // 1MB max message
  private static readonly MAX_CONNECTIONS_PER_IP = 10;

  private wss: WebSocketServer | null = null;
  private readonly config: GatewayConfig;
  private readonly csrf: CsrfProtection;
  private readonly rateLimiter: RateLimiter;
  private readonly clients = new Map<string, GatewayClient>();
  private readonly messageHandlers = new Map<string, MessageHandler>();
  private readonly connectionsPerIp = new Map<string, number>();

  constructor(config: GatewayConfig) {
    super();
    this.config = config;
    this.csrf = new CsrfProtection(config.csrfSecret);
    this.rateLimiter = new RateLimiter(config.rateLimit.windowMs, config.rateLimit.maxRequests);
  }

  async start(): Promise<void> {
    return new Promise((resolve) => {
      this.wss = new WebSocketServer({
        host: this.config.host,
        port: this.config.port,
        maxPayload: Gateway.MAX_MESSAGE_BYTES,
        verifyClient: (info, callback) => {
          const result = this.verifyClient(info);
          callback(result.allowed, result.code, result.reason);
        },
      });

      this.wss.on("connection", (socket, request) => {
        this.handleConnection(socket, request);
      });

      this.wss.on("listening", () => {
        this.emit("listening", {
          host: this.config.host,
          port: this.config.port,
        });
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    this.rateLimiter.destroy();
    for (const client of this.clients.values()) {
      client.socket.close(1001, "Server shutting down");
    }
    this.clients.clear();
    this.connectionsPerIp.clear();

    return new Promise((resolve) => {
      if (this.wss) {
        this.wss.close(() => resolve());
      } else {
        resolve();
      }
    });
  }

  onMessage(type: string, handler: MessageHandler): void {
    this.messageHandlers.set(type, handler);
  }

  send(clientId: string, type: string, payload: unknown): void {
    const client = this.clients.get(clientId);
    if (!client || client.socket.readyState !== WebSocket.OPEN) {
      return;
    }

    client.socket.send(JSON.stringify({ type, payload, timestamp: Date.now() }));
  }

  broadcast(type: string, payload: unknown): void {
    const message = JSON.stringify({ type, payload, timestamp: Date.now() });
    for (const client of this.clients.values()) {
      if (client.socket.readyState === WebSocket.OPEN) {
        client.socket.send(message);
      }
    }
  }

  getConnectedClients(): string[] {
    return Array.from(this.clients.keys());
  }

  private verifyClient(info: { origin?: string; req: IncomingMessage }): {
    allowed: boolean;
    code?: number;
    reason?: string;
  } {
    const origin = info.origin || info.req.headers.origin || "";

    // Strict origin validation
    if (!this.isOriginAllowed(origin)) {
      return {
        allowed: false,
        code: 403,
        reason: `Origin '${origin}' is not in the allowed origins list`,
      };
    }

    // Rate limiting by IP
    const ip = this.getClientIp(info.req);
    const rateCheck = this.rateLimiter.check(ip);
    if (!rateCheck.allowed) {
      return {
        allowed: false,
        code: 429,
        reason: `Rate limit exceeded. Try again in ${rateCheck.resetMs}ms`,
      };
    }

    // Per-IP connection limit
    const currentConns = this.connectionsPerIp.get(ip) || 0;
    if (currentConns >= Gateway.MAX_CONNECTIONS_PER_IP) {
      return {
        allowed: false,
        code: 429,
        reason: "Too many connections from this IP",
      };
    }

    return { allowed: true };
  }

  private isOriginAllowed(origin: string): boolean {
    if (!origin) {
      return false;
    }

    // Wildcard allows all origins (for explicit LAN access config)
    if (this.config.allowedOrigins.includes("*")) {
      return true;
    }

    const normalizedOrigin = origin.replace(/\/$/, "").toLowerCase();
    return this.config.allowedOrigins.some(
      (allowed) => allowed.replace(/\/$/, "").toLowerCase() === normalizedOrigin,
    );
  }

  private getClientIp(req: IncomingMessage): string {
    // Do NOT trust X-Forwarded-For by default to prevent IP spoofing
    return req.socket.remoteAddress || "unknown";
  }

  private handleConnection(socket: WebSocket, request: IncomingMessage): void {
    const clientId = crypto.randomUUID();
    const sessionId = crypto.randomUUID();
    const origin = request.headers.origin || "unknown";
    const ip = this.getClientIp(request);

    // Track per-IP connections
    this.connectionsPerIp.set(ip, (this.connectionsPerIp.get(ip) || 0) + 1);

    const client: GatewayClient = {
      id: clientId,
      socket,
      origin,
      connectedAt: Date.now(),
      sessionId,
      ip,
    };

    this.clients.set(clientId, client);

    // Send initial handshake with CSRF token
    const csrfToken = this.csrf.generateToken(sessionId);
    this.send(clientId, "connected", {
      clientId,
      sessionId,
      csrfToken,
    });

    socket.on("message", (data: RawData) => {
      this.handleMessage(client, data);
    });

    socket.on("close", () => {
      this.clients.delete(clientId);
      // Decrement per-IP counter
      const count = this.connectionsPerIp.get(ip) || 1;
      if (count <= 1) {
        this.connectionsPerIp.delete(ip);
      } else {
        this.connectionsPerIp.set(ip, count - 1);
      }
      this.emit("clientDisconnected", clientId);
    });

    socket.on("error", (error) => {
      this.emit("clientError", clientId, error);
    });

    this.emit("clientConnected", clientId);
  }

  private handleMessage(client: GatewayClient, raw: RawData): void {
    // Enforce message size limit
    // RawData is Buffer | ArrayBuffer | Buffer[]; convert to string for size check and JSON parsing
    const rawStr = Buffer.isBuffer(raw)
      ? raw.toString("utf-8")
      : Buffer.from(raw as ArrayBuffer).toString("utf-8");
    if (rawStr.length > Gateway.MAX_MESSAGE_BYTES) {
      this.send(client.id, "error", { message: "Message too large" });
      return;
    }

    let message: GatewayMessage;
    try {
      message = JSON.parse(rawStr);
    } catch {
      this.send(client.id, "error", { message: "Invalid JSON" });
      return;
    }

    if (!message.type || !message.id) {
      this.send(client.id, "error", {
        message: "Messages must include 'type' and 'id' fields",
      });
      return;
    }

    // Validate CSRF token for state-changing operations
    if (this.isStateChanging(message.type)) {
      if (!message.csrfToken || !this.csrf.validateToken(message.csrfToken, client.sessionId)) {
        this.send(client.id, "error", {
          message: "Invalid or missing CSRF token",
          code: "CSRF_INVALID",
        });
        return;
      }
    }

    const handler = this.messageHandlers.get(message.type);
    if (handler) {
      try {
        handler(client, message);
      } catch {
        this.send(client.id, "error", {
          message: "Internal handler error",
          requestId: message.id,
        });
      }
    } else {
      this.send(client.id, "error", {
        message: `Unknown message type: ${message.type}`,
        requestId: message.id,
      });
    }
  }

  private isStateChanging(type: string): boolean {
    // Read-only types + voiceAudio (high-frequency audio chunks that only
    // append to an already-CSRF-authenticated session started via voiceStart)
    const readOnlyTypes = new Set(["ping", "status", "list", "voiceAudio"]);
    return !readOnlyTypes.has(type);
  }
}
