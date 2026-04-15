/**
 * mDNS Service Discovery Resolver
 * 
 * Implements local network peer discovery using mDNS-SD as per the Mau spec.
 * Service name format: <fingerprint>._mau._tcp.local
 * 
 * Currently a placeholder implementation. Full implementation requires:
 * 1. Browser: Use browser mDNS APIs when available (currently limited support)
 * 2. Node.js: Use multicast-dns or mdns npm packages
 * 3. Network permissions for multicast UDP on port 5353
 * 
 * @see README.md "MDNS Service discovery" section
 */

import type { Fingerprint, FingerprintResolver } from '../types/index.js';

/**
 * Create an mDNS resolver for local network peer discovery
 * 
 * Service name format: <fingerprint>._mau._tcp.local
 * 
 * @param options Configuration options
 * @param options.timeout Query timeout in milliseconds (default: 3000)
 * @param options.domain mDNS domain (default: 'local')
 * @returns FingerprintResolver function
 * 
 * @example
 * ```typescript
 * const resolver = mdnsResolver({ timeout: 5000 });
 * const address = await resolver('ABC123...');
 * if (address) {
 *   console.log(`Found peer at ${address}`);
 * }
 * ```
 */
export function mdnsResolver(options: {
  timeout?: number;
  domain?: string;
} = {}): FingerprintResolver {
  const timeout = options.timeout ?? 3000;
  const domain = options.domain ?? 'local';

  return async (fingerprint: Fingerprint, queryTimeout?: number): Promise<string | null> => {
    const effectiveTimeout = queryTimeout ?? timeout;
    const serviceName = `${fingerprint}._mau._tcp.${domain}.`;

    // TODO: Implement mDNS discovery
    // Browser environment: Limited mDNS support, requires browser extensions or native APIs
    // Node.js environment: Use multicast-dns package
    // 
    // Reference implementation in Go: mau/resolvers.go LocalFriendAddress()
    //
    // Steps:
    // 1. Send mDNS query for service name: <fingerprint>._mau._tcp.local
    // 2. Parse response SRV record for port and target host
    // 3. Parse response A/AAAA record for IP address
    // 4. Return "IP:Port" format
    //
    // Example using multicast-dns (Node.js):
    // const mdns = require('multicast-dns')();
    // return new Promise((resolve, reject) => {
    //   const timer = setTimeout(() => { mdns.destroy(); resolve(null); }, effectiveTimeout);
    //   mdns.query({ name: serviceName, type: 'SRV' });
    //   mdns.on('response', (response) => {
    //     const srv = response.answers.find(a => a.type === 'SRV' && a.name === serviceName);
    //     const a = response.answers.find(a => a.type === 'A');
    //     if (srv && a) {
    //       clearTimeout(timer);
    //       mdns.destroy();
    //       resolve(`${a.data}:${srv.data.port}`);
    //     }
    //   });
    // });

    console.warn(
      `mDNS resolver not implemented. Service discovery for ${serviceName} skipped. ` +
      `To enable local peer discovery, implement mDNS query using multicast-dns package ` +
      `(Node.js) or browser mDNS APIs.`
    );

    return null;
  };
}

/**
 * Create an mDNS announcer for advertising this peer on the local network
 * 
 * Service name format: <fingerprint>._mau._tcp.local
 * 
 * @param fingerprint This peer's fingerprint
 * @param port HTTP server port
 * @param options Configuration options
 * @param options.domain mDNS domain (default: 'local')
 * @returns Function to stop announcing
 * 
 * @example
 * ```typescript
 * const stop = mdnsAnnounce('ABC123...', 443);
 * // Peer is now discoverable on local network
 * // Later:
 * stop();
 * ```
 */
export function mdnsAnnounce(
  fingerprint: Fingerprint,
  port: number,
  options: { domain?: string } = {}
): () => void {
  const domain = options.domain ?? 'local';
  const serviceName = `${fingerprint}._mau._tcp.${domain}.`;

  // TODO: Implement mDNS announcement
  // Reference implementation in Go: mau/server.go (uses hashicorp/mdns)
  //
  // Steps:
  // 1. Create mDNS server/responder
  // 2. Register SRV record: <fingerprint>._mau._tcp.local -> hostname:port
  // 3. Register A/AAAA record: hostname -> IP address
  // 4. Send multicast announcements periodically
  //
  // Example using multicast-dns (Node.js):
  // const mdns = require('multicast-dns')();
  // mdns.on('query', (query) => {
  //   if (query.questions.some(q => q.name === serviceName)) {
  //     mdns.respond({
  //       answers: [
  //         { name: serviceName, type: 'SRV', data: { port, target: hostname } },
  //         { name: hostname, type: 'A', data: ipAddress }
  //       ]
  //     });
  //   }
  // });
  // return () => mdns.destroy();

  console.warn(
    `mDNS announcement not implemented. Service ${serviceName} not advertised. ` +
    `To enable local peer discovery, implement mDNS responder using multicast-dns package ` +
    `(Node.js) or browser mDNS APIs.`
  );

  return () => {
    // Cleanup when implemented
  };
}
