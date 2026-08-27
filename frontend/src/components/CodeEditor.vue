<script setup lang="ts">
import { basicSetup } from 'codemirror'
import { json } from '@codemirror/lang-json'
import { markdown } from '@codemirror/lang-markdown'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { SearchQuery, closeSearchPanel, findNext, findPrevious, getSearchQuery, replaceAll, replaceNext, search, selectMatches, setSearchQuery } from '@codemirror/search'
import { Compartment, EditorState, StateEffect, StateField, type Range } from '@codemirror/state'
import { Decoration, EditorView, type DecorationSet, type Panel, type ViewUpdate } from '@codemirror/view'
import { tags } from '@lezer/highlight'
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { EditorHighlight } from '@/types'
import { useAppStore } from '@/stores/app'
import { countSearchMatchesInChunks, type SearchMatchRange } from '@/utils/chunkedSearchCount'

const props = withDefaults(
  defineProps<{
    modelValue: string
    readonly?: boolean
    language?: 'json' | 'markdown' | 'plain'
    label: string
    selectionOffset?: number
    highlights?: EditorHighlight[]
  }>(),
  { readonly: false, language: 'plain', selectionOffset: undefined, highlights: () => [] },
)

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
const app = useAppStore()
const container = ref<HTMLDivElement | null>(null)
let editor: EditorView | undefined
let externalUpdate = false
const typographyCompartment = new Compartment()
const wrappingCompartment = new Compartment()

const setHighlights = StateEffect.define<EditorHighlight[]>()

function createHighlightDecorations(state: EditorState, highlights: EditorHighlight[]): DecorationSet {
  const ranges: Range<Decoration>[] = []
  const decoratedLines = new Set<string>()
  for (const highlight of highlights) {
    const from = Math.max(0, Math.min(highlight.from, state.doc.length))
    const to = Math.max(from, Math.min(highlight.to, state.doc.length))
    if (from === to) continue
    ranges.push(Decoration.mark({ class: `cm-diff-mark-${highlight.kind}` }).range(from, to))
    const firstLine = state.doc.lineAt(from).number
    const lastLine = state.doc.lineAt(Math.max(from, to - 1)).number
    for (let lineNumber = firstLine; lineNumber <= lastLine; lineNumber += 1) {
      const key = `${highlight.kind}:${lineNumber}`
      if (decoratedLines.has(key)) continue
      decoratedLines.add(key)
      ranges.push(Decoration.line({ class: `cm-diff-line-${highlight.kind}` }).range(state.doc.line(lineNumber).from))
    }
  }
  return Decoration.set(ranges, true)
}

const highlightField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update: (decorations, transaction) => {
    let next = decorations.map(transaction.changes)
    for (const effect of transaction.effects) {
      if (effect.is(setHighlights)) next = createHighlightDecorations(transaction.state, effect.value)
    }
    return next
  },
  provide: (field) => EditorView.decorations.from(field),
})

function applyHighlights(highlights = props.highlights): void {
  editor?.dispatch({ effects: setHighlights.of(highlights) })
}

const highlightStyle = HighlightStyle.define([
  { tag: tags.propertyName, color: 'var(--syntax-key)' },
  { tag: tags.string, color: 'var(--syntax-string)' },
  { tag: tags.number, color: 'var(--syntax-number)' },
  { tag: tags.bool, color: 'var(--syntax-boolean)' },
  { tag: tags.null, color: 'var(--syntax-null)' },
  { tag: [tags.punctuation, tags.brace, tags.squareBracket], color: 'var(--syntax-punctuation)' },
])

const editorTheme = EditorView.theme({
  '&': {
    height: '100%',
    color: 'var(--text-primary)',
    backgroundColor: 'transparent',
  },
  '.cm-scroller': {
    fontFamily: '"JetBrains Mono", "Cascadia Code", Consolas, monospace',
    lineHeight: '1.65',
    overflow: 'auto',
  },
  '.cm-content': { padding: '12px 0', caretColor: 'var(--accent)' },
  '.cm-gutters': {
    backgroundColor: 'var(--editor-gutter)',
    color: 'var(--text-faint)',
    borderRight: '1px solid var(--border-subtle)',
  },
  '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'var(--editor-active-line)' },
  '.cm-selectionLayer': { zIndex: '4 !important', pointerEvents: 'none' },
  '.cm-cursorLayer': { zIndex: '5 !important' },
  '.cm-selectionBackground': { backgroundColor: 'var(--selection-overlay) !important' },
  '::selection': { backgroundColor: 'var(--selection) !important' },
  '.cm-selectionMatch': { backgroundColor: 'transparent !important', boxShadow: 'none !important' },
  '&.cm-focused': { outline: 'none' },
  '.cm-cursor': { borderLeftColor: 'var(--accent)' },
})

const chineseSearchPhrases = EditorState.phrases.of({
  Find: '查找',
  Replace: '替换为',
  next: '下一个',
  previous: '上一个',
  all: '全选匹配项',
  'match case': '区分大小写',
  regexp: '正则表达式',
  'by word': '全字匹配',
  replace: '替换',
  'replace all': '全部替换',
  close: '关闭查找',
})

