# Privacy & Security

This document covers security best practices, threat models, and defensive programming patterns when building Mau applications.

## Overview

Mau uses **defense in depth**: multiple layers of security protect user data and prevent attacks. Understanding these layers helps you build secure applications on top of Mau.

**Core Security Primitives:**
- **PGP** - Identity, authentication, signing, encryption
- **TLS 1.3** - Transport security with mutual authentication
- **Path validation** - Prevent directory traversal attacks
- **Filesystem isolation** - User data scoped to their directory

---

## Threat Model

### What Mau Protects Against

✅ **Eavesdropping** - Content encrypted end-to-end with PGP  
✅ **Impersonation** - PGP signatures verify sender identity  
✅ **Tampering** - Signed content detects modifications  
✅ **Path traversal** - Filename validation prevents escaping user directory  
✅ **Man-in-the-middle** - TLS with mutual authentication  

### What Mau Does NOT Protect Against

❌ **Compromised user machine** - If attacker has filesystem access, they can read unencrypted files  
❌ **Key compromise** - Stolen PGP keys allow impersonation  
❌ **Social engineering** - Users can be tricked into sharing private content  
❌ **Denial of service** - Open network means malicious peers can flood requests  
❌ **Metadata analysis** - Who talks to whom is visible on the network  

**Design Philosophy:** Mau assumes an adversary on the network but trusts the local filesystem.

---

## Path Traversal Prevention

### The Attack

Path traversal (also called directory traversal) allows attackers to access files outside the intended directory:

```
# Attack: Try to read /etc/passwd
GET /alice-fingerprint/../../../etc/passwd

# Attack: Try to escape user directory
POST /alice-fingerprint/../../../../tmp/malicious.sh
```

### Mau's Defense

Mau validates **all filenames** before filesystem operations using three security functions:

#### 1. `containsPathSeparator(filename string) bool`

**Purpose:** Detects path separators in filenames  
**Rejects:** `/`, `\` (Unix and Windows separators)

```go
// ✅ Valid
containsPathSeparator("hello.txt")        // false
containsPathSeparator("my photo.jpg")     // false

// ❌ Invalid
containsPathSeparator("../etc/passwd")    // true
containsPathSeparator("dir/file.txt")     // true
containsPathSeparator("C:\\Windows\\win.ini") // true
```

#### 2. `isRelativePathComponent(component string) bool`

**Purpose:** Detects relative path components  
**Rejects:** `.`, `..`, `./`, `../`

```go
// ✅ Valid
isRelativePathComponent("hello.txt")      // false
isRelativePathComponent(".hidden")        // false (hidden files OK)

// ❌ Invalid
isRelativePathComponent(".")              // true
isRelativePathComponent("..")             // true
isRelativePathComponent("../")            // true
```

#### 3. `validateFileName(filename string) error`

**Purpose:** Complete filename validation  
**Checks:**
- Not empty
- No path separators
- No relative path components
- Not a disguised traversal attempt

```go
// ✅ Valid filenames
validateFileName("post.json")             // nil
validateFileName("my vacation photos.jpg") // nil
validateFileName("データ.txt")             // nil (unicode OK)
validateFileName(".hidden")               // nil (hidden files OK)

