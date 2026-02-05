export class TextChunker {
  private chunkSize: number;
  private chunkOverlap: number;
  private separators: string[] = ['\n\n', '\n', '. ', ' ', ''];

  constructor(chunkSize: number = 1000, chunkOverlap: number = 200) {
    this.chunkSize = chunkSize;
    this.chunkOverlap = chunkOverlap;
  }

  splitText(text: string): string[] {
    if (text.length <= this.chunkSize) {
      return [text];
    }

    const chunks: string[] = [];
    let start = 0;

    while (start < text.length) {
      let end = Math.min(start + this.chunkSize, text.length);

      if (end < text.length) {
        end = this.findBestSplitPoint(text, start, end);
      }

      chunks.push(text.substring(start, end));
      start = end - this.chunkOverlap;

      if (start < 0) start = 0;
      if (start >= text.length - this.chunkOverlap) {
        if (start < text.length) {
          chunks.push(text.substring(start));
        }
        break;
      }
    }

    return chunks;
  }

  private findBestSplitPoint(text: string, start: number, end: number): number {
    for (const sep of this.separators) {
      const lastSep = text.lastIndexOf(sep, end);
      if (lastSep > start) {
        return Math.min(lastSep + sep.length, end);
      }
    }
    return end;
  }
}
