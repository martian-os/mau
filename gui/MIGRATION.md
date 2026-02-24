# Mau GUI - Migration Guide

**Status:** Phases 1-5 Complete | UI Views Migration In Progress  
**Last Updated:** 2026-02-24

---

## Architecture Migration Progress

### ✅ Completed Phases

#### Phase 1: Domain Layer (Complete)
- [x] `internal/domain/post/` - Post model, Manager, Cache
- [x] `internal/domain/config/` - Configuration model, Manager
- [x] `internal/domain/account/` - Account management
- [x] Interfaces defined for all domain services

#### Phase 2: Adapters & Utilities (Complete)
- [x] `internal/adapters/storage/` - File-based implementations
- [x] `internal/adapters/notification/` - Toast/dialog notifications
- [x] `internal/domain/server/` - Server lifecycle management
- [x] `internal/ui/theme/` - Theme management
- [x] `pkg/retry/` - Retry logic extracted
- [x] `pkg/markdown/` - Markdown utilities extracted

#### Phase 3-5: App Coordinator & Entry Point (Complete)
- [x] `internal/app/app.go` - Lightweight orchestrator (~100 lines)
- [x] `cmd/mau-gui/main.go` - Explicit dependency injection
- [x] Build system working (✅ 28MB binary compiles successfully)

---

## Current State

### What Works
- ✅ Clean architecture foundation complete
- ✅ Domain logic isolated and testable
- ✅ Adapters implement domain interfaces
- ✅ Application compiles and launches
- ✅ Placeholder UI displays

### What Needs Migration
- ⏳ UI Views (home, friends, settings, timeline)
- ⏳ UI Components (post cards, markdown preview, etc.)
- ⏳ Old `main` package files cleanup
- ⏳ Full integration testing

---

## UI Views Migration Roadmap

### Remaining Files to Migrate