// ❌ Invalid filenames
validateFileName("")                      // error: empty
validateFileName("../../etc/passwd")      // error: path separator
validateFileName("..")                    // error: relative path component
validateFileName("/etc/passwd")           // error: absolute path
validateFileName("C:\\Windows\\system32") // error: Windows path
```

### Best Practices

**When building Mau applications:**

1. **Always validate user-supplied filenames:**
   ```go
   func CreatePost(filename string, content []byte) error {
       if err := validateFileName(filename); err != nil {
           return fmt.Errorf("invalid filename: %w", err)
       }
       // Safe to use filename
   }
   ```

2. **Use `path.Base()` as a secondary check:**
   ```go
   import "path"
   
   safeFilename := path.Base(userInput) // Removes path components
   if err := validateFileName(safeFilename); err != nil {
       return err
   }
   ```

3. **Never concatenate paths with `+`:**
   ```go
   // ❌ Dangerous
   filepath := userDir + "/" + filename
   
   // ✅ Safe
   filepath := path.Join(userDir, filename)
   ```

4. **Reject suspicious patterns early:**
   ```go
   // Reject filenames with multiple dots suspiciously placed
   if strings.Contains(filename, "..") {
       return errors.New("suspicious filename pattern")
   }
   ```

---

## PGP Security

### Key Management

**Passphrase Strength:**
- Minimum 12 characters
- Mix uppercase, lowercase, numbers, symbols
- Never reuse passphrases across identities
- Consider using a password manager

**Key Storage:**
- Store private keys in `~/.mau/` with restrictive permissions (0600)
- Back up keys securely (encrypted USB, password manager vault)
- Never commit keys to version control
- Consider hardware tokens (Yubikey) for high-value identities

**Key Expiration:**
```go
// Set expiration when generating keys
account, err := mau.NewAccount(
    accountDir,
    "Alice",
    "alice@example.com",
    passphrase,
    mau.WithKeyExpiration(365 * 24 * time.Hour), // 1 year
)
```

**Why expiration matters:** Forces key rotation, limits damage from undetected compromise.

### Signing

**Always sign public content:**
```go
// Mau signs automatically when saving files
file, err := account.AddFile(reader, "post.json", nil) // nil = public
```

**Verify signatures when reading:**
```go
// Mau verifies automatically
reader, err := file.Reader(account)
if err != nil {
    // Signature verification failed
    log.Printf("WARNING: Invalid signature on %s", file.Name())
}
```

### Encryption

**Encrypt private content:**
```go
// Encrypt for specific friends
friends := []*mau.Friend{alice, bob}
file, err := account.AddFile(reader, "private-note.txt", friends)
```

**Understand encryption scope:**
- **Content** is encrypted (PGP armor)
- **Filename** is NOT encrypted (visible in directory listings)
- **File size** is visible (metadata leakage)

**Sensitive filenames:** Use obfuscated names for private content
```go
// ❌ Leaks information
"my-secret-bitcoin-wallet-backup.txt"

// ✅ Obscured
"note-2026-03-06.txt"
```

---

## HTTP API Security

### TLS Mutual Authentication

Mau uses TLS 1.3 with **mutual authentication** - both client and server verify each other's PGP identity.

**Starting secure server:**
```go
server, err := mau.NewServer(account, ":8443")
if err != nil {
    log.Fatal(err)
}

// Serve with TLS using PGP-derived certificates
server.ServeTLS()
```

**What this prevents:**
- Man-in-the-middle attacks
- Impersonation (both ways)
- Eavesdropping on transit

### Request Validation

**Always validate incoming filenames:**
```go
func HandleFileRequest(w http.ResponseWriter, r *http.Request) {
    filename := r.URL.Query().Get("file")
    
    if err := validateFileName(filename); err != nil {
        http.Error(w, "Invalid filename", http.StatusBadRequest)
        return
    }
    
    // Safe to serve file
}
```

**Rate limiting:**
```go
// Prevent abuse
limiter := rate.NewLimiter(rate.Every(time.Second), 10) // 10 req/sec

if !limiter.Allow() {
    http.Error(w, "Rate limit exceeded", http.StatusTooManyRequests)
    return
}
```

---

## Network Security

### Peer Trust Model

**Mau's network is permissionless:** Anyone can join the Kademlia DHT and connect to your node.

**Defense strategy:**
1. **Verify signatures** - Never trust unsigned content
2. **Validate fingerprints** - Check peer identity against expected values
3. **Limit exposure** - Only share what you intend to be public
4. **Monitor anomalies** - Log unusual connection patterns

### Firewall Configuration

**Recommended rules:**
```bash
# Allow Mau HTTP server (adjust port as needed)
ufw allow 8443/tcp comment "Mau HTTPS"

