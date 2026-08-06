declare module 'unzipper' {
  interface Entry {
    path: string;
    buffer(): Promise<Buffer>;
  }

  interface Directory {
    files: Entry[];
  }

  export const Open: {
    file(path: string): Promise<Directory>;
  };
}
