import type { UiPane } from 'claude-code'
import { expect, test } from 'claude-code/testing'

import { findUncheckedLines, groupTodo, parseTodo } from './register'

const PANE = {
  plugin: 'todo-panel',
  component: 'Pane',
  requestId: 'todo-panel',
  props: {
    title: '待办',
    isFocused: false,
    bodyColumns: 40,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const

const SURFACES = ['terminal', 'desktop', 'vscode', 'mobile'] as const

test('parseTodo keeps groups, items and unknown lines', async () => {
  const lines = parseTodo('## 现在\n- [ ] A\n- [x] B\n\n随手一行\n## Backlog\n- [ ] C')

  expect(lines).toEqual([
    { kind: 'heading', text: '现在' },
    { kind: 'item', text: 'A', isDone: false, section: '现在' },
    { kind: 'item', text: 'B', isDone: true, section: '现在' },
    { kind: 'text', text: '随手一行', section: '现在' },
    { kind: 'heading', text: 'Backlog' },
    { kind: 'item', text: 'C', isDone: false, section: 'Backlog' },
  ])
})

test('a plain bullet is an open item, and is flagged for writes', async () => {
  expect(parseTodo('- A')).toEqual([{ kind: 'item', text: 'A', isDone: false, section: '' }])
  expect(findUncheckedLines('## 现在\n- A\n- [ ] B\n- [x] C\n[x]')).toEqual(['- A'])
})

test('groupTodo counts open items and keeps empty groups', async () => {
  const groups = groupTodo(parseTodo('开头一行\n## 现在\n- [ ] A\n- [x] B\n## 待定'))

  expect(groups.map(({ title, openCount, lines }) => [title, openCount, lines.length])).toEqual([
    ['', 0, 1],
    ['现在', 1, 2],
    ['待定', 0, 0],
  ])
})

test('/todo closes a drawn pane and opens one that is closed or waiting undrawn', async ($, on) => {
  const pane = { id: 'todo-panel', title: '待办', isShown: true, isFocused: false }
  let panes: UiPane[] = [{ ...pane, isPlaced: true }]
  let calls: string[] = []
  on('process.run', () => ({
    value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  }))
  on('session.cwd', () => ({ value: '/project' }))
  on('fs.exists', () => ({ value: true }))
  on('fs.read', () => ({ value: '## 现在\n' }))
  on('state.get', () => ({ value: { value: { shape: 'text-1', value: null }, version: 1 } }))
  on('state.set', () => ({ value: { isSet: true, version: 2 } }))
  on('ui.panes', () => ({ value: panes }))
  on('ui.open', () => {
    calls = [...calls, 'open']
    return { value: { isPlaced: true } }
  })
  on('ui.close', () => {
    calls = [...calls, 'close']
    return { value: undefined }
  })

  const runTodo = () => $.command.run({ command: 'todo' } as never)

  const closed = await runTodo()
  expect(calls).toEqual(['close'])
  expect(closed.text).toBe('待办面板已关闭')

  for (const waiting of [[], [{ ...pane, isPlaced: false }]]) {
    panes = waiting
    calls = []
    const opened = await runTodo()
    expect(calls).toEqual(['open'])
    expect(opened.text).toBe('待办面板已打开')
  }
})

test('the pane says how to start when there is no list, on every surface', async $ => {
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })

    expect((await ui.find({ type: 'Text', text: /todo/ }))?.text).toContain('/todo')
    await ui.unmount()
  }
})

test('the mark never touches the text, and backticks are not shown, on every surface', async ($, on) => {
  on('state.get', () => ({
    value: { value: { shape: 'text-1', value: '## 现在\n- [ ] 查 `a` 接口\n' }, version: 1 },
  }))

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const boxes = await ui.findAll({ type: 'Box' })
    const rows = boxes.filter(box => box.props.flexDirection === 'row' && !box.props.justifyContent)

    // Some surfaces hand gap on as columnGap.
    expect(rows.map(row => Boolean(row.props.gap ?? row.props.columnGap))).toEqual([true])
    expect((await ui.find({ type: 'Text', text: /接口/ }))?.text).toBe('查 a 接口')
    await ui.unmount()
  }
})

test('the pane draws groups, counts and items, on every surface', async ($, on) => {
  const text = '## 现在\n- [ ] 做 A\n- [x] 做完 B\n## 接下来\n- [ ] 做 C\n- [ ] 做 D\n## 待定\n'
  on('state.get', () => ({
    value: { value: { shape: 'text-1', value: text }, version: 1 },
  }))

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })

    expect((await ui.find({ type: 'Text', text: /现在/ }))?.text).toBe('现在')
    expect((await ui.find({ type: 'Text', text: /做 A/ }))?.text).toBe('做 A')
    expect((await ui.find({ type: 'Text', text: /做完 B/ }))?.text).toBe('做完 B')
    expect((await ui.find({ type: 'Text', text: /^2$/ }))?.text).toBe('2')
    expect((await ui.find({ type: 'Text', text: /暂无/ }))?.text).toBe('暂无')
    await ui.unmount()
  }
})
