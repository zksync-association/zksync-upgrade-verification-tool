export class Terminal {
  out: NodeJS.WritableStream;
  err: NodeJS.WritableStream;

  constructor(out: NodeJS.WritableStream, err: NodeJS.WritableStream) {
    this.out = out;
    this.err = err;
  }

  static default(): Terminal {
    return new Terminal(process.stdout, process.stderr);
  }

  append(data: string): void {
    this.out.write(data);
  }

  line(data: string): void {
    this.out.write(data);
    this.out.write("\n");
  }

  errAppend(data: string): void {
    this.err.write(data);
  }

  errLine(data: string): void {
    this.err.write(data);
    this.err.write("\n");
  }
}
