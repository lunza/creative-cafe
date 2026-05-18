# Fix Stack Overflow and Stream Timeout - Checklist

- [x] Local `clearTimeout` function does not shadow the global `clearTimeout` (root cause of stack overflow)
- [x] `onComplete` callback can successfully clear the stream timeout without recursion
- [x] Stream timeout duration is configurable or extended beyond hardcoded 120s
- [x] `ChatEngine.setupEventListeners` properly cleans up old listeners before adding new ones
- [x] `saveChatToStore` includes re-entrancy guard to prevent concurrent saves
- [x] IPC `ai:stream` events do not trigger recursive IPC calls
- [x] Normal AI response flow completes without stack overflow
- [x] Stream timeout does not fire for valid responses completing before 120s
- [x] All existing dialogue features (send, continue, retry, clear, cancel) work correctly
