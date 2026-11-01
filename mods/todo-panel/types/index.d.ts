export type TodoText = string | null

declare module 'claude-code' {
  interface PluginState {
    'todo-panel': { text: Shaped<TodoText> }
  }
}
