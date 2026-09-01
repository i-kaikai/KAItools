declare module 'pdfjs-dist/build/pdf.mjs' {
  interface PdfPage {
    getTextContent(): Promise<{ items: unknown[] }>
    cleanup(): void
  }

  interface PdfDocument {
    numPages: number
    getPage(pageNumber: number): Promise<PdfPage>
    destroy(): Promise<void>
  }

  export const GlobalWorkerOptions: { workerPort: Worker | null; workerSrc: string }
  export function getDocument(options: { data: Uint8Array }): { promise: Promise<PdfDocument> }
}