**Old Structure (gui/*.go):**
```
gui/
├── app.go (178 lines) - Contains MauApp struct
├── app_server.go (218 lines) - Server management [MIGRATED to domain/server]
├── app_sync.go (75 lines) - Auto-sync logic
├── app_ui.go (166 lines) - UI helpers [PARTIALLY MIGRATED to adapters/notification]
├── home_view.go (136 lines)
├── home_view_composer.go (214 lines)
├── home_view_draft.go (56 lines)
├── friends_view.go (196 lines)
├── settings_view.go (184 lines)
├── timeline_view.go (134 lines)
├── timeline_view_display.go (132 lines)
├── timeline_view_filters.go (81 lines)
├── ui_helpers.go (75 lines)
└── constants.go (195 lines)
```

**Target Structure:**
```
internal/ui/
├── components/
│   ├── post_card.go
│   ├── markdown_preview.go
│   ├── loading_spinner.go
│   └── tag_list.go
├── views/
│   ├── home/
│   │   ├── home.go
│   │   ├── composer.go
│   │   └── posts_list.go
│   ├── friends/
│   │   └── friends.go
│   ├── settings/
│   │   └── settings.go
│   └── timeline/
│       ├── timeline.go
│       ├── display.go
│       └── filters.go
└── window/
    ├── window.go
    └── header.go
```

### Migration Steps for Each View

#### 1. Extract Reusable Components First

**`internal/ui/components/post_card.go`:**
- Extract from `home_view.go`, `timeline_view_display.go`
- Accepts `Post` data via constructor
- Self-contained rendering logic
- Events emitted via callbacks

**`internal/ui/components/markdown_preview.go`:**
- Extract from `home_view_composer.go`
- Uses `pkg/markdown.Renderer`
- Live preview functionality

**`internal/ui/components/loading_spinner.go`:**
- Extract from `app_ui.go` (`setLoading` method)

#### 2. Migrate Views One-by-One

**Priority Order:**
1. **Settings View** (simplest, fewest dependencies)
2. **Friends View** (moderate complexity)
3. **Timeline View** (requires components)
4. **Home View** (most complex, requires all components)

**Per-View Migration Pattern:**

```go
// OLD: home_view.go
package main

type HomeView struct {
    app *MauApp  // ❌ Couples to entire app
    // ...
}

func NewHomeView(app *MauApp) *HomeView {
    return &HomeView{app: app}
}

func (hv *HomeView) Refresh() {
    posts := hv.app.postMgr.List(...)  // ❌ Direct access
    hv.app.showToast("Loaded")         // ❌ Tight coupling
}
```

```go
// NEW: internal/ui/views/home/home.go
package home

import (
    "github.com/mau-network/mau-gui-poc/internal/domain/post"
    "github.com/mau-network/mau-gui-poc/internal/ui/components"
)

type View struct {
    postMgr  *post.Manager      // ✅ Only what's needed
    notifier notification.Notifier
    // ...
}

type Config struct {
    PostMgr  *post.Manager
    Notifier notification.Notifier
}

func New(cfg Config) *View {
    return &View{
        postMgr:  cfg.PostMgr,
        notifier: cfg.Notifier,
    }
}

func (v *View) Refresh() {
    posts, err := v.postMgr.List(...)  // ✅ Clean interface
    if err != nil {
        v.notifier.ShowToast("Error loading")
    }
}
```

#### 3. Update `internal/app/app.go`

Replace placeholder UI with real views:

```go
// internal/app/app.go
func (a *App) activate() {
    // ... theme, window setup ...

    // Create views with injected dependencies
    homeView := home.New(home.Config{
        PostMgr:    a.postMgr,
        AccountMgr: a.accountMgr,
        Notifier:   a.notifier,
    })

    friendsView := friends.New(friends.Config{
        AccountMgr: a.accountMgr,
        Notifier:   a.notifier,
    })

    settingsView := settings.New(settings.Config{
        ConfigMgr: a.configMgr,
        ServerMgr: a.serverMgr,
        Notifier:  a.notifier,
    })

    // Build main window with views
    mainWindow := window.New(window.Config{
        App:          a.gtkApp,
        HomeView:     homeView,
        FriendsView:  friendsView,
        SettingsView: settingsView,
    })

    mainWindow.Show()
}
```

---

## Constants Migration

**OLD:** `constants.go` - Mix of UI, domain, and configuration constants

**NEW:** Move constants to appropriate layers

```go
// internal/domain/post/constants.go
const (
    MaxPostBodyLength = 5000
)

// internal/ui/views/home/constants.go
const (
    CharCounterFormat = "%d / %d"
    ToastNoContent = "Cannot post empty content"
)

// pkg/markdown/constants.go
const (
    MaxTagLength = 50
    MaxTags      = 10
)
```

---

## Auto-Sync Migration

**OLD:** `app_sync.go` - Mixed into `MauApp`

**NEW:** Create `internal/domain/sync/manager.go`

```go
package sync

type Manager struct {
    configMgr *config.Manager
    // ... sync logic
}

func (m *Manager) Start() {
    cfg := m.configMgr.Get()
    if !cfg.AutoSync {
        return
    }
    // Start background sync timer
}
```

Then inject into App:

```go
// cmd/mau-gui/main.go
syncMgr := sync.NewManager(sync.Config{
    ConfigMgr: configMgr,
    // ...
})

app := app.New(app.Config{
    // ...
    SyncMgr: syncMgr,
})
```

---

## Testing Strategy During Migration

### 1. Keep Old Code Running
- Don't delete old files until new versions work
- Run side-by-side testing

### 2. Incremental Verification
```bash
# After migrating each view:
cd gui
go build -o /tmp/mau-gui-new ./cmd/mau-gui
/tmp/mau-gui-new  # Verify visually

# Run tests
go test ./internal/domain/...       # Unit tests
go test ./internal/adapters/...     # Integration tests
```

### 3. Smoke Tests
- [ ] App launches without crashes
- [ ] All views accessible via navigation
- [ ] Posts can be created
- [ ] Friends can be added
- [ ] Settings can be changed
- [ ] Server starts/stops correctly

---

## Cleanup Phase

Once all views migrated:

### 1. Remove Old Files
```bash
cd gui
rm app.go app_ui.go app_sync.go
rm home_view*.go friends_view.go settings_view.go timeline_view*.go
rm ui_helpers.go post_utils.go
rm constants.go  # After moving to appropriate packages
```

### 2. Update go.mod
```bash
go mod tidy
```

### 3. Final Build
```bash
go build -o mau-gui ./cmd/mau-gui
```

---

## Success Criteria

### Architecture
- [x] Domain layer has zero GTK imports
- [x] All dependencies injected via constructors
- [x] Interfaces used for all cross-layer communication
- [ ] Views contain no business logic (deferred to managers)

### Testing
- [x] Domain layer unit tests pass
- [ ] Adapter integration tests pass
- [ ] UI interaction tests (with mocks)
- [ ] End-to-end smoke tests

### Documentation
- [x] README.md explains architecture
- [x] Migration guide complete
- [ ] Code comments on complex parts
- [ ] Examples in docs/

### Performance
- [ ] App startup < 1 second
- [ ] View switching instant
- [ ] No memory leaks (valgrind test)

---

## How to Continue Migration

### For Each View File:

1. **Read the old file** - Understand what it does
2. **Identify dependencies** - What managers does it need?
3. **Create new package** - `internal/ui/views/<name>/`
4. **Write view struct** - Accept only needed dependencies
5. **Write Config struct** - For constructor parameters
6. **Port UI building logic** - Keep GTK code, delegate business logic
7. **Update app.go** - Inject dependencies, add to main window
8. **Test** - Build, run, verify functionality
9. **Delete old file** - Once new version confirmed working

### Example: Migrating Settings View

```bash
# 1. Create package
mkdir -p gui/internal/ui/views/settings

# 2. Create view file
cat > gui/internal/ui/views/settings/settings.go << 'EOF'
package settings

import (
    "github.com/diamondburned/gotk4/pkg/gtk/v4"
    "github.com/mau-network/mau-gui-poc/internal/domain/config"
    "github.com/mau-network/mau-gui-poc/internal/domain/server"
)

type View struct {
    configMgr *config.Manager
    serverMgr *server.Manager
    page      *gtk.Box
}

type Config struct {
    ConfigMgr *config.Manager
    ServerMgr *server.Manager
}

func New(cfg Config) *View {
    v := &View{
        configMgr: cfg.ConfigMgr,
        serverMgr: cfg.ServerMgr,
    }
    v.buildUI()
    return v
}

func (v *View) buildUI() {
    v.page = gtk.NewBox(gtk.OrientationVertical, 12)
    // Port UI building logic from old settings_view.go
}

func (v *View) Widget() *gtk.Box {
    return v.page
}
EOF

# 3. Update app.go to use new view

# 4. Build and test
cd gui
go build -o /tmp/mau-gui ./cmd/mau-gui
/tmp/mau-gui

# 5. If working, delete old file
rm settings_view.go
```

---

## Common Pitfalls

### ❌ Don't Do This:
```go
// Passing entire app object
func NewHomeView(app *MauApp) *HomeView

// Accessing nested fields
hv.app.configMgr.configPath
```

### ✅ Do This:
```go
// Pass only what's needed via interface
func New(cfg Config) *View

// Use methods, not fields
cfg := v.configMgr.Get()
```

---

## Questions & Decisions

### Q: Should we keep the old files during migration?
**A:** Yes, until each new view is tested and working.

### Q: How to handle shared state between views?
**A:** Domain managers are the source of truth. Views fetch fresh state when shown.

### Q: What if a view needs to update another view?
**A:** Use callbacks or event system. Views should not reference each other directly.

### Q: Can we incrementally merge this to master?
**A:** Yes, each phase is self-contained. Can merge after full testing.

---

## Timeline Estimate

Assuming ~2 hours per view + components:

- **Components extraction:** 2 hours
- **Settings view:** 1 hour
- **Friends view:** 2 hours
- **Timeline view:** 3 hours (with display/filters)
- **Home view:** 4 hours (most complex)
- **Cleanup & testing:** 2 hours

**Total:** ~14 hours of focused work

Can be done incrementally over several days.

---

## Resources

- **Architecture:** `gui/README.md`
- **Proposal:** `mau-gui-architecture-proposal.md`
- **Domain Interfaces:** `gui/internal/domain/*/interfaces.go`
- **Working Example:** `cmd/mau-gui/main.go` shows DI pattern

---

**Maintainer:** Emad Elsaid  
**Migration Started:** 2026-02-24  
**Last Updated:** 2026-02-24  
**Status:** Foundation Complete | UI Migration In Progress
