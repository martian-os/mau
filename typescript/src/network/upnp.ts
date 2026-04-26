/**
 * UPnP NAT Traversal Module
 * 
 * Implements automatic port forwarding using Universal Plug and Play (UPnP)
 * to enable connections through home routers/NAT devices.
 * 
 * Spec reference: NAT Traversal section - UPnP for automatic port opening
 */

import type { MauError } from '../types/index.js';

export interface UPnPMapping {
  /** External port visible to the internet */
  externalPort: number;
  /** Internal port on this machine */
  internalPort: number;
  /** Protocol (TCP or UDP) */
  protocol: 'TCP' | 'UDP';
  /** Human-readable description */
  description: string;
  /** Lease duration in seconds (0 = permanent) */
  leaseDuration: number;
}

export interface UPnPClient {
  /**
   * Add a port mapping on the gateway device
   * 
   * @param mapping Port mapping configuration
   * @returns External IP address that was mapped
   * @throws {MauError} If UPnP is not available or mapping fails
   */
  addPortMapping(mapping: UPnPMapping): Promise<string>;

  /**
   * Remove a port mapping from the gateway device
   * 
   * @param externalPort Port to remove
   * @param protocol Protocol (TCP or UDP)
   */
  removePortMapping(externalPort: number, protocol: 'TCP' | 'UDP'): Promise<void>;

  /**
   * Get the external IP address of the gateway
   * 
   * @returns External IP address visible to the internet
   */
  getExternalIP(): Promise<string>;

  /**
   * Cleanup all port mappings created by this client
   */
  shutdown(): Promise<void>;
}

/**
 * Browser-compatible UPnP client (placeholder)
 * 
 * Note: Full UPnP support requires Node.js or native code due to:
 * - SSDP multicast (UDP port 1900)
 * - SOAP XML requests to IGD devices
 * 
 * For browser environments, use WebRTC with STUN/TURN or rely on:
 * - Server-assisted hole punching
 * - Public relay servers
 * - Browser extension for UPnP (future possibility)
 */
class BrowserUPnPClient implements UPnPClient {
  private mappings: Map<string, UPnPMapping> = new Map();

  async addPortMapping(mapping: UPnPMapping): Promise<string> {
    console.warn('[UPnP] Browser environment detected - UPnP not available');
    console.warn('[UPnP] Consider using STUN/TURN servers for NAT traversal');
    
    const key = `${mapping.externalPort}:${mapping.protocol}`;
    this.mappings.set(key, mapping);
    
    // Return a placeholder IP - in practice, WebRTC handles this
    return '0.0.0.0';
  }

  async removePortMapping(externalPort: number, protocol: 'TCP' | 'UDP'): Promise<void> {
    const key = `${externalPort}:${protocol}`;
    this.mappings.delete(key);
  }

  async getExternalIP(): Promise<string> {
    console.warn('[UPnP] Browser cannot determine external IP via UPnP');
    return '0.0.0.0';
  }

  async shutdown(): Promise<void> {
    this.mappings.clear();
  }
}

/**
 * Node.js UPnP client using nat-upnp package
 * 
 * Requires: npm install nat-upnp
 */
class NodeUPnPClient implements UPnPClient {
  private client: any;
  private mappings: Map<string, UPnPMapping> = new Map();

  constructor(client: any) {
    this.client = client;
  }

  async addPortMapping(mapping: UPnPMapping): Promise<string> {
    try {
      await this.client.portMapping({
        public: mapping.externalPort,
        private: mapping.internalPort,
        protocol: mapping.protocol,
        description: mapping.description,
        ttl: mapping.leaseDuration,
      });

      const key = `${mapping.externalPort}:${mapping.protocol}`;
      this.mappings.set(key, mapping);

      // Get external IP after successful mapping
      const ip = await this.getExternalIP();
      console.log(`[UPnP] Mapped ${mapping.description}: ${ip}:${mapping.externalPort} -> ${mapping.internalPort}/${mapping.protocol}`);
      
      return ip;
    } catch (err) {
      console.error('[UPnP] Failed to add port mapping:', err);
      throw new Error(`UPnP port mapping failed: ${err}`);
    }
  }

  async removePortMapping(externalPort: number, protocol: 'TCP' | 'UDP'): Promise<void> {
    try {
      await this.client.portUnmapping({
        public: externalPort,
        protocol: protocol,
      });

      const key = `${externalPort}:${protocol}`;
      this.mappings.delete(key);
      
      console.log(`[UPnP] Removed mapping: ${externalPort}/${protocol}`);
    } catch (err) {
      console.error('[UPnP] Failed to remove port mapping:', err);
    }
  }

  async getExternalIP(): Promise<string> {
    try {
      const ip = await this.client.externalIp();
      return ip;
    } catch (err) {
      console.error('[UPnP] Failed to get external IP:', err);
      throw new Error(`UPnP external IP query failed: ${err}`);
    }
  }

  async shutdown(): Promise<void> {
    // Remove all mappings
    const promises = Array.from(this.mappings.entries()).map(([_, mapping]) =>
      this.removePortMapping(mapping.externalPort, mapping.protocol)
    );
    await Promise.all(promises);
    
    this.mappings.clear();
    
    // Close UPnP client
    if (this.client && typeof this.client.close === 'function') {
      this.client.close();
    }
  }
}

/**
 * Create a UPnP client appropriate for the current environment
 * 
 * @param timeout Discovery timeout in milliseconds (default: 5000)
 * @returns UPnPClient instance
 */
export async function createUPnPClient(timeout: number = 5000): Promise<UPnPClient> {
  // Detect environment
  const isNode = typeof process !== 'undefined' && 
                 process.versions != null && 
                 process.versions.node != null;

  if (isNode) {
    try {
      // Dynamic import for Node.js-only package
      const natUpnp = await import('nat-upnp');
      const client = natUpnp.createClient();
      
      // Test if gateway is reachable
      await Promise.race([
        client.getMappings(),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('UPnP discovery timeout')), timeout)
        ),
      ]);
      
      console.log('[UPnP] Gateway discovered successfully');
      return new NodeUPnPClient(client);
    } catch (err) {
      console.warn('[UPnP] Failed to initialize UPnP client:', err);
      console.warn('[UPnP] Falling back to browser mode (no UPnP)');
      return new BrowserUPnPClient();
    }
  } else {
    // Browser environment - UPnP not available
    return new BrowserUPnPClient();
  }
}

/**
 * Helper: Map Mau HTTP server port for external access
 * 
 * @param internalPort Port the Mau server is listening on
 * @param externalPort External port to request (defaults to same as internal)
 * @returns External IP and port that was mapped
 */
export async function mapMauServerPort(
  internalPort: number,
  externalPort?: number
): Promise<{ ip: string; port: number }> {
  const client = await createUPnPClient();
  
  const mapping: UPnPMapping = {
    externalPort: externalPort || internalPort,
    internalPort,
    protocol: 'TCP',
    description: 'Mau P2P Social Network',
    leaseDuration: 3600, // 1 hour lease, renewable
  };

  const ip = await client.addPortMapping(mapping);
  
  return {
    ip,
    port: mapping.externalPort,
  };
}
