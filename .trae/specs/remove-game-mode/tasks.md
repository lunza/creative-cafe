# Tasks

- [x] Task 1: Remove Game Mode from CreationCenter
  - [x] SubTask 1.1: Remove `game` from `ChatPanelType` union type
  - [x] SubTask 1.2: Remove `game` from `panelConfig` record
  - [x] SubTask 1.3: Remove `game` from `colorMap` record
  - [x] SubTask 1.4: Remove `showGameDialog` state and its setter
  - [x] SubTask 1.5: Remove `game` from `ripples` initial state record
  - [x] SubTask 1.6: Remove `panel === 'game'` branch in `handlePanelClick`
  - [x] SubTask 1.7: Remove `handleCloseGame` callback
  - [x] SubTask 1.8: Remove `GameModeEntry` lazy import
  - [x] SubTask 1.9: Remove Game Mode FullscreenDialog from JSX

- [x] Task 2: Remove Game Mode from CreativeSubNav
  - [x] SubTask 2.1: Remove `'game'` from `CreativeTabType` union type
  - [x] SubTask 2.2: Remove "游戏模式" tab item from tabItems array

- [x] Task 3: Delete Game Component Directories
  - [x] SubTask 3.1: Delete `src/renderer/components/Game/` directory (all game components)

- [x] Task 4: Delete Game Store Files
  - [x] SubTask 4.1: Delete `src/renderer/stores/gameStore.ts`
  - [x] SubTask 4.2: Delete `src/renderer/stores/gameUIStore.ts`
  - [x] SubTask 4.3: Delete `src/renderer/stores/__tests__/gameStore.test.ts`
  - [x] SubTask 4.4: Delete `src/renderer/stores/__tests__/gameUIStore.test.ts`

- [x] Task 5: Delete Game Service Directories
  - [x] SubTask 5.1: Delete `src/main/services/game/` directory (all game services)

- [x] Task 6: Delete Game IPC Handler Files
  - [x] SubTask 6.1: Delete `src/main/ipc/handlers/game/` directory
  - [x] SubTask 6.2: Delete `src/main/ipc/handlers/gameHandlers.ts`

- [x] Task 7: Remove Game Handler Registration
  - [x] SubTask 7.1: Remove `registerGameHandlers` import from `src/main/ipc/index.ts`
  - [x] SubTask 7.2: Remove `registerGameHandlers()` call from `setupIpcHandlers()`

- [x] Task 8: Remove Game Namespace from Preload
  - [x] SubTask 8.1: Remove `game` namespace from `src/main/preload.ts`

- [x] Task 9: Remove Game Types from Shared
  - [x] SubTask 9.1: Delete `src/shared/types/game.types.ts`
  - [x] SubTask 9.2: Delete `src/shared/constants/game.constants.ts`
  - [x] SubTask 9.3: Remove `export * from './game.types'` from `src/shared/types/index.ts`
  - [x] SubTask 9.4: Remove game types re-exports from `src/shared/types/index.ts`

- [x] Task 10: Remove Game Types from Renderer Declaration
  - [x] SubTask 10.1: Remove `game` namespace from `src/renderer/types/electron.d.ts`

# Task Dependencies
- Task 1 and Task 2 are independent and can run in parallel
- Task 3 through Task 10 can run in parallel after Task 1 and Task 2
- All tasks should complete before verification
