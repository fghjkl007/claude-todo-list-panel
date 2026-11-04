export type TodoText = string | null
// The texts of the terminal cards pressed open: each stays open through redraws and reloads.
export type ExpandedCards = readonly string[]

declare module 'claude-code' {
  interface PluginState {
    'todo-panel': { text: Shaped<TodoText>; expanded: Shaped<ExpandedCards> }
  }
}