function typographyTheme(fontSize: number) {
  return EditorView.theme({ '&': { fontSize: `${fontSize}px` } })
}

class CountedSearchPanel implements Panel {
  readonly dom: HTMLElement
  readonly top = true

  private query: SearchQuery
  private readonly searchField: HTMLInputElement
  private readonly replaceField: HTMLInputElement
  private readonly caseField: HTMLInputElement
  private readonly regexField: HTMLInputElement
  private readonly wordField: HTMLInputElement
  private readonly status: HTMLSpanElement
  private readonly actionButtons: HTMLButtonElement[]
  private cancelCount: (() => void) | undefined
  private generation = 0
  private total: number | undefined
  private selectedIndex: number | undefined
  private counting = false

  constructor(private readonly view: EditorView) {
    this.query = getSearchQuery(view.state)
    this.searchField = this.createField('search', '查找', this.query.search)
    this.searchField.setAttribute('main-field', 'true')
    this.replaceField = this.createField('replace', '替换为', this.query.replace)
    this.caseField = this.createCheckbox('case', '区分大小写', this.query.caseSensitive)
    this.regexField = this.createCheckbox('re', '正则表达式', this.query.regexp)
    this.wordField = this.createCheckbox('word', '全字匹配', this.query.wholeWord)
    this.status = document.createElement('span')
    this.status.className = 'cm-search-status'
    this.status.setAttribute('role', 'status')
    this.status.setAttribute('aria-live', 'polite')

    const next = this.createButton('next', '下一个', () => findNext(this.view))
    const previous = this.createButton('prev', '上一个', () => findPrevious(this.view))
    const select = this.createButton('select', '全选匹配项', () => selectMatches(this.view))
    const replace = this.createButton('replace', '替换', () => replaceNext(this.view))
    const replaceAllButton = this.createButton('replaceAll', '全部替换', () => replaceAll(this.view))
    this.actionButtons = [next, previous, select, replace, replaceAllButton]

    const close = this.createButton('close', '关闭查找', () => closeSearchPanel(this.view))
    close.textContent = '×'
    close.setAttribute('aria-label', '关闭查找')

    this.dom = document.createElement('div')
    this.dom.className = 'cm-search'
    this.dom.append(
      this.searchField,
      this.status,
      next,
      previous,
      select,
      this.createLabel(this.caseField, '区分大小写'),
      this.createLabel(this.regexField, '正则表达式'),
      this.createLabel(this.wordField, '全字匹配'),
    )
    if (!view.state.readOnly) this.dom.append(this.replaceField, replace, replaceAllButton)
    this.dom.append(close)
    this.dom.addEventListener('keydown', (event) => this.handleKeydown(event))
    this.restartCount()
  }

  mount(): void {
    this.searchField.select()
  }

  update(update: ViewUpdate): void {
    let updatedQuery: SearchQuery | undefined
    for (const transaction of update.transactions) {
      for (const effect of transaction.effects) {
        if (effect.is(setSearchQuery)) updatedQuery = effect.value
      }
    }

    if (updatedQuery) {
      this.setFields(updatedQuery)
      this.restartCount()
    } else if (update.docChanged) {
      this.restartCount()
    } else if (update.selectionSet) {
      this.locateSelection()
    }
  }

  destroy(): void {
    this.generation += 1
    this.cancelCount?.()
  }

  private createField(name: string, label: string, value: string): HTMLInputElement {
    const input = document.createElement('input')
    input.className = 'cm-textfield'
    input.name = name
    input.value = value
    input.placeholder = label
    input.setAttribute('aria-label', label)
    input.addEventListener('input', () => this.commit())
    return input
  }

  private createCheckbox(name: string, label: string, checked: boolean): HTMLInputElement {
    const input = document.createElement('input')
    input.type = 'checkbox'
    input.name = name
    input.checked = checked
    input.setAttribute('aria-label', label)
    input.addEventListener('change', () => this.commit())
    return input
  }

  private createButton(name: string, label: string, action: () => unknown): HTMLButtonElement {
    const button = document.createElement('button')
    button.className = 'cm-button'
    button.name = name
    button.type = 'button'
    button.textContent = label
    button.addEventListener('click', () => action())
    return button
  }

  private createLabel(field: HTMLInputElement, label: string): HTMLLabelElement {
    const container = document.createElement('label')
    container.append(field, document.createTextNode(label))
    return container
  }

  private commit(): void {
    const query = new SearchQuery({
      search: this.searchField.value,
      caseSensitive: this.caseField.checked,
      regexp: this.regexField.checked,
      wholeWord: this.wordField.checked,
      replace: this.replaceField.value,
    })
    if (!query.eq(this.query)) this.view.dispatch({ effects: setSearchQuery.of(query) })
  }

  private setFields(query: SearchQuery): void {
    this.query = query
    this.searchField.value = query.search
    this.replaceField.value = query.replace
    this.caseField.checked = query.caseSensitive
    this.regexField.checked = query.regexp
    this.wordField.checked = query.wholeWord
  }

