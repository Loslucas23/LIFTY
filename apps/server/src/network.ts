import os from 'node:os';

/** Direcciones IPv4 de la compu en la red local (para que el celular se conecte). */
export function lanAddresses(): string[] {
  const out: string[] = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const info of list ?? []) {
      if (info.family !== 'IPv4' || info.internal) continue;
      // Las interfaces virtuales (Docker, VirtualBox, WSL) rara vez son alcanzables desde el celular.
      if (/^(docker|br-|veth|vbox|vmnet|virbr)/i.test(name)) continue;
      out.push(info.address);
    }
  }
  // Primero las redes domésticas típicas.
  const rank = (ip: string) => (ip.startsWith('192.168.') ? 0 : ip.startsWith('10.') ? 1 : ip.startsWith('100.') ? 2 : 3);
  return out.sort((a, b) => rank(a) - rank(b));
}

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

export function isLoopback(address: string | undefined): boolean {
  return !!address && LOOPBACK.has(address);
}
