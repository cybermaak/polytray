import { Readable } from 'node:stream';
import { finished } from 'node:stream/promises';
import { Open } from 'unzipper';
import { openRegularFileNoFollow } from './localFileProtocol';

interface ArchiveSource {
  stat(): Promise<{ size: number }>;
  read(buffer: Buffer, offset: number, length: number, position: number): Promise<{ bytesRead: number }>;
  close(): Promise<void>;
}

/** Keep one no-follow descriptor open for ZIP directory reads and member streams. */
export async function openArchiveNoFollow(
  archivePath: string,
  openSource: (filePath: string) => Promise<ArchiveSource> = openRegularFileNoFollow,
) {
  const handle = await openSource(archivePath);
  try {
    const { size } = await handle.stat();
    const rangeStreams = new Set<Readable>();
    const rangeSettlements = new Set<Promise<void>>();
    let closing: Promise<void> | null = null;
    const directory = await Open.custom({
      size: async () => size,
      stream: (offset, length) => {
        const stream = Readable.from((async function* () {
          const chunkSize = 64 * 1024;
          const end = length ? Math.min(offset + length, size) : size;
          for (let position = offset; position < end;) {
            const chunk = Buffer.alloc(Math.min(chunkSize, end - position));
            let bytesRead = 0;
            try { ({ bytesRead } = await handle.read(chunk, 0, chunk.length, position)); }
            catch { break; }
            // unzipper turns a short source stream into FILE_ENDED for the entry.
            if (!bytesRead) break;
            position += bytesRead;
            yield chunk.subarray(0, bytesRead);
          }
        })());
        // unzipper owns the entry stream but does not observe errors on this source.
        stream.on('error', () => {});
        rangeStreams.add(stream);
        let settlement!: Promise<void>;
        settlement = finished(stream).catch(() => {}).finally(() => {
          rangeStreams.delete(stream);
          rangeSettlements.delete(settlement);
        });
        rangeSettlements.add(settlement);
        if (closing) stream.destroy();
        return stream;
      },
    });
    return { files: directory.files, close: () => {
      if (!closing) closing = (async () => {
        for (const stream of rangeStreams) stream.destroy();
        await Promise.all([...rangeSettlements]);
        await handle.close();
      })();
      return closing;
    } };
  } catch (error) {
    await handle.close();
    throw error;
  }
}
