# Remove Game Mode from Creative Center Spec

## Why
Creative Center currently has three modes: Chat, Writing, and Game. The Game Mode has been built but is not actively used or maintained. The user wants to simplify the creative center to only retain Writing Mode and Chat Mode, removing the Game Mode entirely.

## What Changes
- **Remove** Game Mode panel from `CreationCenter.tsx` - remove the "游戏模式" card, its click handler, and the lazy-loaded `GameModeEntry` component.
- **Remove** all Game Mode related code, components, services, stores, and IPC handlers.
- **Remove** the Game Mode from `CreativeSubNav.tsx` - remove the "游戏模式" tab.
- **Remove** shared game types (`game.types.ts`, `game.constants.ts`) and barrel export.
- **Remove** preload API for game (`game` namespace) and renderer type declaration.

## Impact
- **Affected code**:
  - Renderer: `CreationCenter.tsx`, `CreativeSubNav.tsx`, `electron.d.ts`
  - All `src/renderer/components/Game/` directory (all game components)
  - All `src/renderer/stores/gameStore.ts` and `src/renderer/stores/gameUIStore.ts`
  - All `src/main/services/game/` directory (game services)
  - All `src/main/ipc/handlers/game/` and `gameHandlers.ts`
  - All `src/main/ipc/index.ts` (game handler registration)
  - `src/main/preload.ts` (game namespace)
  - `src/shared/types/game.types.ts` and `src/shared/constants/game.constants.ts`
  - `src/shared/types/index.ts` (game export)
- **Not affected**: Chat Mode and Writing Mode functionality remain unchanged.
- **Dependencies**: No other modules depend on Game Mode code.

## REMOVED Requirements

### Requirement: Game Mode Panel in Creation Center
**Reason**: User wants to simplify creative center to only Chat and Writing modes.
**Migration**: No migration needed - Game Mode is not used in production.

### Requirement: Game Mode Code and Services
**Reason**: All game-related code, components, services, stores, IPC handlers, and types become orphaned when the panel is removed.
**Migration**: Delete all game-related directories and files.

## ADDED Requirements
None.

## MODIFIED Requirements

### Requirement: Creative Center Panel Count
The creative center SHALL display only two modes: Chat Mode and Writing Mode. The Game Mode panel shall be removed.
