declare module 'png-chunks-extract' {
  interface PngChunk {
    name: string;
    data: Uint8Array;
  }
  function extract(buffer: Uint8Array | Buffer): PngChunk[];
  export = extract;
}

declare module 'png-chunk-text' {
  interface PngChunk {
    name: string;
    data: Uint8Array;
  }
  function encode(keyword: string, text: string): PngChunk;
  function decode(chunk: PngChunk | Uint8Array | Buffer): { keyword: string; text: string };
  export { encode, decode };
}

declare module '*.png' {
  const src: string;
  export default src;
}
