export class SerialManager {
  port: SerialPort | null = null;
  reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private encoder = new TextEncoder();
  private decoder = new TextDecoder();

  async connect(): Promise<boolean> {
    try {
      // @ts-ignore
      this.port = await navigator.serial.requestPort();
      if (!this.port) return false;
      await this.port.open({ baudRate: 115200 });
      this.writer = this.port.writable!.getWriter();
      this.reader = this.port.readable!.getReader();
      return true;
    } catch (e) {
      console.error("Serial connection failed:", e);
      return false;
    }
  }

  async disconnect() {
    if (this.port) {
      if (this.reader) {
        await this.reader.cancel();
        this.reader.releaseLock();
      }
      if (this.writer) {
        await this.writer.close();
        this.writer.releaseLock();
      }
      await this.port.close();
      this.port = null;
      this.reader = null;
      this.writer = null;
    }
  }

  async write(data: string) {
    if (this.writer) {
      await this.writer.write(this.encoder.encode(data));
    }
  }

  async readLoop(onLine: (line: string) => void) {
    let buffer = "";
    while (this.port && this.reader) {
      try {
        const { value, done } = await this.reader.read();
        if (done) break;

        // chunkごとにデコードしてバッファに追加
        buffer += this.decoder.decode(value, { stream: true });

        const lines = buffer.split("\r");
        buffer = lines.pop() || "";

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (line) onLine(line);
        }
      } catch (e) {
        console.error("Read error:", e);
        break;
      }
    }
  }
}

export const serialManager = new SerialManager();
