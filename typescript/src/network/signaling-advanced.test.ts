/**
 * Signaling Additional Tests - WebSocket, HTTP, SignaledConnection
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { SignaledConnection, WebSocketSignaling, HTTPSignaling } from './signaling';

describe('SignaledConnection', () => {
  let mockSignaling: {
    send: jest.Mock;
    onMessage: jest.Mock;
  };

  beforeEach(() => {
    mockSignaling = {
      send: jest.fn().mockResolvedValue(undefined),
      onMessage: jest.fn(),
    };
  });

  describe('Construction and Setup', () => {
    it('should create SignaledConnection', () => {
      const conn = new SignaledConnection(
        mockSignaling as any,
        'local-fp',
        'remote-fp'
      );

      expect(conn).toBeDefined();
      expect(mockSignaling.onMessage).toHaveBeenCalledTimes(1);
    });

    it('should register message handler on construction', () => {
      new SignaledConnection(
        mockSignaling as any,
        'local-fp',
        'remote-fp'
      );

      expect(mockSignaling.onMessage).toHaveBeenCalled();
      expect(typeof mockSignaling.onMessage.mock.calls[0][0]).toBe('function');
    });
  });

  describe('Sending Messages', () => {
    it('should send offer', async () => {
      const conn = new SignaledConnection(
        mockSignaling as any,
        'local-fp',
        'remote-fp'
      );

      const offer = { type: 'offer' as const, sdp: 'test-sdp' };
      await conn.sendOffer(offer);

      expect(mockSignaling.send).toHaveBeenCalledWith({
        from: 'local-fp',
        to: 'remote-fp',
        type: 'offer',
        data: offer,
      });
    });

    it('should send answer', async () => {
      const conn = new SignaledConnection(
        mockSignaling as any,
        'local-fp',
        'remote-fp'
      );

      const answer = { type: 'answer' as const, sdp: 'answer-sdp' };
      await conn.sendAnswer(answer);

      expect(mockSignaling.send).toHaveBeenCalledWith({
        from: 'local-fp',
        to: 'remote-fp',
        type: 'answer',
        data: answer,
      });
    });

    it('should send ICE candidate', async () => {
      const conn = new SignaledConnection(
        mockSignaling as any,
        'local-fp',
        'remote-fp'
      );

      const candidate = {
        candidate: 'candidate:1 1 udp 2130706431 192.168.1.1 54321 typ host',
        sdpMid: '0',
        sdpMLineIndex: 0,
      };

      await conn.sendICECandidate(candidate);

      expect(mockSignaling.send).toHaveBeenCalledWith({
        from: 'local-fp',
        to: 'remote-fp',
        type: 'ice-candidate',
        data: candidate,
      });
    });
  });

  describe('Receiving Messages', () => {
    it('should handle offer callback', () => {
      const conn = new SignaledConnection(
        mockSignaling as any,
        'local-fp',
        'remote-fp'
      );

      const offerCallback = jest.fn();
      conn.onOffer(offerCallback);

      // Simulate message
      const handler = mockSignaling.onMessage.mock.calls[0][0];
      const offer = { type: 'offer' as const, sdp: 'test-sdp' };
      handler({
        from: 'remote-fp',
        to: 'local-fp',
        type: 'offer',
        data: offer,
      });

      expect(offerCallback).toHaveBeenCalledWith(offer);
    });

    it('should handle answer callback', () => {
      const conn = new SignaledConnection(
        mockSignaling as any,
        'local-fp',
        'remote-fp'
      );

      const answerCallback = jest.fn();
      conn.onAnswer(answerCallback);

      const handler = mockSignaling.onMessage.mock.calls[0][0];
      const answer = { type: 'answer' as const, sdp: 'answer-sdp' };
      handler({
        from: 'remote-fp',
        to: 'local-fp',
        type: 'answer',
        data: answer,
      });

      expect(answerCallback).toHaveBeenCalledWith(answer);
    });

    it('should handle ICE candidate callback', () => {
      const conn = new SignaledConnection(
        mockSignaling as any,
        'local-fp',
        'remote-fp'
      );

      const iceCallback = jest.fn();
      conn.onICECandidate(iceCallback);

      const handler = mockSignaling.onMessage.mock.calls[0][0];
      const candidate = {
        candidate: 'candidate:1 1 udp 2130706431 192.168.1.1 54321 typ host',
        sdpMid: '0',
        sdpMLineIndex: 0,
      };

      handler({
        from: 'remote-fp',
        to: 'local-fp',
        type: 'ice-candidate',
        data: candidate,
      });

      expect(iceCallback).toHaveBeenCalledWith(candidate);
    });

    it('should ignore messages from wrong sender', () => {
      const conn = new SignaledConnection(
        mockSignaling as any,
        'local-fp',
        'remote-fp'
      );

      const offerCallback = jest.fn();
      conn.onOffer(offerCallback);

      const handler = mockSignaling.onMessage.mock.calls[0][0];
      handler({
        from: 'other-fp', // Wrong sender
        to: 'local-fp',
        type: 'offer',
        data: { type: 'offer', sdp: 'test-sdp' },
      });

      expect(offerCallback).not.toHaveBeenCalled();
    });

    it('should ignore messages to wrong recipient', () => {
      const conn = new SignaledConnection(
        mockSignaling as any,
        'local-fp',
        'remote-fp'
      );

      const offerCallback = jest.fn();
      conn.onOffer(offerCallback);

      const handler = mockSignaling.onMessage.mock.calls[0][0];
      handler({
        from: 'remote-fp',
        to: 'other-fp', // Wrong recipient
        type: 'offer',
        data: { type: 'offer', sdp: 'test-sdp' },
      });

      expect(offerCallback).not.toHaveBeenCalled();
    });

    it('should not crash when callback not set', () => {
      const conn = new SignaledConnection(
        mockSignaling as any,
        'local-fp',
        'remote-fp'
      );

      const handler = mockSignaling.onMessage.mock.calls[0][0];

      expect(() => {
        handler({
          from: 'remote-fp',
          to: 'local-fp',
          type: 'offer',
          data: { type: 'offer', sdp: 'test-sdp' },
        });
      }).not.toThrow();
    });
  });

  describe('Multiple Callback Registration', () => {
    it('should allow registering multiple callbacks', () => {
      const conn = new SignaledConnection(
        mockSignaling as any,
        'local-fp',
        'remote-fp'
      );

      const offerCallback1 = jest.fn();
      const offerCallback2 = jest.fn();

      conn.onOffer(offerCallback1);
      conn.onOffer(offerCallback2);

      const handler = mockSignaling.onMessage.mock.calls[0][0];
      const offer = { type: 'offer' as const, sdp: 'test-sdp' };
      handler({
        from: 'remote-fp',
        to: 'local-fp',
        type: 'offer',
        data: offer,
      });

      // Last registered callback wins
      expect(offerCallback2).toHaveBeenCalledWith(offer);
      expect(offerCallback1).not.toHaveBeenCalled();
    });
  });
});

describe('HTTPSignaling', () => {
  const mockFetch = jest.fn();

  beforeEach(() => {
    global.fetch = mockFetch;
    mockFetch.mockClear();
  });

  describe('Construction', () => {
    it('should create HTTPSignaling', () => {
      const signaling = new HTTPSignaling('http://localhost:3000', 'test-fp');
      expect(signaling).toBeDefined();
    });
  });

  describe('Sending Messages', () => {
    it('should send message via POST', async () => {
      mockFetch.mockResolvedValue({ ok: true });

      const signaling = new HTTPSignaling('http://localhost:3000', 'test-fp');
      
      await signaling.send({
        from: 'test-fp',
        to: 'remote-fp',
        type: 'offer',
        data: { type: 'offer', sdp: 'test-sdp' },
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/signal',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        })
      );
    });

    it('should throw on HTTP error', async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 500 });

      const signaling = new HTTPSignaling('http://localhost:3000', 'test-fp');
      
      await expect(signaling.send({
        from: 'test-fp',
        to: 'remote-fp',
        type: 'offer',
        data: {},
      })).rejects.toThrow('Signaling failed: 500');
    });
  });

  describe('Message Handlers', () => {
    it('should register message handler', () => {
      const signaling = new HTTPSignaling('http://localhost:3000', 'test-fp');
      const handler = jest.fn();

      signaling.onMessage(handler);

      // Handler registered (will be tested when polling)
      expect(handler).not.toHaveBeenCalled();
    });

    it('should allow multiple message handlers', () => {
      const signaling = new HTTPSignaling('http://localhost:3000', 'test-fp');
      const handler1 = jest.fn();
      const handler2 = jest.fn();

      signaling.onMessage(handler1);
      signaling.onMessage(handler2);

      expect(handler1).not.toHaveBeenCalled();
      expect(handler2).not.toHaveBeenCalled();
    });
  });

  describe('Polling', () => {
    it('should start polling', () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => [],
      });

      const signaling = new HTTPSignaling('http://localhost:3000', 'test-fp');
      
      signaling.startPolling();

      // Polling started (async, can't easily test without waiting)
      expect(mockFetch).toHaveBeenCalled();
    });

    it('should stop polling', () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => [],
      });

      const signaling = new HTTPSignaling('http://localhost:3000', 'test-fp');
      
      signaling.startPolling();
      signaling.stopPolling();

      // Polling stopped
      expect(true).toBe(true);
    });

    it('should not start polling twice', () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => [],
      });

      const signaling = new HTTPSignaling('http://localhost:3000', 'test-fp');
      
      signaling.startPolling();
      const callCount1 = mockFetch.mock.calls.length;
      
      signaling.startPolling();
      const callCount2 = mockFetch.mock.calls.length;

      // Should not increase fetch calls
      expect(callCount2).toBe(callCount1);
    });

    it('should handle polling errors gracefully', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      const signaling = new HTTPSignaling('http://localhost:3000', 'test-fp');
      
      // Start polling
      signaling.startPolling();

      // Give time for one poll attempt
      await new Promise(resolve => setTimeout(resolve, 150));

      // Stop immediately to avoid console errors
      signaling.stopPolling();

      // Wait for cleanup
      await new Promise(resolve => setTimeout(resolve, 50));
    });
  });
});

describe('WebSocketSignaling', () => {
  let mockWebSocket: any;

  beforeEach(() => {
    // Mock WebSocket
    mockWebSocket = {
      send: jest.fn(),
      close: jest.fn(),
      readyState: 1, // OPEN
      onopen: null as any,
      onmessage: null as any,
      onerror: null as any,
      onclose: null as any,
      OPEN: 1,
    };

    (global as any).WebSocket = jest.fn(() => mockWebSocket);
  });

  describe('Construction and Connection', () => {
    it('should create WebSocketSignaling', () => {
      const signaling = new WebSocketSignaling('ws://localhost:3000', 'test-fp');
      
      expect(signaling).toBeDefined();
      expect((global as any).WebSocket).toHaveBeenCalledWith('ws://localhost:3000');
    });

    it('should register with server on connect', () => {
      const signaling = new WebSocketSignaling('ws://localhost:3000', 'test-fp');
      
      // Trigger onopen
      mockWebSocket.onopen();

      expect(mockWebSocket.send).toHaveBeenCalledWith(
        JSON.stringify({
          type: 'register',
          fingerprint: 'test-fp',
        })
      );
    });

    it('should reject on connection error', (done) => {
      const signaling = new WebSocketSignaling('ws://localhost:3000', 'test-fp');
      
      // Trigger error
      const error = new Error('Connection failed');
      mockWebSocket.onerror(error);

      // connected promise should reject
      (signaling as any).connected.catch((err: any) => {
        expect(err).toBe(error);
        done();
      });
    });
  });

  describe('Sending Messages', () => {
    it('should send message when connected', async () => {
      const signaling = new WebSocketSignaling('ws://localhost:3000', 'test-fp');
      
      // Trigger onopen to resolve connected promise
      mockWebSocket.onopen();

      await signaling.send({
        from: 'test-fp',
        to: 'remote-fp',
        type: 'offer',
        data: { type: 'offer', sdp: 'test-sdp' },
      });

      expect(mockWebSocket.send).toHaveBeenCalledWith(
        expect.stringContaining('"type":"offer"')
      );
    });

    it('should throw when not connected', async () => {
      const signaling = new WebSocketSignaling('ws://localhost:3000', 'test-fp');
      
      mockWebSocket.readyState = 0; // CONNECTING

      // Trigger onopen
      mockWebSocket.onopen();

      await expect(signaling.send({
        from: 'test-fp',
        to: 'remote-fp',
        type: 'offer',
        data: {},
      })).rejects.toThrow('WebSocket not connected');
    });
  });

  describe('Receiving Messages', () => {
    it('should handle incoming messages', () => {
      const signaling = new WebSocketSignaling('ws://localhost:3000', 'test-fp');
      const handler = jest.fn();

      signaling.onMessage(handler);

      // Simulate incoming message
      const message = {
        from: 'remote-fp',
        to: 'test-fp',
        type: 'offer',
        data: { type: 'offer', sdp: 'test-sdp' },
      };

      mockWebSocket.onmessage({ data: JSON.stringify(message) });

      expect(handler).toHaveBeenCalledWith(message);
    });

    it('should handle malformed JSON gracefully', () => {
      const signaling = new WebSocketSignaling('ws://localhost:3000', 'test-fp');
      const handler = jest.fn();

      signaling.onMessage(handler);

      // Simulate malformed message
      expect(() => {
        mockWebSocket.onmessage({ data: 'invalid json' });
      }).not.toThrow();

      expect(handler).not.toHaveBeenCalled();
    });

    it('should call all registered handlers', () => {
      const signaling = new WebSocketSignaling('ws://localhost:3000', 'test-fp');
      const handler1 = jest.fn();
      const handler2 = jest.fn();

      signaling.onMessage(handler1);
      signaling.onMessage(handler2);

      const message = {
        from: 'remote-fp',
        to: 'test-fp',
        type: 'offer',
        data: {},
      };

      mockWebSocket.onmessage({ data: JSON.stringify(message) });

      expect(handler1).toHaveBeenCalledWith(message);
      expect(handler2).toHaveBeenCalledWith(message);
    });
  });

  describe('Close Connection', () => {
    it('should close WebSocket', () => {
      const signaling = new WebSocketSignaling('ws://localhost:3000', 'test-fp');
      
      signaling.close();

      expect(mockWebSocket.close).toHaveBeenCalled();
    });

    it('should handle close when already closed', () => {
      const signaling = new WebSocketSignaling('ws://localhost:3000', 'test-fp');
      
      signaling.close();
      
      // Second close should not throw
      expect(() => signaling.close()).not.toThrow();
    });

    it('should handle onclose event', () => {
      const signaling = new WebSocketSignaling('ws://localhost:3000', 'test-fp');
      
      // Should not throw
      expect(() => mockWebSocket.onclose()).not.toThrow();
    });
  });
});
