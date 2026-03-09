# 06 - Networking & Peer Discovery

This document describes Mau's peer-to-peer networking architecture, covering local network discovery via mDNS, internet-scale routing via Kademlia DHT, and the peer communication protocols.

## Table of Contents

- [Overview](#overview)
- [Network Stack](#network-stack)
- [Local Discovery (mDNS)](#local-discovery-mdns)
- [Internet Routing (Kademlia DHT)](#internet-routing-kademlia-dht)
- [Peer Communication](#peer-communication)
- [NAT Traversal](#nat-traversal)
- [Bootstrap Process](#bootstrap-process)
- [Practical Examples](#practical-examples)

## Overview

Mau uses a hybrid approach to peer discovery and communication:

1. **Local Network (mDNS)**: Discover peers on the same LAN without external infrastructure
2. **Internet (Kademlia DHT)**: Route to peers across the internet using a distributed hash table
3. **HTTP/2 over TLS**: All communication uses mutual TLS for authentication and encryption

This architecture provides:

- **Zero-configuration local networking**: Peers automatically discover each other on LANs
- **Decentralized internet routing**: No central servers required for peer discovery
- **Strong authentication**: Mutual TLS ensures every connection is authenticated
- **Gradual scaling**: Start on local networks, expand to internet as needed

## Network Stack

```
┌─────────────────────────────────────┐
│     Application Layer (HTTP/2)      │
│  (/posts, /timeline, /kad/*)        │
├─────────────────────────────────────┤
│     Transport (Mutual TLS/TCP)      │
│  - Certificate = PGP public key     │
│  - Fingerprint = Node ID            │
├─────────────────────────────────────┤
│        Discovery & Routing          │
│  - mDNS (LAN)                       │
│  - Kademlia DHT (Internet)          │
└─────────────────────────────────────┘
```

**Key Design Choices:**

- **HTTP/2 over TLS**: Reuses web infrastructure, widely supported, allows multiplexing
- **PGP-based TLS**: Certificates contain PGP public keys → authentication is identity verification
- **Fingerprint as Node ID**: The 160-bit PGP fingerprint serves as the Kademlia node identifier
- **DNS/IP in certificates**: Peers exchange addresses via TLS certificate `DNSNames` field

## Local Discovery (mDNS)

Multicast DNS Service Discovery (mDNS-SD) allows peers to announce and discover each other on local area networks without DNS servers or manual configuration.

### Service Announcement

When a Mau server starts, it announces itself using the service name format:

```
<FINGERPRINT>._mau._tcp.local.
```

**Example:**
```
5D000B2F2C040A1675B49D7F0C7CB7DC36999D56._mau._tcp.local.
```

- **Fingerprint**: 40 hex characters (160 bits) - the PGP key fingerprint
- **Service**: `_mau._tcp` - identifies Mau instances using TCP
- **Domain**: `local` - mDNS domain for link-local networks

### Discovery Process

Peers discover each other by listening for mDNS announcements:

```go
// Query for all Mau services on the network
mdns.Lookup("_mau._tcp", entriesCh)

// Filter for specific friend's fingerprint
targetName := fmt.Sprintf("%s._mau._tcp.local.", friendFingerprint)
for entry := range entriesCh {
    if entry.Name == targetName {
        // Found friend at entry.AddrV4:entry.Port
        address := fmt.Sprintf("%s:%d", entry.AddrV4, entry.Port)
        break
    }
}
```

### When to Use mDNS

**✅ Use mDNS for:**
- Home networks (family, roommates)
- Office LANs (colleagues)
- Local events (conferences, meetups)
- Development/testing environments

**❌ Don't rely on mDNS for:**
- Internet-scale communication
- Networks with mDNS disabled (some corporate firewalls)
- Mobile networks (often blocked or unreliable)

### mDNS Implementation Details

**Server setup** (`server.go`):

```go
// Create mDNS service
fingerprint := account.Fingerprint().String()
service, err := mdns.NewMDNSService(
    fingerprint,         // Instance name (the fingerprint)
    "_mau._tcp",        // Service type
    "",                 // Domain (empty = ".local")
    "",                 // Hostname (empty = use system)
    port,               // Port number
    nil,                // IPs (nil = auto-detect)
    []string{},         // TXT records (optional metadata)
)

// Start mDNS server
server, err := mdns.NewServer(&mdns.Config{Zone: service})
```

**Client lookup** (`resolvers.go`):

```go
func LocalFriendAddress(ctx context.Context, fingerprint Fingerprint, addresses chan<- string) error {
    name := fmt.Sprintf("%s._mau._tcp.local.", fingerprint)
    entriesCh := make(chan *mdns.ServiceEntry, 1)
    
    err := mdns.Lookup("_mau._tcp", entriesCh)
    if err != nil {
        return err
    }
    
    for {
        select {
        case entry := <-entriesCh:
            if entry.Name == name {
                addresses <- fmt.Sprintf("%s:%d", entry.AddrV4, entry.Port)
                return nil
            }
        case <-ctx.Done():
            return nil
        }
    }
}
```

### mDNS Limitations

- **No authentication in announcement**: Anyone can claim any fingerprint (mitigated by TLS verification)
- **Network scope**: Only works within multicast reachable networks
- **IPv6 support**: May fail if IPv6 is disabled on system (gracefully degrades)
- **Corporate networks**: Often blocked by firewall policies

## Internet Routing (Kademlia DHT)

For peers that are not on the same local network, Mau uses a simplified Kademlia Distributed Hash Table (DHT) for peer discovery and routing.

### Kademlia Overview

Kademlia is a peer-to-peer routing protocol that:

- Uses XOR distance metric to organize peers into a structured overlay network
- Provides O(log N) lookup time for N nodes in the network
- Self-heals through periodic bucket refreshes
- Resists various attacks through redundancy

**Mau's Simplifications:**

- **No key-value storage**: Only peer routing, no `STORE`/`FIND_VALUE` operations
- **Fingerprint as Node ID**: Use PGP fingerprint directly (already 160 bits)
- **HTTP-based RPC**: `/kad/ping` and `/kad/find_peer/<fpr>` instead of UDP
- **Mutual TLS**: Eliminates need for separate node ID verification

### Kademlia Constants

```go
const (
    dht_B                = 160              // Number of buckets (160-bit keys)
    dht_K                = 20               // Bucket size (replication parameter)
    dht_ALPHA            = 3                // Parallelism factor for lookups
    dht_STALL_PERIOD     = time.Hour        // Bucket refresh interval
    dht_PING_MIN_BACKOFF = 30 * time.Second // Rate limit pings to same peer
)
```

- **B = 160**: One bucket per bit in the fingerprint
- **K = 20**: Up to 20 peers per bucket (higher K = better fault tolerance)
- **Alpha = 3**: Query 3 peers simultaneously during lookups (balances speed vs bandwidth)

### XOR Distance Metric

Kademlia uses XOR to measure "distance" between node IDs:

```
distance(A, B) = A ⊕ B  (bitwise XOR)
```

**Properties:**

- `distance(A, A) = 0` - A node is distance 0 from itself
- `distance(A, B) = distance(B, A)` - Symmetric
- `distance(A, B) ≤ distance(A, C) + distance(C, B)` - Triangle inequality (approximately)

**Example:**

```
Fingerprint A: 5D000B2F2C040A1675B49D7F0C7CB7DC36999D56
Fingerprint B: 7A1234567890ABCDEF0123456789ABCDEF012345

XOR distance:  27123469A494A1E99AB59E34A7F51C23E9089B13
               ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
               Higher values = farther apart in the DHT
```

Nodes with **lower XOR distance** are considered **closer** in the network topology.

### Routing Table (K-Buckets)

Each node maintains 160 k-buckets, one for each possible bit difference in the fingerprint.

**Bucket i** contains peers whose fingerprint differs from yours in bit `i` (counting from the most significant bit):

```
Bucket 0:  Peers whose first bit differs   (1xxx... vs 0xxx...)
Bucket 1:  Peers whose second bit differs  (01xx... vs 00xx...)
...
Bucket 159: Peers whose last bit differs   (...xxx1 vs ...xxx0)
```

**Bucket Selection:**

```go
func (d *dhtServer) bucketFor(fingerprint Fingerprint) int {
    // Count leading matching bits between own fingerprint and peer's
    prefixLen := countMatchingBits(d.account.Fingerprint(), fingerprint)
    
    if prefixLen == 160 {
        prefixLen = 159  // Own fingerprint goes in last bucket
    }
    
    return prefixLen
}
```

**Bucket Structure:**

```go
type bucket struct {
    mutex      sync.RWMutex
    values     []*Peer        // Up to K=20 peers
    lastLookup time.Time      // Last activity timestamp
}
```

Each bucket is an **LRU cache**:
- **Head**: Least recently seen peer
- **Tail**: Most recently seen peer

When a bucket is full and a new peer arrives:
1. Ping the least recently seen peer (head)
2. If it responds: Move to tail, discard new peer
3. If it doesn't respond: Remove it, add new peer to tail

**Rationale:** Long-lived nodes are more valuable than new ones (they're more likely to stay online).

### Finding Nearest Peers

To find the K nearest peers to a target fingerprint:

```go
func (d *dhtServer) nearest(fingerprint Fingerprint, limit int) []*Peer {
    bucket := d.bucketFor(fingerprint)
    peers := []*Peer{}
    
    // Collect peers from bucket ± i in order of increasing distance
    for i := 0; i < dht_B; i++ {
        if bucket-i >= 0 {
            peers = append(peers, d.buckets[bucket-i].values...)
        }
        if bucket+i < dht_B {
            peers = append(peers, d.buckets[bucket+i].values...)
        }
    }
    
    // Sort by XOR distance to target
    sortByDistance(fingerprint, peers)
    
    // Return top K
    if len(peers) > limit {
        peers = peers[:limit]
    }
    
    return peers
}
```

### Kademlia RPC Calls

Mau implements two Kademlia RPCs over HTTP:

#### 1. PING (`/kad/ping`)

**Purpose:** Verify a peer is online and responsive.

**Request:**
```http
GET /kad/ping HTTP/2
Host: peer.example.com:8080
```

**Response:**
```http
HTTP/2 200 OK
```

**Side Effects (on server):**
- Extract fingerprint from client TLS certificate
- Extract address from certificate `DNSNames` or connection IP
- Add/update peer in appropriate k-bucket

**Implementation:**

```go
func (d *dhtServer) receivePing(w http.ResponseWriter, r *http.Request) {
    err := d.addPeerFromRequest(r)  // Extract peer info from TLS cert
    if err != nil {
        http.Error(w, err.Error(), http.StatusBadRequest)
        return
    }
    // Implicit 200 OK response
}
```

#### 2. FIND_PEER (`/kad/find_peer/<fingerprint>`)

**Purpose:** Find peers close to a target fingerprint.

**Request:**
```http
GET /kad/find_peer/5D000B2F2C040A1675B49D7F0C7CB7DC36999D56 HTTP/2
Host: peer.example.com:8080
```

**Response:**
```json
[
  {
    "fingerprint": "7A1234567890ABCDEF0123456789ABCDEF012345",
    "address": "192.168.1.100:8080"
  },
  {
    "fingerprint": "3B9876543210FEDCBA9876543210FEDCBA987654",
    "address": "peer2.example.com:8080"
  }
]
```

Returns up to K=20 peers closest to the target fingerprint.

**Side Effects:**
- Add requesting peer to routing table (from TLS certificate)
- Update `lastLookup` timestamp for queried bucket

**Implementation:**

```go
func (d *dhtServer) receiveFindPeer(w http.ResponseWriter, r *http.Request) {
    // Add requester to routing table
    d.addPeerFromRequest(r)
    
    // Parse target fingerprint from URL
    fingerprint, err := FingerprintFromString(r.PathValue("fpr"))
    if err != nil {
        http.Error(w, err.Error(), http.StatusBadRequest)
        return
    }
    
    // Return K nearest peers
    peers := d.nearest(fingerprint, dht_K)
    json.NewEncoder(w).Encode(peers)
}
```

### Iterative Peer Lookup

To find a specific peer on the internet, perform an **iterative lookup**:

```
1. Start with closest known peers from local routing table
2. Query ALPHA (3) of them in parallel for FIND_PEER
3. Add responses to candidate set
4. Query ALPHA closest unqueried peers
5. Repeat until:
   - Target peer found
   - No closer peers discovered
   - All candidates exhausted
```

**Implementation:**

```go
func (d *dhtServer) sendFindPeer(ctx context.Context, fingerprint Fingerprint) *Peer {
    // Start with K closest known peers
    nearest := d.nearest(fingerprint, dht_ALPHA)
    if len(nearest) == 0 {
        return nil  // No peers known at all
    }
    
    // Check if we already have the target
    for _, peer := range nearest {
        if peer.Fingerprint.Equal(fingerprint) {
            return peer
        }
    }
    
    // Parallel iterative lookup
    peers := newPeerRequestSet(fingerprint, nearest)
    workersCtx, cancel := context.WithCancel(context.Background())
    defer cancel()
    
    var found *Peer
    var wg sync.WaitGroup
    
    // Spawn ALPHA worker goroutines
    for i := 0; i < dht_ALPHA; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            
            for peers.len() > 0 && found == nil {
                peer := peers.get()  // Get next unqueried peer
                if peer == nil {
                    break
                }
                
                // Query this peer for target
                foundPeers, err := d.queryPeer(ctx, peer, fingerprint)
                if err != nil {
                    continue
                }
                
                // Check if target is in results
                for _, p := range foundPeers {
                    if p.Fingerprint.Equal(fingerprint) {
                        found = p
                        cancel()  // Stop other workers
                        return
                    }
                }
                
                // Add closer peers to queue
                peers.add(foundPeers...)
            }
        }()
    }
    
    wg.Wait()
    return found
}
```

### Joining the Network

When a new peer joins, it must bootstrap by:

1. Connecting to one or more **bootstrap peers** (known addresses)
2. Adding bootstrap peers to routing table
3. Performing a lookup for its own fingerprint (populates routing table with nearby peers)
4. Starting periodic bucket refresh

**Implementation:**

```go
func (d *dhtServer) Join(ctx context.Context, bootstrap []*Peer) {
    if len(bootstrap) == 0 {
        return
    }
    
    // Add bootstrap peers to routing table
    for _, peer := range bootstrap {
        d.addPeer(peer)
    }
    
    // Lookup own fingerprint to discover nearby peers
    d.sendFindPeer(ctx, d.account.Fingerprint())
    
    // Start periodic bucket refresh
    d.startRefresh()
}
```

### Bucket Refresh

To keep routing tables up-to-date, periodically refresh stale buckets:

```go
func (d *dhtServer) startRefresh() {
    ctx, cancel := context.WithCancel(context.Background())
    d.cancelRefresh = cancel
    
    go func() {
        ticker := time.NewTicker(dht_STALL_PERIOD)  // 1 hour
        defer ticker.Stop()
        
        for {
            select {
            case <-ticker.C:
                d.refreshBuckets(ctx)
            case <-ctx.Done():
                return
            }
        }
    }()
}

func (d *dhtServer) refreshBuckets(ctx context.Context) {
    for i := range d.buckets {
        if time.Since(d.buckets[i].lastLookup) > dht_STALL_PERIOD {
            // Generate random fingerprint in this bucket's range
            target := randomFingerprintInBucket(d.account.Fingerprint(), i)
            
            // Lookup to refresh routing info
            d.sendFindPeer(ctx, target)
        }
    }
}
```

## Peer Communication

Once a peer is discovered (via mDNS or Kademlia), communication uses **mutual TLS over HTTP/2**.

### TLS Certificate Structure

Mau embeds PGP public keys in X.509 TLS certificates:

```
Certificate:
  Subject: CN=<Fingerprint>
  Issuer: Self (self-signed)
  Public Key: <PGP Public Key>
  DNS Names: [hostname:port, ip:port]
  Validity: Long-lived (years)
```

**Key Properties:**

- **Subject CN = Fingerprint**: Identifies the peer
- **Public Key = PGP key**: Used for TLS and application-level encryption
- **DNS Names**: Advertises peer's addresses (hostname, IP, port)
- **Self-signed**: No central CA required

### Client Configuration

When connecting to a peer:

```go
func (a *Account) Client(fingerprint Fingerprint, ownAddresses []string) (*Client, error) {
    // Load friend's public key
    friend := a.Friend(fingerprint)
    friendCert, err := friend.Certificate()
    if err != nil {
        return nil, err
    }
    
    // Load own certificate with addresses
    ownCert, err := a.CertificateWithDNSNames(ownAddresses)
    if err != nil {
        return nil, err
    }
    
    // Configure mutual TLS
    tlsConfig := &tls.Config{
        Certificates: []tls.Certificate{ownCert},
        RootCAs:      certPoolFromCert(friendCert),
        ServerName:   fingerprint.String(),
    }
    
    client := resty.New().SetTLSClientConfig(tlsConfig)
    return &Client{client: client}, nil
}
```

**Security guarantees:**

- **Authentication**: TLS handshake verifies both parties' certificates against PGP keys
- **Encryption**: TLS 1.3 encrypts all traffic
- **Integrity**: TLS prevents tampering
- **Non-repudiation**: PGP signatures on data provide proof of authorship

### Server Configuration

```go
func (s *Server) ListenAndServe() error {
    // Load certificate with listen address
    cert, err := s.account.CertificateWithDNSNames([]string{s.address})
    if err != nil {
        return err
    }
    
    // Configure mutual TLS
    tlsConfig := &tls.Config{
        Certificates: []tls.Certificate{cert},
        ClientAuth:   tls.RequestClientCert,  // Optional client certs
    }
    
    server := &http.Server{
        Addr:      s.address,
        Handler:   s,
        TLSConfig: tlsConfig,
    }
    
    return server.ListenAndServeTLS("", "")
}
```

**Why RequestClientCert (not RequireAndVerifyClientCert)?**

- Allows unauthenticated requests (e.g., first-time peer discovery)
- Application layer validates client certificates when needed
- More flexible than transport-layer rejection

### Address Resolution

When you want to connect to a friend, resolve their fingerprint to an address:

```go
// Try resolvers in order: local (mDNS), then internet (Kademlia)
resolvers := []FingerprintResolver{
    LocalFriendAddress,
    InternetFriendAddress(server),
}

func ResolveFriend(ctx context.Context, fingerprint Fingerprint, resolvers []FingerprintResolver) (string, error) {
    addresses := make(chan string, 1)
    
    for _, resolver := range resolvers {
        err := resolver(ctx, fingerprint, addresses)
        if err != nil {
            continue
        }
        
        select {
        case address := <-addresses:
            return address, nil
        case <-ctx.Done():
            return "", ctx.Err()
        }
    }
    
    return "", errors.New("peer not found")
}
```

**Resolution order matters:**

1. **Local first**: mDNS is faster and doesn't require internet
2. **Internet fallback**: Kademlia when not on same LAN
3. **Static addresses**: Hardcoded addresses for servers (e.g., bootstrap nodes)

## NAT Traversal

Most home/office networks use NAT (Network Address Translation), which blocks unsolicited incoming connections. Mau relies on external solutions for NAT traversal:

### Current Approach: Manual Configuration

**For servers (always reachable):**

- Use port forwarding on router (map external port → internal port)
- Use a static public IP or dynamic DNS
- Add public address to TLS certificate `DNSNames`

**For clients (outbound-only):**

- No configuration needed
- Always initiate connections to servers
- Can receive on local network via mDNS

### Future: Automatic NAT Traversal

Potential solutions (not yet implemented):

1. **UPnP / NAT-PMP**: Programmatically request port forwards
   ```go
   // Example: github.com/jackpal/gateway
   gateway := gateway.DiscoverGateway()
   gateway.AddPortMapping("TCP", externalPort, internalPort, duration)
   ```

2. **UDP Hole Punching**: Use a relay server to coordinate simultaneous outbound packets
   - Requires signaling channel (could use bootstrap peer)
   - Works for symmetric NAT in many cases

3. **TURN Relay**: Fallback relay server for stubborn NATs
   - Higher latency and bandwidth cost
   - Only for peers that can't directly connect

**Current workaround**: Use Tailscale, Nebula, or other VPN overlay networks to make all peers appear on same LAN.

## Bootstrap Process

Complete workflow for a new peer joining the network:

```
┌─────────────────────────────────────────────────────────────┐
│ 1. Start Server                                             │
│    - Load account (PGP keys)                                │
│    - Generate TLS certificate                               │
│    - Start HTTP server on address:port                      │
│    - Announce via mDNS (local network)                      │
└─────────────────────────────────────────────────────────────┘
                          ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. Bootstrap Kademlia (if internet peers desired)           │
│    - Load bootstrap peer addresses from config              │
│    - Connect to bootstrap peers                             │
│    - Add them to routing table                              │
│    - Lookup own fingerprint (populates routing table)       │
└─────────────────────────────────────────────────────────────┘
                          ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. Start Bucket Refresh                                     │
│    - Every hour, refresh stale buckets                      │
│    - Keeps routing table current                            │
└─────────────────────────────────────────────────────────────┘
                          ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. Discover Friends                                         │
│    - For each friend fingerprint:                           │
│      1. Try mDNS (local network)                            │
│      2. Try Kademlia lookup (internet)                      │
│      3. Try static address (config)                         │
│    - Connect via mutual TLS                                 │
│    - Exchange content                                       │
└─────────────────────────────────────────────────────────────┘
```

**Example: Starting a server with bootstrap**

```bash
# Start with local network only (mDNS)
mau serve --address localhost:8080

# Start with internet routing (Kademlia + mDNS)
mau serve --address 0.0.0.0:8080 \
  --bootstrap 192.0.2.1:8080 \
  --bootstrap peer.example.com:8080
```

**Example: Bootstrap peer configuration**

```go
// Hardcoded bootstrap peers (like DNS root servers)
var defaultBootstrapPeers = []*Peer{
    {
        Fingerprint: mustParseFingerprint("5D000B2F2C040A1675B49D7F0C7CB7DC36999D56"),
        Address:     "bootstrap1.mau.network:8080",
    },
    {
        Fingerprint: mustParseFingerprint("7A1234567890ABCDEF0123456789ABCDEF012345"),
        Address:     "bootstrap2.mau.network:8080",
    },
}

// Join the network
server.dhtServer.Join(ctx, defaultBootstrapPeers)
```

## Practical Examples

### Example 1: Local Network (Two Laptops)

**Scenario:** Alice and Bob are on the same Wi-Fi network and want to share posts.

**Setup:**

```bash
# Alice (192.168.1.10)
mau serve --address 192.168.1.10:8080

# Bob (192.168.1.20)
mau serve --address 192.168.1.20:8080
```

**Discovery:**

1. Both servers announce via mDNS:
   - Alice: `<alice-fpr>._mau._tcp.local.`
   - Bob: `<bob-fpr>._mau._tcp.local.`

2. Alice adds Bob as friend (Bob's fingerprint in `friends/` directory)

3. When Alice's client fetches Bob's timeline:
   ```go
   // Resolve Bob's fingerprint
   ctx := context.Background()
   addresses := make(chan string, 1)
   LocalFriendAddress(ctx, bobFingerprint, addresses)
   
   // Result: "192.168.1.20:8080" (from mDNS)
   ```

4. Alice connects to Bob via mutual TLS and fetches posts

**No internet required!** All traffic stays on local network.

### Example 2: Internet (With Bootstrap)

**Scenario:** Alice (behind NAT) wants to follow Charlie (public server).

**Setup:**

```bash
# Charlie (public server, 203.0.113.50)
mau serve --address 0.0.0.0:8080 \
  --bootstrap bootstrap.mau.network:8080

# Alice (laptop, behind NAT)
mau serve --address localhost:8080 \
  --bootstrap bootstrap.mau.network:8080
```

**Discovery:**

1. Both join the Kademlia network via bootstrap peer:
   - Bootstrap adds them to its routing table
   - They lookup their own fingerprints, discover each other

2. Alice adds Charlie as friend

3. When Alice's client fetches Charlie's timeline:
   ```go
   // mDNS fails (different networks)
   // Kademlia lookup:
   peer := server.dhtServer.sendFindPeer(ctx, charlieFingerprint)
   
   // Result: {Fingerprint: charlie-fpr, Address: "203.0.113.50:8080"}
   ```

4. Alice (outbound connection) → Charlie (accepts connection)

**Charlie must be reachable**: Use port forwarding or VPS.

### Example 3: Mixed Local + Internet

**Scenario:** Alice and Bob are on same LAN, both follow Charlie (internet server).

**Setup:**

```bash
# Alice (192.168.1.10)
mau serve --address 192.168.1.10:8080 \
  --bootstrap charlie.example.com:8080

# Bob (192.168.1.20)
mau serve --address 192.168.1.20:8080 \
  --bootstrap charlie.example.com:8080

# Charlie (VPS, public IP)
mau serve --address 0.0.0.0:8080
```

**Discovery:**

- **Alice ↔ Bob**: mDNS (local, fast)
- **Alice → Charlie**: Kademlia or static address
- **Bob → Charlie**: Kademlia or static address

**Efficiency:** Local traffic stays local, only internet requests go to Charlie.

### Example 4: Mobile + Home Server

**Scenario:** Alice has a home server (Raspberry Pi) and mobile phone.

**Setup:**

```bash
# Home server (always-on, 192.168.1.100)
mau serve --address 0.0.0.0:8080 \
  --bootstrap bootstrap.mau.network:8080

# Configure router port forwarding:
# External port 8080 → 192.168.1.100:8080

# Add dynamic DNS (e.g., alice.duckdns.org → public IP)
```

**Mobile app:**

```go
// Hardcode home server as bootstrap peer
bootstrap := []*Peer{
    {
        Fingerprint: homeServerFingerprint,
        Address:     "alice.duckdns.org:8080",  // Or public IP
    },
}

server.dhtServer.Join(ctx, bootstrap)
```

**Behavior:**

- **At home (Wi-Fi)**: Mobile finds server via mDNS (fast, local)
- **Away (cellular)**: Mobile connects to server via DynDNS (internet)
- **Server acts as personal relay**: Can forward posts from friends

### Example 5: Pure P2P (No Servers)

**Scenario:** Small group of friends, all behind NAT, using VPN overlay (Tailscale).

**Setup:**

```bash
# Everyone installs Tailscale, joins same tailnet
# Everyone's Tailscale IPs become "local network"

# Alice (Tailscale IP: 100.64.0.1)
mau serve --address 100.64.0.1:8080

# Bob (Tailscale IP: 100.64.0.2)
mau serve --address 100.64.0.2:8080

# Charlie (Tailscale IP: 100.64.0.3)
mau serve --address 100.64.0.3:8080
```

**Discovery:**

mDNS works over Tailscale (all peers appear on same LAN). No port forwarding, no public IPs, no bootstrap servers needed!

**Trade-off:** Requires Tailscale (centralized coordination server), but Tailscale can't read your data.

## Security Considerations

### Kademlia-Specific Attacks

**1. Eclipse Attack**: Attacker floods victim's routing table with malicious nodes.

**Mitigation:**
- Bucket LRU eviction: Prefer long-lived nodes
- Random peer selection during lookups
- Out-of-band peer verification (QR codes, in-person exchange)

**2. Sybil Attack**: Attacker creates many fake identities.

**Mitigation:**
- Kademlia design naturally limits impact (routing table has fixed size)
- Application-level trust: Only accept content from known friends
- Possible future: Proof-of-work on peer identity

**3. Routing Manipulation**: Attacker responds with incorrect routing info.

**Mitigation:**
- Query multiple peers (Alpha = 3)
- Verify peer certificates via TLS
- Cross-check responses

### General Network Security

**1. Man-in-the-Middle (MITM)**

**Protected by:**
- Mutual TLS with known peer certificates
- PGP signatures on all content

**2. Denial of Service (DoS)**

**Vulnerabilities:**
- Bootstrap peers are DoS targets (single points of failure)
- Rate limiting on `/kad/ping` and `/kad/find_peer` endpoints

**Mitigations:**
- Distribute bootstrap peer addresses
- Implement connection rate limits
- Use multiple bootstrap peers

**3. Privacy Leaks**

**Information disclosed:**
- IP addresses in Kademlia network (peers learn your IP)
- Social graph (if fingerprints are public)

**Mitigations:**
- Use Tor or VPN for anonymity
- Use separate identities for different contexts
- Encrypt content (already done via PGP)

## Troubleshooting

### "Peer not found" errors

**Symptoms:** Can't connect to friend even though they're online.

**Debugging:**

1. **Check mDNS:**
   ```bash
   # List all Mau peers on local network
   dns-sd -B _mau._tcp local.
   ```

2. **Check Kademlia routing table:**
   ```bash
   # Show known peers
   mau peer list
   
   # Try manual lookup
   mau peer find <friend-fingerprint>
   ```

3. **Check firewall:**
   ```bash
   # Verify port is open
   nc -zv <peer-address> <port>
   ```

4. **Check TLS certificate:**
   ```bash
   # Verify peer's certificate includes correct fingerprint
   openssl s_client -connect <peer-address> -showcerts
   ```

### Kademlia routing table not populating

**Symptoms:** Bootstrap succeeds, but no peers discovered.

**Causes:**

1. **No other peers online**: Kademlia needs other nodes
   - **Solution**: Run multiple test instances

2. **Bootstrap peer not responding**:
   ```bash
   # Test bootstrap peer
   curl -k https://<bootstrap-address>/kad/ping
   ```

3. **NAT/firewall blocking**: Outbound connections blocked
   - **Solution**: Check firewall rules, try different network

### mDNS not working

**Symptoms:** Peers on same LAN can't discover each other.

**Causes:**

1. **IPv6 disabled**: mDNS library may fail silently
   - **Solution**: Enable IPv6 or check logs for warnings

2. **Multicast blocked**: Router/firewall blocks mDNS packets (UDP 5353)
   - **Solution**: Configure router to allow multicast

3. **Different VLANs**: Peers on isolated network segments
   - **Solution**: Bridge VLANs or use static addresses

## Performance Optimization

### Kademlia Tuning

**Bucket size (K):**
- Higher K = better fault tolerance, slower lookups
- Default K=20 balances these

**Parallelism (Alpha):**
- Higher Alpha = faster lookups, more bandwidth
- Default Alpha=3 is conservative

**Refresh period:**
- Shorter period = more current routing, more traffic
- Default 1 hour is reasonable for mostly-static networks

### Connection Pooling

Reuse TLS connections to peers:

```go
// Keep pool of active connections
var connPool = sync.Map{}  // Key: fingerprint, Value: *Client

func GetOrCreateClient(fpr Fingerprint) (*Client, error) {
    if client, ok := connPool.Load(fpr.String()); ok {
        return client.(*Client), nil
    }
    
    client, err := account.Client(fpr, ownAddresses)
    if err != nil {
        return nil, err
    }
    
    connPool.Store(fpr.String(), client)
    return client, nil
}
```

**Benefits:**
- Avoid repeated TLS handshakes (expensive)
- HTTP/2 connection multiplexing
- Keep-alive reduces latency

### Bandwidth Optimization

**For mobile/limited bandwidth:**

1. **Reduce bucket refresh frequency**: Every 4-6 hours instead of 1 hour
2. **Lower Alpha**: Query fewer peers in parallel (Alpha=1 or 2)
3. **Prioritize mDNS**: Only use Kademlia when necessary
4. **Static addresses for servers**: Avoid lookups for known servers

## Future Enhancements

### DHT Storage (Key-Value Pairs)

Add `STORE` and `FIND_VALUE` RPCs for decentralized storage:

- **Use case**: Store public keys, profile info, relay addresses
- **Challenge**: Need incentive mechanism (storage isn't free)

### Improved NAT Traversal

- **UPnP/NAT-PMP**: Automatic port forwarding
- **STUN/TURN**: WebRTC-style NAT traversal
- **Hole punching**: Coordinated simultaneous connections

### Geographic Optimization

Extend XOR metric with latency/geographic info:

- Prefer geographically close peers for faster content delivery
- Use latency measurements alongside XOR distance

### DHT Security Enhancements

- **Proof of Work on identities**: Rate-limit Sybil attacks
- **Reputation system**: Track reliable vs unreliable peers
- **Secure bootstrap**: Hardcode bootstrap peer fingerprints (like DNS root servers)

## Summary

Mau's networking architecture provides:

✅ **Zero-config local networking** via mDNS  
✅ **Decentralized internet routing** via Kademlia DHT  
✅ **Strong authentication** via mutual TLS + PGP  
✅ **Gradual scaling** from LAN to internet  
✅ **Resilience** through DHT self-healing  

**Next steps:**

- **For developers**: Read `kademlia.go` and `resolvers.go` for implementation details
- **For deployers**: Set up bootstrap peers for your community
- **For users**: Install and let mDNS handle local discovery automatically

---

**See also:**

- [05-authentication.md](05-authentication.md) - PGP and TLS certificate generation
- [07-http-api.md](07-http-api.md) - Application-level HTTP endpoints
- [Kademlia paper](https://pdos.csail.mit.edu/~petar/papers/maymounkov-kademlia-lncs.pdf) - Original protocol specification
- [mDNS RFC 6762](https://tools.ietf.org/html/rfc6762) - Multicast DNS specification
