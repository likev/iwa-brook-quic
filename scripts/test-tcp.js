import net from 'node:net';
import readline from 'node:readline';

const mode = process.argv[2] || 'client';
const targetPort = parseInt(process.argv[3], 10) || 8080;
const targetHost = process.argv[4] || '127.0.0.1';

console.log('=== External TCP Test Tool ===');

if (mode === 'server') {
  // Run standalone TCP server to test with TCP Client IWA
  const server = net.createServer((socket) => {
    const remote = `${socket.remoteAddress}:${socket.remotePort}`;
    console.log(`\n[+] Client connected from ${remote}`);

    // Send welcome banner
    socket.write(`220 Node.js TCP Echo Server Ready (ts=${Date.now()})\r\n`);

    socket.on('data', (data) => {
      const text = data.toString();
      console.log(`[RX from ${remote}] (${data.length} bytes): ${JSON.stringify(text)}`);

      // Echo back
      socket.write(data);
      console.log(`[TX Echo -> ${remote}] (${data.length} bytes)`);
    });

    socket.on('close', () => {
      console.log(`[-] Client ${remote} disconnected.`);
    });

    socket.on('error', (err) => {
      console.error(`[!] Socket error on ${remote}:`, err.message);
    });
  });

  server.listen(targetPort, '0.0.0.0', () => {
    console.log(`[*] TCP Server listening on 0.0.0.0:${targetPort}`);
    console.log(`[*] You can now connect to this server from the TCP Client IWA!\n`);
  });

} else {
  // Run standalone TCP client to test with TCP Listener IWA
  console.log(`[*] Connecting to TCP Listener IWA at ${targetHost}:${targetPort}...`);

  const client = net.createConnection({ host: targetHost, port: targetPort }, () => {
    console.log(`[+] Connected to ${targetHost}:${targetPort}!`);
    console.log(`[+] Type messages and press Enter to send. Type 'exit' to quit.\n`);

    // Send an initial ping packet
    const initialMsg = `PING from Node.js CLI (ts=${Date.now()})\r\n`;
    client.write(initialMsg);
    console.log(`[TX Initial] ${initialMsg.trim()}`);
  });

  client.on('data', (data) => {
    console.log(`[RX Server] (${data.length} bytes): ${data.toString()}`);
  });

  client.on('close', () => {
    console.log('[-] Connection closed by server.');
    process.exit(0);
  });

  client.on('error', (err) => {
    console.error('[!] TCP Client Error:', err.message);
  });

  // Interactive console input
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  rl.on('line', (line) => {
    if (line.trim().toLowerCase() === 'exit') {
      client.end();
      rl.close();
      return;
    }
    client.write(line + '\r\n');
    console.log(`[TX Sent] ${line}`);
  });
}
