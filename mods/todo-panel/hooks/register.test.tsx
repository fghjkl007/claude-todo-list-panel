import type { UiPane } from 'claude-code'
import { expect, test } from 'claude-code/testing'

import { findUncheckedLines, groupTodo, parseTodo } from './register'

const PANE = {
  plugin: 'todo-panel',
  component: 'Pane',
  requestId: 'todo-panel',
  props: {
    title: 'Todo',
    isFocused: false,
    bodyColumns: 40,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const

const SURFACES = ['terminal', 'desktop', 'vscode', 'mobile'] as const

test('parseTodo keeps groups, items and unknown lines', async () => {
  const lines = parseTodo('## Now\n- [ ] A\n- [x] B\n\na stray line\n## Backlog\n- [ ] C')

  expect(lines).toEqual([
    { kind: 'heading', text: 'Now' },
    { kind: 'item', text: 'A', isDone: false, section: 'Now' },
    { kind: 'item', text: 'B', isDone: true, section: 'Now' },
    { kind: 'text', text: 'a stray line', section: 'Now' },
    { kind: 'heading', text: 'Backlog' },
    { kind: 'item', text: 'C', isDone: false, section: 'Backlog' },
  ])
})

test('a plain bullet is an open item, and is flagged for writes', async () => {
  expect(parseTodo('- A')).toEqual([{ kind: 'item', text: 'A', isDone: false, section: '' }])
  expect(findUncheckedLines('## Now\n- A\n- [ ] B\n- [x] C\n[x]')).toEqual(['- A'])
})

test('groupTodo counts open items and keeps empty groups', async () => {
  const groups = groupTodo(parseTodo('a first line\n## Now\n- [ ] A\n- [x] B\n## Maybe'))

  expect(groups.map(({ title, openCount, lines }) => [title, openCount, lines.length])).toEqual([
    ['', 0, 1],
    ['Now', 1, 2],
    ['Maybe', 0, 0],
  ])
})

test('/todo closes a drawn pane and opens one that is closed or waiting undrawn', async ($, on) => {
  const pane = { id: 'todo-panel', title: 'Todo', isShown: true, isFocused: false }
  let panes: UiPane[] = [{ ...pane, isPlaced: true }]
  let calls: string[] = []
  on('process.run', () => ({
    value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  }))
  on('session.cwd', () => ({ value: '/project' }))
  on('fs.exists', () => ({ value: true }))
  on('fs.read', () => ({ value: '## Now\n' }))
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
  expect(closed.text).toBe('Todo pane closed')

  for (const waiting of [[], [{ ...pane, isPlaced: false }]]) {
    panes = waiting
    calls = []
    const opened = await runTodo()
    expect(calls).toEqual(['open'])
    expect(opened.text).toBe('Todo pane opened')
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
    value: { value: { shape: 'text-1', value: '## Now\n- [ ] check the `a` endpoint\n' }, version: 1 },
  }))

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const boxes = await ui.findAll({ type: 'Box' })
    const rows = boxes.filter(box => box.props.flexDirection === 'row' && !box.props.justifyContent)

    // Some surfaces hand gap on as columnGap.
    expect(rows.map(row => Boolean(row.props.gap ?? row.props.columnGap))).toEqual([true])
    expect((await ui.find({ type: 'Text', text: /endpoint/ }))?.text).toBe('check the a endpoint')
    await ui.unmount()
  }
})

test('the pane draws groups, counts and items, on every surface', async ($, on) => {
  const text = '## Now\n- [ ] do A\n- [x] done B\n## Next\n- [ ] do C\n- [ ] do D\n## Maybe\n'
  on('state.get', () => ({
    value: { value: { shape: 'text-1', value: text }, version: 1 },
  }))

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })

    expect((await ui.find({ type: 'Text', text: /^Now$/ }))?.text).toBe('Now')
    expect((await ui.find({ type: 'Text', text: /do A/ }))?.text).toBe('do A')
    expect((await ui.find({ type: 'Text', text: /done B/ }))?.text).toBe('done B')
    expect((await ui.find({ type: 'Text', text: /^2$/ }))?.text).toBe('2')
    expect((await ui.find({ type: 'Text', text: /Nothing yet/ }))?.text).toBe('Nothing yet')
    await ui.unmount()
  }
})

test('the current group is accented and parked ones dimmed, under English or older Chinese headings', async ($, on) => {
  let text = ''
  on('state.get', () => ({
    value: { value: { shape: 'text-1', value: text }, version: 1 },
  }))

  for (const [current, parked] of [['Now', 'Maybe'], ['现在', '待定']]) {
    text = `## ${current}\n- [ ] A\n## ${parked}\n- [ ] B\n`
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

    expect((await ui.find({ type: 'Text', text: new RegExp(`^${current}$`) }))?.props.color).toBe('suggestion')
    expect((await ui.find({ type: 'Text', text: new RegExp(`^${parked}$`) }))?.props.dimColor).toBe(true)
    await ui.unmount()
  }
})
