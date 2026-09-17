import { defineStore } from 'pinia'

export type ConfirmTone = 'danger' | 'warning' | 'neutral'

export interface ConfirmOptions {
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  tone?: ConfirmTone
}

export interface ConfirmRequest extends Required<Pick<ConfirmOptions, 'title' | 'message' | 'confirmLabel' | 'cancelLabel' | 'tone'>> {
  id: number
  resolve: (confirmed: boolean) => void
}

export const useConfirmStore = defineStore('confirm', {
  state: () => ({
    queue: [] as ConfirmRequest[],
    nextId: 1,
  }),
  getters: {
    current: (state): ConfirmRequest | undefined => state.queue[0],
  },
  actions: {
    ask(options: ConfirmOptions): Promise<boolean> {
      return new Promise((resolve) => {
        this.queue.push({
          id: this.nextId++,
          title: options.title,
          message: options.message,
          confirmLabel: options.confirmLabel ?? '继续',
          cancelLabel: options.cancelLabel ?? '取消',
          tone: options.tone ?? 'warning',
          resolve,
        })
      })
    },
    settle(confirmed: boolean): void {
      const request = this.queue.shift()
      request?.resolve(confirmed)
    },
  },
})
