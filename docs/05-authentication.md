# Authentication & Encryption

This guide explains how Mau handles identity, authentication, encryption, and trust. Understanding these concepts is essential for building secure peer-to-peer applications.

## Table of Contents

1. [Identity Model](#identity-model)
2. [PGP Key Management](#pgp-key-management)
3. [Encryption & Signing](#encryption--signing)
4. [TLS Mutual Authentication](#tls-mutual-authentication)
5. [Trust & Verification](#trust--verification)
6. [Security Best Practices](#security-best-practices)

---

## Identity Model

### Fingerprints as Identifiers

In Mau, **your PGP key fingerprint IS your identity**. There are no usernames, no central registries, no OAuth providers.

```
Fingerprint: 5D000B2F2C040A1675B49D7F0C7CB7DC36999D56
             └────────────────────────────────────────┘
                      160 bits (40 hex chars)
```

**Key properties:**
- **Globally unique** - Cryptographically impossible to duplicate
- **Self-sovereign** - You generate it yourself, no permission needed
- **Permanent** - Never changes (unless you generate a new key)
- **Verifiable** - Anyone can verify your signature

### No Centralized Authority

Unlike traditional social networks:

❌ **Traditional:**
```
Username: @alice
Server: twitter.com
Authority: Twitter Inc. controls the namespace
Risk: Can be suspended, deleted, or taken away
```

✅ **Mau:**
```
Identity: 5D000B2F2C040A1675B49D7F0C7CB7DC36999D56
Authority: Your private key (you control it)
Risk: Only you can lose it (backup your key!)
```

### Fingerprint Calculation

The fingerprint is derived from your **public key** using SHA-1:

**For RSA keys:**
```
Fingerprint = SHA-1(public_key_packet)
```

**For Ed25519 keys:**
```
Fingerprint = SHA-1(public_key_packet)
```

The calculation is deterministic—the same key always produces the same fingerprint.

---

## PGP Key Management

### Key Generation

Mau supports two key types:

#### Option 1: Ed25519 (Recommended)

**Modern, fast, and secure.** Default for new accounts.

```bash
gpg --full-generate-key
```

Choose:
```
(9) ECC (sign and encrypt) *default: Curve 25519*
Key is valid for? 0 (does not expire)
Real name: Alice Smith
Email address: alice@example.com
Comment: Mau identity
Passphrase: (enter a strong passphrase)
```

**Why Ed25519?**
- ✅ Smaller keys (~256 bits vs 4096 bits)
- ✅ Faster signing and verification
- ✅ Modern, well-audited cryptography
- ✅ Supported by all modern PGP implementations

#### Option 2: RSA 4096 (Legacy Compatibility)

For maximum compatibility with older systems:

```bash
gpg --full-generate-key
```

Choose:
```
(1) RSA and RSA (default)
What keysize do you want? 4096
Key is valid for? 0 (does not expire)
Real name: Alice Smith
Email address: alice@example.com
```

### Exporting Keys

After generation:

```bash
# Get your fingerprint
FPR=$(gpg --fingerprint alice@example.com | grep -oP '[0-9A-F]{40}' | head -1)
echo "Your fingerprint: $FPR"

# Export public key
gpg --armor --export $FPR > ~/.mau/.mau/account.pub.pgp

# Export private key (encrypted with your passphrase)
gpg --armor --export-secret-keys $FPR > ~/.mau/.mau/account.pgp
```

**⚠️ Security Warning:**
- Your **private key** is encrypted with your passphrase
- Store `account.pgp` securely (backup to encrypted USB drive)
- Never share your private key with anyone

### Key Backup Strategy

Your private key is irreplaceable. If you lose it, you lose your identity.

**Recommended backup:**

1. **Encrypted USB drive:**
   ```bash
   cp ~/.mau/.mau/account.pgp /media/usb/mau-backup-$(date +%Y%m%d).pgp
   ```

2. **Paper backup (BIP39 mnemonic - advanced):**
   Use `paperkey` to convert your key to a printable format:
   ```bash
   gpg --export-secret-key $FPR | paperkey --output-type raw > key-backup.txt
   ```
   Store in a safe or safety deposit box.

3. **Cloud backup (if encrypted):**
   ```bash
   # Encrypt backup with a separate strong password
   gpg --symmetric --cipher-algo AES256 ~/.mau/.mau/account.pgp > account-backup.gpg
   
   # Upload to cloud storage
   cp account-backup.gpg ~/Dropbox/secure-backups/
   ```

**Verification:**
```bash
# Test that you can decrypt your backup
gpg --decrypt account-backup.gpg > /tmp/test-key.pgp
gpg --import /tmp/test-key.pgp
rm /tmp/test-key.pgp
```

---

## Encryption & Signing

### The Two Primitives

Mau uses PGP for two fundamental operations:

#### 1. Signing (Prove Authenticity)

**What it does:**
- Proves a message came from you
- Prevents tampering (changes invalidate the signature)
- Doesn't hide the content

**How it works:**
```
1. Hash the message (SHA-256)
2. Encrypt the hash with your PRIVATE key
3. Attach the encrypted hash as a signature
```

**Verification:**
```
1. Decrypt the signature with your PUBLIC key
2. Hash the message independently
3. Compare: if hashes match, signature is valid
```

**Example:**
```bash
# Sign a post
echo '{"@type":"SocialMediaPosting","headline":"Hello"}' \
  | gpg --sign \
  > hello-world.json.sig
```

Anyone with your public key can verify:
```bash
gpg --verify hello-world.json.sig
# Output: Good signature from "Alice Smith <alice@example.com>"
```

#### 2. Encryption (Keep Secrets)

**What it does:**
- Hides content from everyone except intended recipients
- Only holders of the private key can decrypt

**How it works:**
```
1. Generate a random session key
2. Encrypt the message with the session key (AES-256)
3. Encrypt the session key with the recipient's PUBLIC key
4. Combine encrypted message + encrypted session key
```

**Decryption:**
```
1. Decrypt the session key with your PRIVATE key
2. Decrypt the message with the session key
```

**Example:**
```bash
# Encrypt for Bob
echo "Secret message" \
  | gpg --encrypt -r bob-FPR \
  > secret.pgp

# Bob decrypts
gpg --decrypt secret.pgp
# Output: "Secret message"
```

### Combined: Sign + Encrypt

Mau files are **both signed and encrypted**:

```bash
# Public post (encrypted to yourself, signed)
echo '{"@type":"SocialMediaPosting",...}' \
  | gpg --sign --encrypt -r alice-FPR \
  > post.json.pgp
```

**Result:**
- ✅ Only you can read it (encrypted to your key)
- ✅ Everyone can verify it's from you (signed with your key)
- ✅ Tampering is detected (signature verification fails)

**Private message (encrypted to recipient, signed):**
```bash
echo '{"@type":"Message",...}' \
  | gpg --sign --encrypt -r bob-FPR \
  > message.json.pgp
```

**Result:**
- ✅ Only Bob can read it (encrypted to his key)
- ✅ Bob can verify it's from you (signed with your key)

### Recipient Lists

You can encrypt to **multiple recipients**:

```bash
# Group message (Alice, Bob, Charlie can all decrypt)
gpg --sign --encrypt \
  -r alice-FPR \
  -r bob-FPR \
  -r charlie-FPR \
  < group-message.json \
  > group-message.json.pgp
```

**PGP structure:**
```
┌───────────────────────────────────────┐
│ Encrypted Message                      │
│                                       │
│ [Session Key encrypted for Alice]    │
│ [Session Key encrypted for Bob]      │
│ [Session Key encrypted for Charlie]  │
│                                       │
│ [AES-encrypted content]              │
│ [Signature from you]                 │
└───────────────────────────────────────┘
```

Each recipient decrypts their copy of the session key, then decrypts the content.

---

## TLS Mutual Authentication

When Mau peers connect over the network, they use **mutual TLS** (mTLS) for authentication.

### Standard TLS (Server-Only Auth)

**How HTTPS works:**
```
Browser                   Server
   │                         │
   ├──── Hello ──────────────>│
   │<──── Certificate ────────┤  (Server proves identity)
   │      [trusted by CA]     │
   │                         │
   ├──── Encrypted data ─────>│
```

**Problem:** Only the server is authenticated. The client is anonymous.

### Mutual TLS (Client + Server Auth)

**How Mau works:**
```
Alice                      Bob
   │                        │
   ├──── Hello ─────────────>│
   │<──── Certificate ───────┤  (Bob proves identity)
   │      [fingerprint: bob-FPR]
   │                        │
   ├──── Certificate ───────>│  (Alice proves identity)
   │      [fingerprint: alice-FPR]
   │                        │
   │<──── Verified ──────────┤
   ├──── Encrypted data ────>│
```

**Result:**
- ✅ Bob knows Alice is really Alice
- ✅ Alice knows Bob is really Bob
- ✅ No man-in-the-middle attacks possible

### Certificate Generation

Mau **generates X.509 certificates from your PGP key**:

```go
// Pseudocode from mau/account.go

func (a *Account) certificate() (tls.Certificate, error) {
    // Extract public key from PGP key
    pubKey := a.PGPKey.PublicKey()
    
    // Create X.509 certificate template
    template := x509.Certificate{
        SerialNumber: randomSerialNumber(),
        Subject: pkix.Name{
            CommonName: a.Fingerprint().String(),
        },
        NotBefore: time.Now(),
        NotAfter:  time.Now().Add(365 * 24 * time.Hour),
        KeyUsage:  x509.KeyUsageDigitalSignature | x509.KeyUsageKeyEncipherment,
        ExtKeyUsage: []x509.ExtKeyUsage{
            x509.ExtKeyUsageServerAuth,
            x509.ExtKeyUsageClientAuth,
        },
    }
    
    // Self-sign the certificate
    derBytes := x509.CreateCertificate(template, pubKey, privKey)
    
    return tls.Certificate{
        Certificate: [][]byte{derBytes},
        PrivateKey:  privKey,
    }
}
```

**Key points:**
- The certificate **Common Name (CN)** is your fingerprint
- The certificate is **self-signed** (no CA needed)
- Valid for 1 year, regenerated automatically

### Fingerprint Verification

During the TLS handshake, Mau verifies the peer's fingerprint:

```go
// Pseudocode from mau/client.go

func (c *Client) verifyPeerCertificate(rawCerts [][]byte) error {
    // Parse the peer's certificate
    cert := x509.ParseCertificate(rawCerts[0])
    
    // Extract fingerprint from certificate
    fingerprint := FingerprintFromCert(cert)
    
    // Check if we trust this fingerprint
    expectedFPR := c.expectedPeerFingerprint()
    
    if fingerprint != expectedFPR {
        return errors.New("peer fingerprint mismatch")
    }
    
    return nil
}
```

**This prevents:**
- ❌ Man-in-the-middle attacks
- ❌ DNS spoofing
- ❌ Rogue peers impersonating friends

### TLS Configuration

Mau requires **TLS 1.3** with strong ciphers:

```go
tlsConfig := &tls.Config{
    Certificates: []tls.Certificate{myCert},
    ClientAuth:   tls.RequireAnyClientCert,
    MinVersion:   tls.VersionTLS13,
    CipherSuites: []uint16{
        tls.TLS_AES_128_GCM_SHA256,
        tls.TLS_AES_256_GCM_SHA384,
        tls.TLS_CHACHA20_POLY1305_SHA256,
    },
    VerifyPeerCertificate: verifyPeerCertificate,
}
```

**Security properties:**
- ✅ Forward secrecy (ephemeral keys)
- ✅ Authenticated encryption (AEAD ciphers)
- ✅ Modern protocol (TLS 1.3)

---

## Trust & Verification

### The Web of Trust

Mau doesn't use Certificate Authorities (CAs). Instead, trust is **direct and explicit**.

#### Adding a Friend

**Step 1: Obtain their fingerprint**

Verify the fingerprint through a **secure channel**:
- ✅ In person (QR code, phone screen)
- ✅ Video call (they show their fingerprint)
- ✅ Their website (HTTPS with valid certificate)
- ✅ Signed email (if you already trust their email key)

**Step 2: Import their public key**

```bash
# Alice wants to follow Bob

# Download Bob's public key
curl https://bob.example.com/bob-FPR.pub.pgp -o /tmp/bob.pgp

# Verify the fingerprint matches
gpg --import /tmp/bob.pgp
gpg --fingerprint bob@example.com
# Check: Does it match the fingerprint Bob gave you?

# If yes, save to Mau
cp /tmp/bob.pgp ~/.mau/.mau/bob-FPR.pgp
```

**Step 3: Encrypt the key**

Mau encrypts friend keys with your own key (proves *you* added them):

```bash
# Encrypt Bob's key with Alice's key
gpg --encrypt -r alice-FPR < ~/.mau/.mau/bob-FPR.pgp > ~/.mau/.mau/bob-FPR.pgp.enc
mv ~/.mau/.mau/bob-FPR.pgp.enc ~/.mau/.mau/bob-FPR.pgp
```

This prevents malware from injecting fake friends.

### Signature Verification

Every time you sync a file, Mau verifies the signature:

```go
// Pseudocode

func (c *Client) syncFile(fpr Fingerprint, filename string) error {
    // Download file
    content := c.download(fpr, filename)
    
    // Decrypt (if encrypted to you)
    decrypted := gpg.Decrypt(content)
    
    // Verify signature
    signature := gpg.ExtractSignature(decrypted)
    signer := gpg.VerifySignature(signature, decrypted)
    
    if signer != fpr {
        return errors.New("signature mismatch: file claims to be from " +
            fpr + " but signed by " + signer)
    }
    
    // Valid! Save to disk
    save(fpr + "/" + filename, decrypted)
}
```

**This prevents:**
- ❌ Impersonation (can't fake someone else's signature)
- ❌ Tampering (changes break the signature)
- ❌ Replay attacks (timestamp in signature)

### Key Revocation

If your key is compromised:

**Step 1: Generate a revocation certificate**

```bash
gpg --gen-revoke alice-FPR > revocation-cert.asc
```

Keep this in a safe place (print it, store offline).

**Step 2: Publish the revocation**

```bash
# Import the revocation
gpg --import revocation-cert.asc

# Export your now-revoked key
gpg --armor --export alice-FPR > ~/.mau/.mau/account.pub.pgp

# Peers will see the revocation when they sync
```

**Step 3: Generate a new key**

```bash
gpg --full-generate-key
# Follow key generation steps above
```

**Step 4: Notify friends**

Post a signed message from your **new key** referencing your **old key**:

```json
{
  "@context": "https://schema.org",
  "@type": "Message",
  "headline": "Key Transition",
  "text": "My old key (alice-FPR-OLD) was compromised. New key: alice-FPR-NEW",
  "author": {
    "@type": "Person",
    "identifier": "alice-FPR-NEW"
  },
  "about": "alice-FPR-OLD"
}
```

---

## Security Best Practices

### 1. Passphrase Strength

Your private key is only as secure as your passphrase.

**❌ Weak:**
```
password123
alice2026
qwerty
```

**✅ Strong:**
```
correct-horse-battery-staple (Diceware)
aPj#9$mK2*vL&qR (random)
My cat's name is Whiskers and she was born in 2019! (passphrase)
```

**Recommendation:** Use a password manager to generate and store a 20+ character random passphrase.

### 2. Key Storage

**Best:**
- Hardware security module (YubiKey, Nitrokey)
- Encrypted USB drive (offline backup)
- Paper backup (BIP39 mnemonic)

**Acceptable:**
- Encrypted disk partition
- Password-protected GPG keyring

**❌ Never:**
- Unencrypted cloud storage (Dropbox, Google Drive)
- Email attachments
- Unencrypted USB drives

### 3. Fingerprint Verification

Always verify fingerprints through a **second channel**:

**Scenario:** Alice meets Bob online

❌ **Wrong:**
```
Bob (Telegram): My fingerprint is 5D000B...
Alice: OK, I'll add you!
```

✅ **Right:**
```
Bob (Telegram): Let's verify fingerprints
Alice: Video call?
[Video call: Bob shows fingerprint on his screen]
Alice: Confirmed, matches your profile!
```

**Why?** If Bob's Telegram is hacked, the attacker could send a fake fingerprint.

### 4. Regular Key Rotation

**Recommendation:** Generate new keys every 2-3 years.

**Process:**
1. Generate new key
2. Sign a transition message with both keys
3. Post transition message from new key
4. Keep old key for 6 months (for verification)
5. Revoke old key

**Benefit:** Limits damage from long-term key compromise.

### 5. Encrypted Backups

If you back up your `~/.mau/` directory:

```bash
# Create encrypted tarball
tar czf - ~/.mau | gpg --symmetric --cipher-algo AES256 > mau-backup.tar.gz.gpg

# Restore
gpg --decrypt mau-backup.tar.gz.gpg | tar xzf -
```

**Never** store unencrypted backups on cloud services.

### 6. Audit Your Contacts

Periodically review `~/.mau/.mau/`:

```bash
# List all stored public keys
ls ~/.mau/.mau/*.pgp | while read key; do
    echo "Key: $key"
    gpg --list-packets "$key" 2>/dev/null | grep -E "userid|created"
done
```

**Remove keys you no longer trust:**
```bash
# Hide (don't delete—keeps history)
mv ~/.mau/suspicious-FPR/ ~/.mau/.suspicious-FPR/
```

### 7. Monitor for Impersonation

Check for peers claiming to be someone you know:

```bash
# Search DHT for fingerprints similar to yours
mau kademlia find alice-FPR-similar
```

If you find an impersonator:
1. Warn your contacts
2. Report to DHT bootstrap nodes
3. Sign a message clarifying your real fingerprint

---

## Next Steps

Now that you understand Mau's authentication model:

👉 **[Peer-to-Peer Networking](06-networking.md)** - Learn how peers discover and connect  
👉 **[HTTP API Reference](07-http-api.md)** - Build clients that sync securely  
👉 **[Building Social Apps](08-building-social-apps.md)** - Practical authentication patterns

---

## Appendix: Cryptographic Primitives

### Algorithms Used

| Component | Algorithm | Key Size | Purpose |
|-----------|-----------|----------|---------|
| **Identity** | Ed25519 or RSA | 256-bit / 4096-bit | Signing & Encryption |
| **Signing** | EdDSA or RSA-PSS | 256-bit / 4096-bit | Prove authenticity |
| **Encryption** | AES-256-GCM | 256-bit | Confidentiality |
| **Key Exchange** | Curve25519 | 256-bit | Session key agreement |
| **Fingerprint** | SHA-1 | 160-bit | Key identification |
| **TLS** | TLS 1.3 | — | Transport security |

### Why SHA-1 for Fingerprints?

**Q:** Isn't SHA-1 broken?

**A:** SHA-1 collision attacks exist, but Mau uses SHA-1 safely:

1. **Collision resistance not required** - Fingerprints identify keys, not authenticate messages
2. **PGP standard** - SHA-1 is the established fingerprint format (RFC 4880)
3. **Second preimage attacks still infeasible** - Can't craft a key matching an existing fingerprint
4. **Compatibility** - All PGP implementations use SHA-1 fingerprints

If concerned, Mau also supports SHA-256 fingerprints for future-proofing.

### Ed25519 vs RSA

| Property | Ed25519 | RSA 4096 |
|----------|---------|----------|
| **Key size** | 256 bits | 4096 bits |
| **Signature size** | 64 bytes | 512 bytes |
| **Sign speed** | ~100k ops/sec | ~2k ops/sec |
| **Verify speed** | ~50k ops/sec | ~50k ops/sec |
| **Security level** | 128-bit | 128-bit |
| **Standardization** | RFC 8032 (2017) | PKCS#1 (1991) |
| **Adoption** | Modern systems | Universal |

**Recommendation:** Use Ed25519 unless you need compatibility with old PGP implementations (pre-2015).

---

*For more on Mau's security model, see **[Privacy & Security](09-privacy-security.md)***