  private restartCount(): void {
    this.generation += 1
    this.cancelCount?.()
    this.cancelCount = undefined
    this.query = getSearchQuery(this.view.state)
    this.total = undefined
    this.selectedIndex = undefined
    this.counting = Boolean(this.query.search && this.query.valid)
    this.renderStatus()
    if (!this.counting) return

    const generation = this.generation
    this.cancelCount = countSearchMatchesInChunks({
      cursor: this.query.getCursor(this.view.state),
      onComplete: ({ total }) => {
        if (generation !== this.generation) return
        this.cancelCount = undefined
        this.counting = false
        this.total = total
        this.renderStatus()
        this.locateSelection()
      },
    })
  }

  private locateSelection(): void {
    if (this.counting || this.total === undefined || this.total === 0 || !this.query.valid || !this.query.search) return
    this.generation += 1
    this.cancelCount?.()
    this.cancelCount = undefined
    this.selectedIndex = undefined
    const generation = this.generation
    const selected: SearchMatchRange = this.view.state.selection.main
    this.cancelCount = countSearchMatchesInChunks({
      cursor: this.query.getCursor(this.view.state),
      selected,
      onComplete: ({ selectedIndex }) => {
        if (generation !== this.generation) return
        this.cancelCount = undefined
        this.selectedIndex = selectedIndex
        this.renderStatus()
      },
    })
    this.renderStatus()
  }

  private renderStatus(): void {
    let text = '输入关键词'
    let state = 'empty'
    if (this.query.search && !this.query.valid) {
      text = '正则表达式无效'
      state = 'error'
    } else if (this.counting) {
      text = '正在统计…'
      state = 'counting'
    } else if (this.query.search && this.total === 0) {
      text = '无匹配项'
      state = 'empty'
    } else if (this.query.search && this.total) {
      text = this.selectedIndex ? `第 ${this.selectedIndex} 个，共 ${this.total} 个` : `未定位，共 ${this.total} 个`
      state = this.selectedIndex ? 'selected' : 'ready'
    }
    this.status.textContent = text
    this.status.dataset.state = state
    const disabled = !this.query.search || !this.query.valid || this.total === 0
    for (const button of this.actionButtons) button.disabled = disabled
  }

  private handleKeydown(event: KeyboardEvent): void {
    const isSearchField = event.target === this.searchField
    const isReplaceField = event.target === this.replaceField
    if (event.key === 'Escape') {
      event.preventDefault()
      closeSearchPanel(this.view)
    } else if (event.key === 'Enter' && isSearchField) {
      event.preventDefault()
      ;(event.shiftKey ? findPrevious : findNext)(this.view)
    } else if (event.key === 'Enter' && isReplaceField) {
      event.preventDefault()
      replaceNext(this.view)
    } else if (event.key === 'F3' || ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'g')) {
      event.preventDefault()
      ;(event.shiftKey ? findPrevious : findNext)(this.view)
    }
  }
}

const editorSearch = search({
  top: true,
  createPanel: (view) => new CountedSearchPanel(view),
  scrollToMatch: (range) => EditorView.scrollIntoView(range, { y: 'center' }),
})

onMounted(() => {
  if (!container.value) return
  editor = new EditorView({
    parent: container.value,
    state: EditorState.create({
      doc: props.modelValue,
      extensions: [
        basicSetup,
        editorTheme,
        chineseSearchPhrases,
        editorSearch,
        highlightField,
        syntaxHighlighting(highlightStyle),
        typographyCompartment.of(typographyTheme(app.settings.editorFontSize)),
        wrappingCompartment.of(app.settings.editorLineWrapping ? EditorView.lineWrapping : []),
        EditorState.readOnly.of(props.readonly),
        EditorView.editable.of(!props.readonly),
        EditorView.contentAttributes.of({ 'aria-label': props.label }),
        ...(props.language === 'json' ? [json()] : props.language === 'markdown' ? [markdown()] : []),
        EditorView.updateListener.of((update) => {
          if (update.docChanged && !externalUpdate) emit('update:modelValue', update.state.doc.toString())
        }),
      ],
    }),
  })
  applyHighlights()
})

watch(
  () => props.modelValue,
  (value) => {
    if (!editor || value === editor.state.doc.toString()) return
    externalUpdate = true
    editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: value } })
    externalUpdate = false
  },
)

watch(
  () => props.selectionOffset,
  (offset) => {
    if (!editor || offset === undefined) return
    const safeOffset = Math.max(0, Math.min(offset, editor.state.doc.length))
    editor.dispatch({ selection: { anchor: safeOffset }, effects: EditorView.scrollIntoView(safeOffset, { y: 'center' }) })
  },
)

watch(() => props.highlights, (highlights) => applyHighlights(highlights), { deep: true })

watch(
  () => [app.settings.editorFontSize, app.settings.editorLineWrapping] as const,
  ([fontSize, lineWrapping]) => {
    editor?.dispatch({
      effects: [
        typographyCompartment.reconfigure(typographyTheme(fontSize)),
        wrappingCompartment.reconfigure(lineWrapping ? EditorView.lineWrapping : []),
      ],
    })
  },
)

onBeforeUnmount(() => editor?.destroy())
</script>

<template>
  <div ref="container" class="code-editor" />
</template>
