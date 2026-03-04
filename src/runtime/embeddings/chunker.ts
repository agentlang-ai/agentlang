/**
 * Streaming text chunker - yields chunks one at a time without storing all in memory.
 */
export class TextChunker {
  private chunkSize: number;
  private chunkOverlap: number;
  private separators: string[] = ['\n\n', '\n', '. ', ' ', ''];

  constructor(chunkSize: number = 1000, chunkOverlap: number = 200) {
    // Ensure valid values - overlap must be less than chunk size to avoid infinite loop
    this.chunkSize = Math.max(100, chunkSize || 1000);
    // Cap overlap to at most 20% of chunk size to ensure progress
    this.chunkOverlap = Math.max(
      0,
      Math.min(chunkOverlap || 200, Math.floor(this.chunkSize * 0.2))
    );
  }

  /**
   * Calculate total chunks without creating them all in memory.
   * Used for logging/progress tracking.
   */
  estimateChunks(text: string): number {
    if (text.length <= this.chunkSize) {
      return 1;
    }
    // Rough estimate: (text length / effective chunk size) + 1
    const effectiveChunkSize = this.chunkSize - this.chunkOverlap;
    return Math.ceil(text.length / effectiveChunkSize);
  }

  /**
   * Streaming generator that yields chunks one at a time.
   * Memory-efficient: doesn't store all chunks in an array.
   */
  *streamChunks(text: string): Generator<string, void, unknown> {
    if (text.length <= this.chunkSize) {
      yield text;
      return;
    }

    let start = 0;
    const minAdvance = Math.max(50, this.chunkSize - this.chunkOverlap); // Ensure we always advance

    while (start < text.length) {
      let end = Math.min(start + this.chunkSize, text.length);

      if (end < text.length) {
        // Try to find a good split point, but ensure we advance by at least minAdvance
        const splitPoint = this.findBestSplitPoint(text, start, end);
        // Only use split point if it gives us reasonable progress
        if (splitPoint - start >= minAdvance * 0.5) {
          end = splitPoint;
        }
        // Otherwise use the hard end to ensure progress
      }

      yield text.substring(start, end);

      // Advance by at least minAdvance characters to avoid infinite loops
      const nextStart = end - this.chunkOverlap;
      start = Math.max(nextStart, start + minAdvance * 0.5);

      if (start >= text.length) {
        break;
      }
    }
  }

  /**
   * Legacy method for backwards compatibility.
   * ⚠️ WARNING: This creates all chunks in memory and can cause OOM on large documents.
   * Prefer streamChunks() for large documents.
   */
  splitText(text: string): string[] {
    return Array.from(this.streamChunks(text));
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
