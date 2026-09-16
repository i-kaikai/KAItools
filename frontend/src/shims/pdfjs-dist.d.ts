declare module 'pdfjs-dist/build/pdf.mjs' {
  interface PdfViewport {
    width: number
    height: number
  }

  interface PdfRenderTask {
    promise: Promise<void>
  }

  interface PdfPage {
    getTextContent(): Promise<{ items: unknown[] }>
    getViewport(options: { scale: number }): PdfViewport
    render(options: { canvas: HTMLCanvasElement; canvasContext: CanvasRenderingContext2D; viewport: PdfViewport }): PdfRenderTask
    cleanup(): void
  }

  interface PdfDocument {
    numPages: number
    getPage(pageNumber: number): Promise<PdfPage>
    destroy(): Promise<void>
  }

  export const GlobalWorkerOptions: { workerPort: Worker | null; workerSrc: string }
  export function getDocument(options: { data: Uint8Array }): { promise: Promise<PdfDocument>; destroy(): Promise<void> }
}
