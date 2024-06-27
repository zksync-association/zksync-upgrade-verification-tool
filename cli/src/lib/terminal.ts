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

  line(data: string): void {
    this.out.write(data);
    this.out.write("\n");
  }

  errLine(data: string): void {
    this.err.write(data);
    this.err.write("\n");
  }
}
