import * as net from 'node:net';
import type { FindingInput } from './types.js';

/**
 * Common ports to probe with service name and risk classification.
 * Risky ports are services that should generally not be exposed to the internet.
 */
const COMMON_PORTS: ReadonlyArray<{ port: number; service: string; risky: boolean }> = [
  { port: 21, service: 'FTP', risky: true },
  { port: 22, service: 'SSH', risky: false },
  { port: 23, service: 'Telnet', risky: true },
  { port: 25, service: 'SMTP', risky: false },
  { port: 53, service: 'DNS', risky: false },
  { port: 80, service: 'HTTP', risky: false },
  { port: 110, service: 'POP3', risky: true },
  { port: 143, service: 'IMAP', risky: false },
  { port: 443, service: 'HTTPS', risky: false },
  { port: 445, service: 'SMB', risky: true },
  { port: 993, service: 'IMAPS', risky: false },
  { port: 995, service: 'POP3S', risky: false },
  { port: 1433, service: 'MSSQL', risky: true },
  { port: 1521, service: 'Oracle DB', risky: true },
  { port: 3306, service: 'MySQL', risky: true },
  { port: 3389, service: 'RDP', risky: true },
  { port: 5432, service: 'PostgreSQL', risky: true },
  { port: 5900, service: 'VNC', risky: true },
  { port: 6379, service: 'Redis', risky: true },
  { port: 8080, service: 'HTTP-Alt', risky: false },
];

/**
 * Attempt a TCP connect to a single port.
 * Returns true if the port accepted the connection, false otherwise.
 */
function checkPort(host: string, port: number, timeoutMs: number = 5000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(timeoutMs);

    socket.on('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.on('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.on('error', () => {
      socket.destroy();
      resolve(false);
    });

    socket.connect(port, host);
  });
}

/**
 * TCP connect port scan on the top 20 common ports.
 *
 * Uses node:net Socket — no external dependencies, no shell invocation.
 * All 20 probes run in parallel with a 5-second per-port timeout.
 *
 * Reports:
 * - Individual findings for risky open ports (medium/high severity)
 * - Summary finding listing all open ports (info)
 */
export async function checkPorts(host: string): Promise<FindingInput[]> {
  const findings: FindingInput[] = [];

  // Scan all ports in parallel with 5s timeout each
  const results = await Promise.all(
    COMMON_PORTS.map(async ({ port, service, risky }) => {
      const open = await checkPort(host, port, 5000);
      return { port, service, risky, open };
    }),
  );

  const openPorts = results.filter((r) => r.open);
  const riskyOpen = openPorts.filter((r) => r.risky);

  // Report risky open ports individually
  for (const { port, service } of riskyOpen) {
    findings.push({
      source_agent: 'passive',
      template_id: `ports.risky_open_${port}`,
      title: `Kockazatos nyitott port: ${port} (${service})`,
      severity: port === 23 || port === 445 || port === 3389 ? 'high' : 'medium',
      description: `A(z) ${service} szolgaltatas (${port}-es port) elerheto kivulrol, ami biztonsagi kockazatot jelent.`,
      tags: ['port-scan', service.toLowerCase()],
      evidence: { port, service },
    });
  }

  // Summary of all open ports
  if (openPorts.length > 0) {
    findings.push({
      source_agent: 'passive',
      template_id: 'ports.summary',
      title: `${openPorts.length} nyitott port talalhato`,
      severity: 'info',
      description: `Nyitott portok: ${openPorts.map((p) => `${p.port}/${p.service}`).join(', ')}`,
      evidence: { open_ports: openPorts.map((p) => ({ port: p.port, service: p.service })) },
      tags: ['port-scan'],
    });
  }

  return findings;
}