# Allow Kademlia DHT (UDP)
ufw allow 4446/udp comment "Mau DHT"

# Allow mDNS (local discovery)
ufw allow 5353/udp comment "Mau mDNS"

# Default deny
ufw default deny incoming
ufw default allow outgoing
```

### Private Networks

**Running Mau on local networks only:**
```go
// Listen on localhost only (no external access)
server, err := mau.NewServer(account, "127.0.0.1:8443")

// Or listen on local network only
server, err := mau.NewServer(account, "192.168.1.100:8443")
```

**Tailscale/VPN integration:** Bind Mau to VPN interface for private networks with friends.

---

## Filesystem Security

### Permissions

**Set restrictive permissions on Mau directories:**
```bash
# User-only read/write
chmod 700 ~/.mau/
chmod 600 ~/.mau/*.key
chmod 600 ~/.mau/config.json

# Content can be slightly more permissive
chmod 755 ~/.mau/<fingerprint>/
chmod 644 ~/.mau/<fingerprint>/*.pgp
```

### Backup Security

**Encrypted backups:**
```bash
# Backup with GPG encryption
tar czf - ~/.mau/ | gpg -e -r alice@example.com > mau-backup.tar.gz.gpg

# Restore
gpg -d mau-backup.tar.gz.gpg | tar xzf -
```

**Cloud backup risks:**
- **Metadata leaks** - Filenames and directory structure visible
- **Access logs** - Provider knows when you access files
- **Compromise** - Provider breach exposes encrypted files

**Best practice:** Encrypt backups before uploading to cloud storage.

---

## Application-Level Security

### Input Sanitization

**Never trust user input:**
```go
// Sanitize before saving
func SanitizeContent(content string) string {
    // Remove null bytes
    content = strings.ReplaceAll(content, "\x00", "")
    
    // Limit size
    if len(content) > 1_000_000 { // 1MB
        content = content[:1_000_000]
    }
    
    return content
}
```

### Schema Validation

**Validate JSON-LD structure:**
```go
type SocialMediaPosting struct {
    Context string `json:"@context" validate:"required,url"`
    Type    string `json:"@type" validate:"required,eq=SocialMediaPosting"`
    Headline string `json:"headline" validate:"required,min=1,max=280"`
}

func ValidatePost(data []byte) error {
    var post SocialMediaPosting
    if err := json.Unmarshal(data, &post); err != nil {
        return err
    }
    
    validate := validator.New()
    return validate.Struct(post)
}
```

---

## Security Checklist

Before deploying a Mau application:

- [ ] All user-supplied filenames validated with `validateFileName()`
- [ ] PGP keys have strong passphrases (12+ chars)
- [ ] Private keys stored with 0600 permissions
- [ ] Key expiration set (recommend 1-2 years)
- [ ] TLS enabled for HTTP server
- [ ] Rate limiting implemented
- [ ] Firewall configured to allow only necessary ports
- [ ] Sensitive filenames obfuscated
- [ ] File size limits enforced
- [ ] Backup strategy in place (encrypted)
- [ ] Logging enabled for security events
- [ ] Update mechanism for security patches

---

## Reporting Security Issues

Found a security vulnerability in Mau?

**DO NOT open a public GitHub issue.**

Instead:
1. Email: security@mau-network.org (or use Keybase encrypted messaging)
2. Include: Description, reproduction steps, impact assessment
3. Allow: 90 days for patch before public disclosure

We take security seriously and will respond promptly.

---

## Further Reading

- **[OWASP Path Traversal](https://owasp.org/www-community/attacks/Path_Traversal)**
- **[PGP Best Practices](https://riseup.net/en/security/message-security/openpgp/best-practices)**
- **[TLS 1.3 RFC](https://tools.ietf.org/html/rfc8446)**
- **[Go Security Best Practices](https://github.com/Checkmarx/Go-SCP)**

---

*Last updated: 2026-03-06*
