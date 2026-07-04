import { createConnection, Socket } from 'net'
import { createReadStream } from 'fs'

export interface FileScanResult {
  path: string
  infected: boolean
  signature: string | null
  error: string | null
}

const DEFAULT_TIMEOUT = 120_000
const INSTREAM_CHUNK = 64 * 1024

/**
 * Minimal client for the clamd protocol over a unix domain socket.
 * Uses one connection per command with z-terminated (NUL) framing.
 */
export class ClamdClient {
  constructor(private socketPath: string) {}

  private connect(timeout = DEFAULT_TIMEOUT): Promise<Socket> {
    return new Promise((resolve, reject) => {
      const sock = createConnection(this.socketPath)
      sock.setTimeout(timeout)
      sock.once('connect', () => resolve(sock))
      sock.once('error', reject)
      sock.once('timeout', () => {
        sock.destroy()
        reject(new Error('clamd socket timeout'))
      })
    })
  }

  private readReply(sock: Socket): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = []
      sock.on('data', (d) => {
        chunks.push(d)
        if (d.includes(0)) sock.end()
      })
      sock.once('error', reject)
      sock.once('close', () => {
        const raw = Buffer.concat(chunks).toString('utf8')
        resolve(raw.replace(/\0+$/, '').trim())
      })
    })
  }

  async command(cmd: string, timeout = DEFAULT_TIMEOUT): Promise<string> {
    const sock = await this.connect(timeout)
    const reply = this.readReply(sock)
    sock.write(`z${cmd}\0`)
    return reply
  }

  async ping(): Promise<boolean> {
    try {
      return (await this.command('PING', 3000)) === 'PONG'
    } catch {
      return false
    }
  }

  async version(): Promise<string> {
    return this.command('VERSION', 5000)
  }

  async reload(): Promise<void> {
    await this.command('RELOAD', 60_000)
  }

  async shutdown(): Promise<void> {
    try {
      await this.command('SHUTDOWN', 5000)
    } catch {
      /* socket may drop before replying */
    }
  }

  /** Scan a path clamd can read directly (same user). */
  async scanPath(path: string): Promise<FileScanResult> {
    const reply = await this.command(`SCAN ${path}`)
    return parseScanReply(path, reply)
  }

  /**
   * Stream a file to clamd (works regardless of daemon fs visibility,
   * and respects StreamMaxLength instead of failing).
   */
  async scanStream(path: string): Promise<FileScanResult> {
    const sock = await this.connect()
    const replyP = this.readReply(sock)
    sock.write('zINSTREAM\0')

    await new Promise<void>((resolve, reject) => {
      const rs = createReadStream(path, { highWaterMark: INSTREAM_CHUNK })
      rs.on('data', (chunk) => {
        const buf = chunk as Buffer
        const len = Buffer.alloc(4)
        len.writeUInt32BE(buf.length, 0)
        if (!sock.write(Buffer.concat([len, buf]))) rs.pause()
      })
      sock.on('drain', () => rs.resume())
      rs.on('end', () => {
        sock.write(Buffer.from([0, 0, 0, 0]))
        resolve()
      })
      rs.on('error', (err) => {
        sock.destroy()
        reject(err)
      })
    }).catch((err) => {
      return Promise.reject(err)
    })

    const reply = await replyP
    return parseScanReply(path, reply)
  }
}

export function parseScanReply(path: string, reply: string): FileScanResult {
  // "<path>: OK" | "<path>: <sig> FOUND" | "<path>: <msg> ERROR"
  const line = reply.split('\n')[0] ?? ''
  const idx = line.lastIndexOf(': ')
  const verdict = idx >= 0 ? line.slice(idx + 2) : line
  if (verdict === 'OK') return { path, infected: false, signature: null, error: null }
  if (verdict.endsWith(' FOUND'))
    return { path, infected: true, signature: verdict.slice(0, -' FOUND'.length), error: null }
  return { path, infected: false, signature: null, error: verdict || 'unknown clamd reply' }
}
