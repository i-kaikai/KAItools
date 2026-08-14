import { defineStore } from 'pinia'

export interface ToastMessage {
  id: number
  type: 'success' | 'error' | 'info'
  message: string
}

export const useToastStore = defineStore('toast', {
  state: () => ({ messages: [] as ToastMessage[], nextId: 1 }),
  actions: {
    show(message: string, type: ToastMessage['type'] = 'info') {
      const id = this.nextId++
      this.messages.push({ id, type, message })
      window.setTimeout(() => this.dismiss(id), type === 'error' ? 4200 : 2400)
    },
    dismiss(id: number) {
      this.messages = this.messages.filter((message) => message.id !== id)
    },
  },
})

