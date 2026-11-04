export type TodoText = string | null
// The keys of the terminal cards and done lines pressed open: each stays open through redraws and reloads.
export type ExpandedCards = readonly string[]
// The key of the Button the pane's focus ring is on, or null.
export type FocusedKey = string | null
// The header keys of the terminal groups folded to their header: each stays folded through redraws and reloads.
export type CollapsedGroups = readonly string[]

declare module 'claude-code' {
  interface PluginState {
    'todo-panel': {
      text: Shaped<TodoText>
      expanded: Shaped<ExpandedCards>
      focused: Shaped<FocusedKey>
      collapsed: Shaped<CollapsedGroups>
    }
  }
}
