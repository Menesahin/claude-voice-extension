declare module '@picovoice/porcupine-node' {
  export enum BuiltinKeyword {
    ALEXA = 'ALEXA',
    AMERICANO = 'AMERICANO',
    BLUEBERRY = 'BLUEBERRY',
    BUMBLEBEE = 'BUMBLEBEE',
    COMPUTER = 'COMPUTER',
    GRAPEFRUIT = 'GRAPEFRUIT',
    GRASSHOPPER = 'GRASSHOPPER',
    HEY_GOOGLE = 'HEY_GOOGLE',
    HEY_SIRI = 'HEY_SIRI',
    JARVIS = 'JARVIS',
    OK_GOOGLE = 'OK_GOOGLE',
    PICOVOICE = 'PICOVOICE',
    PORCUPINE = 'PORCUPINE',
    TERMINATOR = 'TERMINATOR',
  }

  export class Porcupine {
    readonly frameLength: number;
    readonly sampleRate: number;
    readonly version: string;

    constructor(
      accessKey: string,
      keywords: BuiltinKeyword[] | string[],
      sensitivities?: number[]
    );

    process(pcm: Int16Array): number;
    release(): void;
  }
}

declare module '@picovoice/pvrecorder-node' {
  export class PvRecorder {
    constructor(frameLength: number, deviceIndex?: number);

    start(): void;
    stop(): void;
    read(): Promise<Int16Array>;
    release(): void;

    static getAvailableDevices(): string[];
  }
}
