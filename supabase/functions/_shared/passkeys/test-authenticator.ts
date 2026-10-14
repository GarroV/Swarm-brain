// Программный аутентификатор для тестов: настоящие ES256-подписи и настоящая структура WebAuthn,
// чтобы ядро (flow.ts) проверялось на живой криптографии, а не на подмене библиотеки.
import { isoCBOR } from "npm:@simplewebauthn/server@14/helpers";

const enc = new TextEncoder();

export function b64u(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sha256(data: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", data));
}

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

const u32 = (n: number) => new Uint8Array([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);

// WebCrypto отдаёт подпись как r||s, WebAuthn ждёт DER.
function derOf(raw: Uint8Array): Uint8Array {
  const int = (b: Uint8Array) => {
    let i = 0;
    while (i < b.length - 1 && b[i] === 0) i++;
    let v = b.slice(i);
    if (v[0] & 0x80) v = concat(new Uint8Array([0]), v);
    return concat(new Uint8Array([0x02, v.length]), v);
  };
  const body = concat(int(raw.slice(0, 32)), int(raw.slice(32)));
  return concat(new Uint8Array([0x30, body.length]), body);
}

export type Flags = { userVerified?: boolean };

export class SoftAuthenticator {
  readonly credentialId = crypto.getRandomValues(new Uint8Array(32));
  counter = 0;
  private constructor(
    private readonly keys: CryptoKeyPair,
    private readonly x: Uint8Array,
    private readonly y: Uint8Array,
  ) {}

  static async create(): Promise<SoftAuthenticator> {
    const keys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    const jwk = await crypto.subtle.exportKey("jwk", keys.publicKey);
    const dec = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
    return new SoftAuthenticator(keys, dec(jwk.x!), dec(jwk.y!));
  }

  get id(): string {
    return b64u(this.credentialId);
  }

  private clientData(type: string, challenge: string, origin: string): Uint8Array<ArrayBuffer> {
    return enc.encode(JSON.stringify({ type, challenge, origin, crossOrigin: false }));
  }

  private flags(userVerified: boolean, attested: boolean): number {
    return 0x01 | (userVerified ? 0x04 : 0) | (attested ? 0x40 : 0);
  }

  /** Ответ на navigator.credentials.create(). */
  async register(o: { challenge: string; origin: string; rpID: string } & Flags): Promise<Record<string, unknown>> {
    const cose = new Map<number, number | Uint8Array>([[1, 2], [3, -7], [-1, 1], [-2, this.x], [-3, this.y]]);
    const authData = concat(
      await sha256(enc.encode(o.rpID)),
      new Uint8Array([this.flags(o.userVerified ?? true, true)]),
      u32(this.counter),
      new Uint8Array(16),
      new Uint8Array([0, this.credentialId.length]),
      this.credentialId,
      isoCBOR.encode(cose),
    );
    const attestationObject = isoCBOR.encode(
      new Map<string, string | Uint8Array | Map<string, never>>([
        ["fmt", "none"],
        ["attStmt", new Map<string, never>()],
        ["authData", authData],
      ]),
    );
    return {
      id: this.id,
      rawId: this.id,
      type: "public-key",
      response: {
        clientDataJSON: b64u(this.clientData("webauthn.create", o.challenge, o.origin)),
        attestationObject: b64u(attestationObject),
        transports: ["internal"],
      },
      clientExtensionResults: {},
      authenticatorAttachment: "platform",
    };
  }

  /** Ответ на navigator.credentials.get(); счётчик растёт, если не сказано иное. */
  async assert(
    o: { challenge: string; origin: string; rpID: string; counter?: number } & Flags,
  ): Promise<Record<string, unknown>> {
    this.counter = o.counter ?? this.counter + 1;
    const authData = concat(
      await sha256(enc.encode(o.rpID)),
      new Uint8Array([this.flags(o.userVerified ?? true, false)]),
      u32(this.counter),
    );
    const clientData = this.clientData("webauthn.get", o.challenge, o.origin);
    const signed = concat(authData, await sha256(clientData));
    const sig = new Uint8Array(
      await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, this.keys.privateKey, signed),
    );
    return {
      id: this.id,
      rawId: this.id,
      type: "public-key",
      response: {
        clientDataJSON: b64u(clientData),
        authenticatorData: b64u(authData),
        signature: b64u(derOf(sig)),
      },
      clientExtensionResults: {},
    };
  }
}
