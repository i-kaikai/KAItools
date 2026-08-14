<script setup lang="ts">
import { basicSetup } from 'codemirror'
import { json } from '@codemirror/lang-json'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { tags } from '@lezer/highlight'
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = withDefaults(
  defineProps<{
    modelValue: string
    readonly?: boolean
    language?: 'json' | 'plain'
    label: string
    selectionOffset?: number
  }>(),
  { readonly: false, language: 'plain', selectionOffset: undefined },
)

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
const container = ref<HTMLDivElement | null>(null)
let editor: EditorView | undefined
let externalUpdate = false

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
    fontSize: '13px',
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
  '.cm-selectionBackground, ::selection': { backgroundColor: 'var(--selection) !important' },
  '&.cm-focused': { outline: 'none' },
  '.cm-cursor': { borderLeftColor: 'var(--accent)' },
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
        syntaxHighlighting(highlightStyle),
        EditorView.lineWrapping,
        EditorState.readOnly.of(props.readonly),
        EditorView.editable.of(!props.readonly),
        EditorView.contentAttributes.of({ 'aria-label': props.label }),
        ...(props.language === 'json' ? [json()] : []),
        EditorView.updateListener.of((update) => {
          if (update.docChanged && !externalUpdate) emit('update:modelValue', update.state.doc.toString())
        }),
      ],
    }),
  })
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

onBeforeUnmount(() => editor?.destroy())
</script>

<template>
  <div ref="container" class="code-editor" />
</template>

